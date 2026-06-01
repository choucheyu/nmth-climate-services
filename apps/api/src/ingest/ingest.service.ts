import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, type Device } from "@prisma/client";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  DEFAULT_PARSE_VERSION,
  ingestMeasurementSchema,
  profileImportMeasurementRowSchema,
  profileImportSchema,
  transitionalCollectorMeasurementSchema,
  type DataProfile,
  type IngestMeasurementInput
} from "@nmth/shared";
import { Subject } from "rxjs";
import { AlertsService } from "../alerts/alerts.service";
import { assertDataProfileAllowed } from "../common/access-scope";
import { writeAuditLog } from "../common/audit.util";
import type { RequestUser } from "../common/current-user.decorator";
import { normalizeDataProfile } from "../common/data-profile";
import { PrismaService } from "../prisma/prisma.service";

const COLLECTOR_FETCH_TIMEOUT_MS = 5_000;
const COLLECTOR_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const COLLECTOR_MAX_IMPORT_ROWS = 5_000;

export interface IngestResult {
  status: "accepted" | "duplicate";
  accepted: true;
  deviceId: string;
  measurementId: string;
  measuredAt: Date;
  duplicate: boolean;
}

export interface IngestRejectedResult {
  status: "unknown_device" | "disabled_device";
  accepted: false;
  quarantineId: string;
  registration: string;
  dataProfile: DataProfile;
  receivedAt: Date;
  reason: string;
}

export interface IngestInvalidResult {
  status: "invalid_payload";
  accepted: false;
  reason: string;
  issues: Array<{ path: string; message: string }>;
}

export type IngestResponse = IngestResult | IngestRejectedResult | IngestInvalidResult;

@Injectable()
export class IngestService {
  private readonly streamSubject = new Subject<{ data: unknown }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly alertsService: AlertsService,
    @Optional() private readonly config?: ConfigService
  ) {}

  stream() {
    return this.streamSubject.asObservable();
  }

  async ingest(input: unknown): Promise<IngestResponse> {
    const parsedInput = ingestMeasurementSchema.safeParse(input);
    if (!parsedInput.success) {
      return {
        status: "invalid_payload",
        accepted: false,
        reason: "schema_validation_failed",
        issues: parsedInput.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      };
    }

    const data = parsedInput.data;
    const dataProfile = normalizeDataProfile(data.dataProfile);
    const measuredAt = data.parsed.measuredAt ?? data.rawPacket.receivedAt ?? new Date();
    const receivedAt = data.rawPacket.receivedAt ?? new Date();

    if (dataProfile === "DEMO") {
      return this.ingestDemo(data, dataProfile, measuredAt, receivedAt);
    }

    const existingDevice = await this.prisma.device.findUnique({
      where: { dataProfile_deviceName: { dataProfile, deviceName: data.registration } }
    });

    if (!existingDevice) {
      return this.quarantine(data, dataProfile, receivedAt, "unknown_device", "real_device_not_registered");
    }

    if (!this.isEnabledDevice(existingDevice)) {
      return this.quarantine(data, dataProfile, receivedAt, "disabled_device", "real_device_disabled");
    }

    return this.ingestKnownRealDevice(data, dataProfile, existingDevice, measuredAt, receivedAt);
  }

  async importFromCollector(
    url: string,
    requestedProfile: DataProfile = "REAL",
    user?: RequestUser
  ): Promise<{ dataProfile: DataProfile; imported: number; duplicates: number; rejected: number }> {
    const dataProfile = assertDataProfileAllowed(user, normalizeDataProfile(requestedProfile));
    const collectorUrl = await this.assertCollectorImportUrl(url);
    const response = await this.fetchCollector(collectorUrl);
    if (!response.ok) {
      throw new Error(`Collector request failed: ${response.status}`);
    }
    const payload = await this.readCollectorPayload(response);
    const rows = this.extractCollectorRows(payload);
    if (rows.length > COLLECTOR_MAX_IMPORT_ROWS) {
      throw new BadRequestException(`Collector import exceeds ${COLLECTOR_MAX_IMPORT_ROWS} rows`);
    }
    let imported = 0;
    let duplicates = 0;
    let rejected = 0;
    for (const row of rows) {
      const parsed = transitionalCollectorMeasurementSchema.parse(row);
      const measuredAt = this.combineCollectorDateTime(parsed.date, parsed.time);
      const result = await this.ingest({
        dataProfile,
        registration: parsed.deviceName,
        rawPacket: {
          protocol: "usr-c215-transitional-api",
          receivedAt: measuredAt,
          payload: parsed
        },
        parsed: {
          deviceName: parsed.deviceName,
          measuredAt,
          temperatureC: parsed.temperatureC,
          humidityPercent: parsed.humidityPercent,
          dehumidifySetpoint: parsed.dehumidifySetpoint ?? null,
          qualityFlags: ["imported_from_collector_api"]
        },
        parseVersion: DEFAULT_PARSE_VERSION,
        source: "imported",
        metadata: { transitionalImportUrl: collectorUrl.toString() }
      });
      if (result.status === "duplicate") {
        duplicates += 1;
      } else if (result.status === "accepted") {
        imported += 1;
      } else {
        rejected += 1;
      }
    }
    const result = { dataProfile, imported, duplicates, rejected };
    await writeAuditLog(this.prisma, {
      userId: user?.id,
      action: "ingest.import_collector",
      entityType: "measurement",
      riskLevel: "high",
      after: { dataProfile, imported, duplicates, rejected }
    });
    return result;
  }

  async importProfileMeasurements(input: unknown, user?: RequestUser): Promise<{ dataProfile: DataProfile; imported: number; duplicates: number; rows: number }> {
    const parsedInput = profileImportSchema.parse(input);
    const dataProfile = assertDataProfileAllowed(user, normalizeDataProfile(parsedInput.dataProfile));
    const rawRows = parsedInput.rows ?? this.parseProfileCsv(parsedInput.csv ?? "");
    const rows = rawRows.map((row, index) => {
      const parsed = profileImportMeasurementRowSchema.safeParse(row);
      if (!parsed.success) {
        throw new BadRequestException({
          message: "Invalid profile import row",
          row: index + 1,
          issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
        });
      }
      return parsed.data;
    });

    let imported = 0;
    let duplicates = 0;
    const affectedDeviceIds = new Set<string>();
    for (const row of rows) {
      const exhibition = row.exhibitionCode
        ? await this.prisma.exhibition.upsert({
            where: { dataProfile_code: { dataProfile, code: row.exhibitionCode } },
            update: {
              name: row.exhibitionName ?? row.exhibitionCode,
              status: row.exhibitionStatus
            },
            create: {
              dataProfile,
              code: row.exhibitionCode,
              name: row.exhibitionName ?? row.exhibitionCode,
              status: row.exhibitionStatus
            }
          })
        : null;
      const zone =
        exhibition && row.zoneCode
          ? await this.prisma.exhibitionZone.upsert({
              where: { exhibitionId_code: { exhibitionId: exhibition.id, code: row.zoneCode } },
              update: { name: row.zoneName ?? row.zoneCode },
              create: {
                exhibitionId: exhibition.id,
                code: row.zoneCode,
                name: row.zoneName ?? row.zoneCode
              }
            })
          : null;
      const device = await this.prisma.device.upsert({
        where: { dataProfile_deviceName: { dataProfile, deviceName: row.deviceName } },
        update: {
          dataProfile,
          displayName: row.displayName ?? row.deviceName,
          exhibitionId: exhibition?.id,
          zoneId: zone?.id,
          pointType: row.pointType,
          enabled: true,
          archivedAt: null,
          lastSeenAt: row.measuredAt,
          lastParseStatus: "profile_import"
        },
        create: {
          dataProfile,
          deviceName: row.deviceName,
          displayName: row.displayName ?? row.deviceName,
          exhibitionId: exhibition?.id,
          zoneId: zone?.id,
          pointType: row.pointType,
          enabled: true,
          lastSeenAt: row.measuredAt,
          lastParseStatus: "profile_import",
          metadata: { importContract: "profile-csv-json-v1" }
        }
      });
      const result = await this.prisma.measurement
        .create({
          data: {
            measuredAt: row.measuredAt,
            dataProfile,
            deviceId: device.id,
            exhibitionId: exhibition?.id,
            zoneId: zone?.id,
            source: row.source,
            temperatureC: row.temperatureC,
            humidityPercent: row.humidityPercent,
            dehumidifySetpoint: row.dehumidifySetpoint ?? null,
            qualityFlags: row.qualityFlags,
            parseVersion: row.parseVersion,
            metadata: { importContract: "profile-csv-json-v1" }
          }
        })
        .then(() => "created" as const)
        .catch((error: unknown) => {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            return "duplicate" as const;
          }
          throw error;
        });
      if (result === "created") {
        imported += 1;
        affectedDeviceIds.add(device.id);
      } else {
        duplicates += 1;
      }
    }
    for (const deviceId of affectedDeviceIds) {
      await this.alertsService.evaluateLatestMeasurementForDevice(deviceId, dataProfile);
    }
    const result = { dataProfile, imported, duplicates, rows: rows.length };
    await writeAuditLog(this.prisma, {
      userId: user?.id,
      action: "ingest.import_profile_measurements",
      entityType: "measurement",
      riskLevel: "high",
      after: result
    });
    return result;
  }

  private async ingestDemo(
    data: IngestMeasurementInput,
    dataProfile: DataProfile,
    measuredAt: Date,
    receivedAt: Date
  ): Promise<IngestResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      const device = await tx.device.upsert({
        where: { dataProfile_deviceName: { dataProfile, deviceName: data.registration } },
        update: {
          dataProfile,
          lastSeenAt: measuredAt,
          lastParseStatus: "parsed"
        },
        create: {
          dataProfile,
          deviceName: data.registration,
          displayName: data.registration,
          lastSeenAt: measuredAt,
          lastParseStatus: "parsed"
        }
      });

      return this.writeAcceptedMeasurement(tx, data, dataProfile, device, measuredAt, receivedAt);
    });

    return this.finishAcceptedIngest(dataProfile, result);
  }

  private async ingestKnownRealDevice(
    data: IngestMeasurementInput,
    dataProfile: DataProfile,
    device: Device,
    measuredAt: Date,
    receivedAt: Date
  ): Promise<IngestResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      const updatedDevice = await tx.device.update({
        where: { id: device.id },
        data: {
          lastSeenAt: measuredAt,
          lastParseStatus: "parsed"
        }
      });

      return this.writeAcceptedMeasurement(tx, data, dataProfile, updatedDevice, measuredAt, receivedAt);
    });

    return this.finishAcceptedIngest(dataProfile, result);
  }

  private async writeAcceptedMeasurement(
    tx: Prisma.TransactionClient,
    data: IngestMeasurementInput,
    dataProfile: DataProfile,
    device: Device,
    measuredAt: Date,
    receivedAt: Date
  ) {
    const raw = await tx.deviceRawPacket.create({
      data: {
        deviceId: device.id,
        registration: data.registration,
        protocol: data.rawPacket.protocol,
        frameHex: data.rawPacket.frameHex,
        payload: this.toJson(data.rawPacket.payload ?? {}),
        parseVersion: data.parseVersion,
        parseStatus: "parsed",
        receivedAt
      }
    });

    let duplicate = false;
    const measurement = await tx.measurement
      .create({
        data: {
          measuredAt,
          dataProfile,
          deviceId: device.id,
          exhibitionId: device.exhibitionId,
          zoneId: device.zoneId,
          source: data.source,
          temperatureC: data.parsed.temperatureC,
          humidityPercent: data.parsed.humidityPercent,
          dehumidifySetpoint: data.parsed.dehumidifySetpoint,
          qualityFlags: data.parsed.qualityFlags,
          parseVersion: data.parseVersion,
          rawPacketId: raw.id,
          rawPacketReceivedAt: raw.receivedAt,
          metadata: this.toJson(data.metadata)
        }
      })
      .catch(async (error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          duplicate = true;
          return tx.measurement.findFirstOrThrow({
            where: {
              deviceId: device.id,
              measuredAt,
              dataProfile,
              source: data.source,
              parseVersion: data.parseVersion
            }
          });
        }
        throw error;
      });

    return { device, measurement, duplicate };
  }

  private async finishAcceptedIngest(
    dataProfile: DataProfile,
    result: Awaited<ReturnType<IngestService["writeAcceptedMeasurement"]>>
  ): Promise<IngestResult> {
    if (!result.duplicate) {
      await this.alertsService.evaluateMeasurement({
        id: result.measurement.id,
        measuredAt: result.measurement.measuredAt,
        deviceId: result.measurement.deviceId,
        exhibitionId: result.measurement.exhibitionId,
        zoneId: result.measurement.zoneId,
        temperatureC: result.measurement.temperatureC,
        humidityPercent: result.measurement.humidityPercent,
        source: result.measurement.source,
        dataProfile: result.measurement.dataProfile
      });

      this.streamSubject.next({
        data: {
          type: "measurement",
          dataProfile,
          deviceId: result.device.id,
          measurement: result.measurement
        }
      });
    }

    return {
      status: result.duplicate ? "duplicate" : "accepted",
      accepted: true,
      deviceId: result.device.id,
      measurementId: result.measurement.id,
      measuredAt: result.measurement.measuredAt,
      duplicate: result.duplicate
    };
  }

  private async quarantine(
    data: IngestMeasurementInput,
    dataProfile: DataProfile,
    receivedAt: Date,
    status: IngestRejectedResult["status"],
    reason: string
  ): Promise<IngestRejectedResult> {
    const quarantine = await this.prisma.ingestQuarantine.create({
      data: {
        receivedAt,
        dataProfile,
        registration: data.registration,
        protocol: data.rawPacket.protocol,
        frameHex: data.rawPacket.frameHex,
        payload: this.toJson(data.rawPacket.payload ?? {}),
        parsed: this.toJson(data.parsed),
        parseVersion: data.parseVersion,
        source: data.source,
        reason,
        status: "pending",
        metadata: this.toJson({
          ...data.metadata,
          rejectedStatus: status
        })
      }
    });

    return {
      status,
      accepted: false,
      quarantineId: quarantine.id,
      registration: data.registration,
      dataProfile,
      receivedAt,
      reason
    };
  }

  private isEnabledDevice(device: Device): boolean {
    return device.enabled && device.archivedAt == null;
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return sanitizeJsonForPostgres(value ?? {}) as Prisma.InputJsonValue;
  }

  private async readCollectorPayload(response: Response): Promise<unknown> {
    const contentType = response.headers.get("content-type") ?? "";
    const text = await this.readBoundedCollectorText(response);
    if (contentType.includes("application/json")) {
      return JSON.parse(text) as unknown;
    }
    if (contentType.includes("text/csv") || text.trimStart().startsWith("date,time,deviceName")) {
      return this.parseCollectorCsv(text);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return this.parseCollectorCsv(text);
    }
  }

  private extractCollectorRows(payload: unknown): unknown[] {
    if (Array.isArray(payload)) {
      return payload;
    }
    if (payload && typeof payload === "object" && Array.isArray((payload as { measurements?: unknown[] }).measurements)) {
      return (payload as { measurements: unknown[] }).measurements;
    }
    return [];
  }

  private parseCollectorCsv(csv: string): Array<Record<string, string>> {
    const lines = csv
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const [headerLine, ...rows] = lines;
    if (!headerLine) {
      return [];
    }
    const headers = headerLine.split(",").map((header) => header.trim());
    return rows.map((line) => {
      const values = line.split(",").map((value) => value.trim());
      return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    });
  }

  private parseProfileCsv(csv: string): Array<Record<string, string>> {
    const rows = this.parseCollectorCsv(csv);
    if (!rows.length) {
      throw new BadRequestException("CSV import requires a header and at least one data row");
    }
    return rows;
  }

  private combineCollectorDateTime(date: string, time: string): Date {
    const normalized = `${date}T${time.includes(":") ? time : `${time}:00`}+08:00`;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  private async fetchCollector(url: URL): Promise<Response> {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), COLLECTOR_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: abort.signal,
        redirect: "manual",
        headers: {
          accept: "application/json, text/csv;q=0.9"
        }
      });
      if (response.status >= 300 && response.status < 400) {
        throw new BadRequestException("Collector import redirects are not allowed");
      }
      return response;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new BadRequestException("Collector import timed out");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async assertCollectorImportUrl(rawUrl: string): Promise<URL> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new BadRequestException("Collector import URL is invalid");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new BadRequestException("Collector import URL must use http or https");
    }
    if (url.username || url.password || url.hash) {
      throw new BadRequestException("Collector import URL must not include credentials or fragments");
    }

    const allowlist = this.collectorImportAllowlist();
    const matched = allowlist.find((allowed) => this.urlMatchesAllowlist(url, allowed));
    if (!matched) {
      throw new BadRequestException("Collector import URL is not allowlisted");
    }
    await this.assertResolvedCollectorAddress(url, matched);
    return url;
  }

  private collectorImportAllowlist(): URL[] {
    const configured = [
      this.config?.get<string>("COLLECTOR_IMPORT_ALLOWLIST"),
      this.config?.get<string>("COLLECTOR_BASE_URL")
    ]
      .filter((value): value is string => Boolean(value?.trim()))
      .flatMap((value) => value.split(","));
    const defaults = process.env.NODE_ENV === "production" ? [] : ["http://127.0.0.1:8088", "http://localhost:8088"];
    return [...configured, ...defaults]
      .map((value) => {
        try {
          const parsed = new URL(value.trim());
          return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
        } catch {
          return null;
        }
      })
      .filter((value): value is URL => Boolean(value));
  }

  private urlMatchesAllowlist(url: URL, allowed: URL): boolean {
    const allowedPath = allowed.pathname.replace(/\/$/, "");
    return url.origin === allowed.origin && (!allowedPath || url.pathname === allowed.pathname || url.pathname.startsWith(`${allowedPath}/`));
  }

  private async assertResolvedCollectorAddress(url: URL, matchedAllowlist: URL): Promise<void> {
    const hostname = url.hostname.replace(/^\[(.*)\]$/, "$1");
    const allowlistedHostname = matchedAllowlist.hostname.replace(/^\[(.*)\]$/, "$1");
    const privateAddressAllowed = hostname === allowlistedHostname && this.isPrivateHostAllowedByExplicitAllowlist(matchedAllowlist);
    const addresses = isIP(hostname)
      ? [{ address: hostname }]
      : await lookup(hostname, { all: true, verbatim: true }).catch(() => []);
    if (!addresses.length) {
      throw new BadRequestException("Collector import host could not be resolved");
    }
    for (const item of addresses) {
      if (this.isPrivateAddress(item.address) && !privateAddressAllowed) {
        throw new BadRequestException("Collector import URL resolves to a private address that is not explicitly allowlisted");
      }
    }
  }

  private isPrivateHostAllowedByExplicitAllowlist(url: URL): boolean {
    const configured = [
      this.config?.get<string>("COLLECTOR_IMPORT_ALLOWLIST"),
      this.config?.get<string>("COLLECTOR_BASE_URL")
    ]
      .filter((value): value is string => Boolean(value?.trim()))
      .flatMap((value) => value.split(","))
      .map((value) => {
        try {
          return new URL(value.trim());
        } catch {
          return null;
        }
      })
      .filter((value): value is URL => Boolean(value));
    if (configured.some((value) => value.origin === url.origin)) {
      return true;
    }
    return process.env.NODE_ENV !== "production" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  }

  private isPrivateAddress(address: string): boolean {
    const ipv4Mapped = address.match(/(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i);
    if (ipv4Mapped?.[1] && address.includes(":")) {
      return this.isPrivateAddress(ipv4Mapped[1]);
    }
    if (address.includes(":")) {
      const normalized = address.toLowerCase();
      return (
        normalized === "::" ||
        normalized === "::1" ||
        normalized.startsWith("fc") ||
        normalized.startsWith("fd") ||
        normalized.startsWith("fe80:") ||
        normalized.startsWith("ff")
      );
    }
    const parts = address.split(".").map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return true;
    }
    const a = parts[0]!;
    const b = parts[1]!;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0) ||
      a >= 224
    );
  }

  private async readBoundedCollectorText(response: Response): Promise<string> {
    if (!response.body) {
      return "";
    }
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      total += value.byteLength;
      if (total > COLLECTOR_MAX_RESPONSE_BYTES) {
        throw new BadRequestException(`Collector response exceeds ${COLLECTOR_MAX_RESPONSE_BYTES} bytes`);
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString("utf8");
  }
}

function sanitizeJsonForPostgres(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === "string") return value.replaceAll("\u0000", "");
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonForPostgres(item));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined && typeof child !== "function" && typeof child !== "symbol")
        .map(([key, child]) => [key.replaceAll("\u0000", ""), sanitizeJsonForPostgres(child)])
    );
  }
  return null;
}

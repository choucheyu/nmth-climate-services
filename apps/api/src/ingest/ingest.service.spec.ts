import "reflect-metadata";
import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IngestService } from "./ingest.service";

const measuredAt = new Date("2026-05-12T03:00:00.000Z");
const receivedAt = new Date("2026-05-12T03:00:01.000Z");

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    dataProfile: "REAL",
    registration: "00001",
    rawPacket: {
      protocol: "usr-c215",
      receivedAt,
      frameHex: "ABAF02051000E71000000000000009FF020810000000000000000000868E0A",
      payload: { format: "usr-c215-observed-binary" }
    },
    parsed: {
      deviceName: "00001",
      measuredAt,
      temperatureC: 23.1,
      humidityPercent: 51.7,
      dehumidifySetpoint: 52,
      qualityFlags: []
    },
    parseVersion: "usr-c215-v1",
    source: "real",
    metadata: { collector: "usr-c215-temp-server" },
    ...overrides
  };
}

function makeDevice(overrides: Record<string, unknown> = {}) {
  return {
    id: "device-1",
    dataProfile: "REAL",
    deviceName: "00001",
    displayName: "00001",
    ipAddress: null,
    macAddress: null,
    groupId: null,
    exhibitionId: "exhibition-1",
    zoneId: "zone-1",
    pointType: "ambient",
    enabled: true,
    archivedAt: null,
    lastSeenAt: null,
    lastParseStatus: null,
    metadata: {},
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    ...overrides
  };
}

function makeMeasurement(device = makeDevice()) {
  return {
    id: "measurement-1",
    measuredAt,
    deviceId: device.id,
    exhibitionId: device.exhibitionId,
    zoneId: device.zoneId,
    temperatureC: 23.1,
    humidityPercent: 51.7,
    source: "real",
    dataProfile: device.dataProfile
  };
}

function makeConfig(values: Record<string, string | undefined> = {}) {
  return {
    get: vi.fn((key: string) => values[key])
  };
}

function makeHarness(configValues: Record<string, string | undefined> = {}) {
  const device = makeDevice();
  const tx = {
    device: {
      upsert: vi.fn(async () => device),
      update: vi.fn(async () => device)
    },
    deviceRawPacket: {
      create: vi.fn(async () => ({ id: "raw-1", receivedAt }))
    },
    measurement: {
      create: vi.fn(async () => makeMeasurement(device)),
      findFirstOrThrow: vi.fn()
    }
  };
  const prisma = {
    device: {
      findUnique: vi.fn(async (): Promise<ReturnType<typeof makeDevice> | null> => device)
    },
    auditLog: {
      create: vi.fn(async () => ({ id: "audit-1" }))
    },
    ingestQuarantine: {
      create: vi.fn(async () => ({ id: "quarantine-1" }))
    },
    $transaction: vi.fn(async (callback: (txClient: typeof tx) => unknown) => callback(tx))
  };
  const alerts = {
    evaluateMeasurement: vi.fn(async () => undefined),
    evaluateLatestMeasurementForDevice: vi.fn(async () => true)
  };
  const config = makeConfig(configValues);
  const service = new IngestService(prisma as never, alerts as never, config as never);
  return { service, prisma, tx, alerts, device };
}

describe("IngestService registration gating", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts REAL ingest for an existing enabled device", async () => {
    const { service, prisma, tx, alerts } = makeHarness();

    const result = await service.ingest(makePayload());

    expect(result).toMatchObject({
      status: "accepted",
      accepted: true,
      deviceId: "device-1",
      measurementId: "measurement-1",
      duplicate: false
    });
    expect(prisma.device.findUnique).toHaveBeenCalledWith({
      where: { dataProfile_deviceName: { dataProfile: "REAL", deviceName: "00001" } }
    });
    expect(tx.device.update).toHaveBeenCalledWith({
      where: { id: "device-1" },
      data: { lastSeenAt: measuredAt, lastParseStatus: "parsed" }
    });
    expect(tx.measurement.create).toHaveBeenCalledOnce();
    expect(prisma.ingestQuarantine.create).not.toHaveBeenCalled();
    expect(alerts.evaluateMeasurement).toHaveBeenCalledOnce();
  });

  it("strips null bytes from JSON fields before database writes", async () => {
    const { service, tx } = makeHarness();

    await service.ingest(
      makePayload({
        rawPacket: {
          ...makePayload().rawPacket,
          payload: {
            ascii: `ok${String.fromCharCode(0)}bad`,
            nested: { [`bad${String.fromCharCode(0)}key`]: `bad${String.fromCharCode(0)}value` }
          }
        },
        metadata: { collector: `usr${String.fromCharCode(0)}c215` }
      })
    );

    expect(tx.deviceRawPacket.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payload: {
          ascii: "okbad",
          nested: { badkey: "badvalue" }
        }
      })
    });
    expect(tx.measurement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: { collector: "usrc215" }
      })
    });
  });

  it("quarantines REAL ingest for an unknown registration", async () => {
    const { service, prisma, tx, alerts } = makeHarness();
    prisma.device.findUnique.mockResolvedValueOnce(null);

    const result = await service.ingest(makePayload({ registration: "00099", parsed: { ...makePayload().parsed, deviceName: "00099" } }));

    expect(result).toMatchObject({
      status: "unknown_device",
      accepted: false,
      quarantineId: "quarantine-1",
      registration: "00099",
      reason: "real_device_not_registered"
    });
    expect(tx.measurement.create).not.toHaveBeenCalled();
    expect(prisma.ingestQuarantine.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        dataProfile: "REAL",
        registration: "00099",
        reason: "real_device_not_registered",
        status: "pending"
      })
    });
    expect(alerts.evaluateMeasurement).not.toHaveBeenCalled();
  });

  it("quarantines REAL ingest for a disabled device", async () => {
    const { service, prisma, tx, alerts } = makeHarness();
    prisma.device.findUnique.mockResolvedValueOnce(makeDevice({ enabled: false }));

    const result = await service.ingest(makePayload());

    expect(result).toMatchObject({
      status: "disabled_device",
      accepted: false,
      reason: "real_device_disabled"
    });
    expect(tx.measurement.create).not.toHaveBeenCalled();
    expect(prisma.ingestQuarantine.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        dataProfile: "REAL",
        registration: "00001",
        reason: "real_device_disabled"
      })
    });
    expect(alerts.evaluateMeasurement).not.toHaveBeenCalled();
  });

  it("quarantines REAL ingest for an archived device even when enabled is true", async () => {
    const { service, prisma, tx, alerts } = makeHarness();
    prisma.device.findUnique.mockResolvedValueOnce(makeDevice({ enabled: true, archivedAt: new Date("2026-05-10T00:00:00.000Z") }));

    const result = await service.ingest(makePayload());

    expect(result).toMatchObject({
      status: "disabled_device",
      accepted: false,
      reason: "real_device_disabled"
    });
    expect(tx.measurement.create).not.toHaveBeenCalled();
    expect(prisma.ingestQuarantine.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        dataProfile: "REAL",
        registration: "00001",
        reason: "real_device_disabled"
      })
    });
    expect(alerts.evaluateMeasurement).not.toHaveBeenCalled();
  });

  it("keeps DEMO auto-upsert behavior", async () => {
    const { service, prisma, tx } = makeHarness();

    const result = await service.ingest(makePayload({ dataProfile: "DEMO" }));

    expect(result).toMatchObject({ status: "accepted", accepted: true });
    expect(prisma.device.findUnique).not.toHaveBeenCalled();
    expect(tx.device.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { dataProfile_deviceName: { dataProfile: "DEMO", deviceName: "00001" } },
        create: expect.objectContaining({ dataProfile: "DEMO", deviceName: "00001" })
      })
    );
    expect(tx.measurement.create).toHaveBeenCalledOnce();
  });

  it("returns invalid_payload without writing when schema validation fails", async () => {
    const { service, prisma, tx, alerts } = makeHarness();

    const result = await service.ingest({ registration: "00001" });

    expect(result).toMatchObject({
      status: "invalid_payload",
      accepted: false,
      reason: "schema_validation_failed"
    });
    expect(prisma.device.findUnique).not.toHaveBeenCalled();
    expect(tx.measurement.create).not.toHaveBeenCalled();
    expect(prisma.ingestQuarantine.create).not.toHaveBeenCalled();
    expect(alerts.evaluateMeasurement).not.toHaveBeenCalled();
  });

  it("evaluates each affected device's latest measurement after profile imports", async () => {
    const { service, alerts, device } = makeHarness();
    const prisma = (service as any).prisma;
    prisma.exhibition = {
      upsert: vi.fn(async () => ({ id: "exhibition-1", dataProfile: "REAL", code: "EXH-1", name: "Exhibition 1", status: "active" }))
    };
    prisma.exhibitionZone = {
      upsert: vi.fn(async () => ({ id: "zone-1", exhibitionId: "exhibition-1", code: "ZONE-1", name: "Zone 1" }))
    };
    prisma.device.upsert = vi.fn(async () => device);
    prisma.measurement = {
      create: vi.fn(async () => makeMeasurement(device))
    };

    const result = await service.importProfileMeasurements({
      dataProfile: "REAL",
      rows: [
        {
          deviceName: "00001",
          displayName: "Device 00001",
          measuredAt,
          temperatureC: 23.1,
          humidityPercent: 44.5,
          source: "imported",
          parseVersion: "usr-c215-v1",
          exhibitionCode: "EXH-1",
          zoneCode: "ZONE-1"
        }
      ]
    });

    expect(result).toMatchObject({ imported: 1, duplicates: 0, rows: 1 });
    expect(alerts.evaluateLatestMeasurementForDevice).toHaveBeenCalledWith("device-1", "REAL");
  });

  it("does not evaluate alerts for duplicate profile import rows", async () => {
    const { service, alerts, device } = makeHarness();
    const prisma = (service as any).prisma;
    prisma.exhibition = {
      upsert: vi.fn(async () => null)
    };
    prisma.exhibitionZone = {
      upsert: vi.fn()
    };
    prisma.device.upsert = vi.fn(async () => device);
    prisma.measurement = {
      create: vi.fn(async () => {
        throw new Prisma.PrismaClientKnownRequestError("duplicate measurement", {
          code: "P2002",
          clientVersion: "test"
        });
      })
    };

    const result = await service.importProfileMeasurements({
      dataProfile: "REAL",
      rows: [
        {
          deviceName: "00001",
          measuredAt,
          temperatureC: 23.1,
          humidityPercent: 44.5,
          source: "imported",
          parseVersion: "usr-c215-v1"
        }
      ]
    });

    expect(result).toMatchObject({ imported: 0, duplicates: 1, rows: 1 });
    expect(alerts.evaluateLatestMeasurementForDevice).not.toHaveBeenCalled();
  });

  it("imports collector rows only from an allowlisted collector HTTP endpoint", async () => {
    const { service, tx } = makeHarness({
      COLLECTOR_IMPORT_ALLOWLIST: "http://127.0.0.1:8088/api",
      COLLECTOR_BASE_URL: "http://127.0.0.1:8088"
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          measurements: [
            {
              date: "2026-05-12",
              time: "11:00:00",
              deviceName: "00001",
              dehumidifySetpoint: 52,
              temperatureC: 23.1,
              humidityPercent: 51.7
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const result = await service.importFromCollector("http://127.0.0.1:8088/api/measurements", "REAL");

    expect(result).toMatchObject({ imported: 1, duplicates: 0, rejected: 0 });
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ redirect: "manual" }));
    expect(tx.measurement.create).toHaveBeenCalledOnce();
  });

  it("blocks collector imports to non-allowlisted metadata addresses before fetch", async () => {
    const { service } = makeHarness({
      COLLECTOR_IMPORT_ALLOWLIST: "http://127.0.0.1:8088"
    });
    const fetch = vi.spyOn(globalThis, "fetch");

    await expect(service.importFromCollector("http://169.254.169.254/latest/meta-data", "REAL")).rejects.toThrow("allowlisted");
    expect(fetch).not.toHaveBeenCalled();
  });
});

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { writeAuditLog } from "../common/audit.util";
import type { RequestUser } from "../common/current-user.decorator";
import { PrismaService } from "../prisma/prisma.service";

const CWA_SOURCE = "中央氣象署 Open Data";
const DEFAULT_CWA_STATION_ID = "467420";
const DEFAULT_CWA_STATION_NAME = "永康";
const DEFAULT_COUNTY = "臺南市";
const DEFAULT_TOWN = "永康區";

@Injectable()
export class WeatherService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {}

  stations() {
    return this.prisma.weatherStation.findMany({ orderBy: { name: "asc" } });
  }

  async currentOutdoorWeather(query?: { stationId?: string; county?: string; town?: string }) {
    const stationId = query?.stationId ?? DEFAULT_CWA_STATION_ID;
    const county = query?.county ?? DEFAULT_COUNTY;
    const town = query?.town ?? DEFAULT_TOWN;
    const key = this.cwaApiKey();
    if (!key) {
      return this.unavailable("CWA_API_KEY/CWA_OPEN_DATA_API_KEY is not configured", stationId, county, town, true);
    }
    try {
      const url = new URL("https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0001-001");
      url.searchParams.set("Authorization", key);
      url.searchParams.set("format", "JSON");
      url.searchParams.set("StationId", stationId);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`CWA status ${response.status}`);
      }
      const payload = (await response.json()) as any;
      const stationPayload = this.pickStation(payload, stationId, county, town);
      if (!stationPayload) {
        return this.unavailable("No CWA station payload for the configured default station", stationId, county, town);
      }
      const stationCode = stationPayload.StationId ?? stationId;
      const weatherElement = stationPayload.WeatherElement ?? {};
      const temperatureC = this.toFiniteNumber(weatherElement.AirTemperature);
      const humidityPercent = this.toFiniteNumber(weatherElement.RelativeHumidity);
      if (temperatureC === null || humidityPercent === null) {
        return this.unavailable("CWA station payload does not include temperature or relative humidity", stationCode, county, town);
      }
      const observedAt = new Date(stationPayload.ObsTime?.DateTime ?? Date.now());
      const station = await this.prisma.weatherStation.upsert({
        where: { provider_stationCode: { provider: "cwa", stationCode } },
        update: {
          name: stationPayload.StationName ?? stationCode,
          latitude: this.toFiniteNumber(stationPayload.GeoInfo?.Coordinates?.[0]?.StationLatitude),
          longitude: this.toFiniteNumber(stationPayload.GeoInfo?.Coordinates?.[0]?.StationLongitude),
          enabled: true
        },
        create: {
          provider: "cwa",
          stationCode,
          name: stationPayload.StationName ?? stationCode,
          latitude: this.toFiniteNumber(stationPayload.GeoInfo?.Coordinates?.[0]?.StationLatitude),
          longitude: this.toFiniteNumber(stationPayload.GeoInfo?.Coordinates?.[0]?.StationLongitude)
        }
      });
      const observation = await this.prisma.weatherObservation.upsert({
        where: { stationId_observedAt: { stationId: station.id, observedAt } },
        update: {
          temperatureC,
          humidityPercent,
          rainfallMm: this.toFiniteNumber(weatherElement.Now?.Precipitation),
          payload
        },
        create: {
          stationId: station.id,
          observedAt,
          temperatureC,
          humidityPercent,
          rainfallMm: this.toFiniteNumber(weatherElement.Now?.Precipitation),
          payload
        }
      });
      return {
        status: "ok" as const,
        source: CWA_SOURCE,
        provider: "cwa",
        location: { county, town },
        station: {
          id: station.id,
          stationCode: station.stationCode,
          name: station.name,
          latitude: station.latitude,
          longitude: station.longitude
        },
        observedAt: observation.observedAt,
        temperatureC: observation.temperatureC,
        humidityPercent: observation.humidityPercent,
        rainfallMm: observation.rainfallMm
      };
    } catch (error) {
      return this.unavailable(error instanceof Error ? error.message : "CWA request failed", stationId, county, town);
    }
  }

  async syncCwaOrFallback(user?: RequestUser) {
    const result = await this.currentOutdoorWeather();
    const station = result.station as { id?: string };
    await writeAuditLog(this.prisma, {
      userId: user?.id,
      action: "weather.sync",
      entityType: "weather_observation",
      entityId: station.id,
      after: { status: result.status, station: result.station, observedAt: result.observedAt }
    });
    return result;
  }

  observations(stationId?: string) {
    return this.prisma.weatherObservation.findMany({
      where: { stationId },
      include: { station: true },
      orderBy: { observedAt: "desc" },
      take: 200
    });
  }

  private pickStation(payload: any, stationId: string, county: string, town: string) {
    const stations = payload?.records?.Station;
    if (!Array.isArray(stations)) return null;
    return (
      stations.find((station) => station.StationId === stationId) ??
      stations.find((station) => {
        const geo = station.GeoInfo ?? {};
        const countyName = String(geo.CountyName ?? "");
        const townName = String(geo.TownName ?? "");
        return countyName === county && townName === town;
      }) ??
      null
    );
  }

  private toFiniteNumber(value: unknown): number | null {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > -90 ? numeric : null;
  }

  private cwaApiKey(): string | null {
    const keys = [this.config.get<string>("CWA_API_KEY"), this.config.get<string>("CWA_OPEN_DATA_API_KEY")];
    const key = keys.map((value) => value?.trim()).find((value): value is string => Boolean(value));
    if (!key || key.toLowerCase().startsWith("fake")) {
      return null;
    }
    return key;
  }

  private async unavailable(message: string, stationCode: string, county: string, town: string, requiresApiKey = false) {
    const cached = await this.prisma.weatherObservation.findFirst({
      where: { station: { provider: "cwa", stationCode } },
      include: { station: true },
      orderBy: { observedAt: "desc" }
    });
    return {
      status: "unavailable" as const,
      source: CWA_SOURCE,
      provider: "cwa",
      location: { county, town },
      station: cached?.station
        ? {
            id: cached.station.id,
            stationCode: cached.station.stationCode,
            name: cached.station.name,
            latitude: cached.station.latitude,
            longitude: cached.station.longitude
          }
        : { stationCode, name: stationCode === DEFAULT_CWA_STATION_ID ? DEFAULT_CWA_STATION_NAME : stationCode },
      observedAt: cached?.observedAt ?? null,
      temperatureC: cached?.temperatureC ?? null,
      humidityPercent: cached?.humidityPercent ?? null,
      rainfallMm: cached?.rainfallMm ?? null,
      error: message,
      requiresApiKey,
      cached: Boolean(cached)
    };
  }
}

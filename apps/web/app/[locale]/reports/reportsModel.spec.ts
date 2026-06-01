import { describe, expect, it } from "vitest";
import {
  buildCrossAnalysis,
  buildReportQueryParams,
  computeReportSummary,
  exportDisabledReason,
  formatReportClimateValue,
  hasSelectedReportDevices,
  isLargeReportQuery,
  type ReportDevice,
  type ReportRow
} from "./reportsModel";

const devices: ReportDevice[] = [
  {
    id: "device-1",
    deviceName: "00001",
    displayName: "Point 1",
    lastSeenAt: "2026-05-12T01:59:00.000Z",
    enabled: true
  },
  {
    id: "device-2",
    deviceName: "00002",
    displayName: "Point 2",
    lastSeenAt: "2026-05-12T01:00:00.000Z",
    enabled: true
  }
];

const rows: ReportRow[] = [
  {
    measuredAt: "2026-05-12T02:00:00.000Z",
    deviceId: "device-1",
    deviceName: "00001",
    displayName: "Point 1",
    temperatureC: 23.44,
    humidityPercent: 55.55,
    source: "real"
  },
  {
    measuredAt: "2026-05-12T02:00:00.000Z",
    deviceId: "device-2",
    deviceName: "00002",
    displayName: "Point 2",
    temperatureC: 24.45,
    humidityPercent: 57.35,
    source: "manual"
  }
];

describe("reportsModel", () => {
  it("builds reproducible multi-device report query parameters", () => {
    const params = buildReportQueryParams({
      start: "2026-05-12T01:00:00.000Z",
      end: "2026-05-12T02:00:00.000Z",
      interval: "1h",
      dataProfile: "DEMO",
      deviceIds: ["device-1", "device-2"],
      includeCompensated: true,
      includeSynthetic: false,
      timezone: "Asia/Taipei",
      exportContent: "chart-data-list",
      format: "pdf"
    });

    expect(params.getAll("deviceIds")).toEqual(["device-1", "device-2"]);
    expect(params.get("dataProfile")).toBe("DEMO");
    expect(params.get("timezone")).toBe("Asia/Taipei");
    expect(params.get("exportContent")).toBe("chart-data-list");
  });

  it("keeps report queries disabled until a device is selected", () => {
    expect(hasSelectedReportDevices(null)).toBe(false);
    expect(hasSelectedReportDevices({ deviceIds: [] })).toBe(false);
    expect(hasSelectedReportDevices({ deviceIds: ["device-1"] })).toBe(true);
    expect(hasSelectedReportDevices({ deviceId: "device-1" })).toBe(true);
  });

  it("uses normal 1-decimal rounding for visible and exported climate values", () => {
    expect(formatReportClimateValue(23.44)).toBe("23.4");
    expect(formatReportClimateValue(23.45)).toBe("23.5");
    expect(formatReportClimateValue(52.299999999)).toBe("52.3");
    expect(formatReportClimateValue(null)).toBe("-");
    expect(formatReportClimateValue(undefined)).toBe("-");
    expect(formatReportClimateValue(Number.NaN)).toBe("-");
  });

  it("builds a cross-analysis table without mixing device or source values", () => {
    const result = buildCrossAnalysis(rows);

    expect(result.devices.map((device) => device.key).sort()).toEqual(["device-1", "device-2"]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((row) => row.source).sort()).toEqual(["manual", "real"]);
    expect(result.rows.find((row) => row.source === "real")?.values["device-1"]?.[0]?.temperatureC).toBe(23.44);
    expect(result.rows.find((row) => row.source === "manual")?.values["device-2"]?.[0]?.temperatureC).toBe(24.45);
  });

  it("summarizes per-device quality states and flags offline devices", () => {
    const summary = computeReportSummary({
      rows,
      devices,
      selectedDeviceIds: ["device-1", "device-2"],
      start: new Date("2026-05-12T01:00:00.000Z"),
      end: new Date("2026-05-12T02:00:00.000Z"),
      interval: "1h",
      now: new Date("2026-05-12T02:01:00.000Z")
    });

    expect(summary.rowCount).toBe(2);
    expect(summary.deviceCount).toBe(2);
    expect(summary.perDevice.find((item) => item.deviceName === "00001")?.averageTemperature).toBe("23.4");
    expect(summary.perDevice.find((item) => item.deviceName === "00002")?.status).toBe("offline");
  });

  it("guards exports when reports are not trustworthy or ready", () => {
    expect(exportDisabledReason({ canExport: false, hasReportValues: true, isLoading: false, hasError: false, rowCount: 1 })).toBe("noPermission");
    expect(exportDisabledReason({ canExport: true, hasReportValues: true, isLoading: false, hasError: false, rowCount: 0 })).toBe("noData");
    expect(exportDisabledReason({ canExport: true, hasReportValues: true, isLoading: false, hasError: false, rowCount: 1 })).toBeNull();
  });

  it("flags large report queries before operators misread latency as failure", () => {
    expect(isLargeReportQuery(new Date("2026-01-01T00:00:00.000Z"), new Date("2026-02-15T00:00:00.000Z"), 2)).toBe(true);
    expect(isLargeReportQuery(new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-02T00:00:00.000Z"), 2)).toBe(false);
  });
});

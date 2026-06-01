import "reflect-metadata";
import { existsSync } from "node:fs";
import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { REPORT_PDF_CJK_FONT_MARKER, ReportsService } from "./reports.service";
import type { ReportRow } from "../measurements/measurements.service";

const row = {
  measuredAt: new Date("2026-05-12T02:00:00.000Z"),
  date: "2026-05-12",
  time: "02:00:00",
  deviceId: "device-1",
  exhibition: "Exhibition 1",
  zone: "Zone A",
  point: "Point 1",
  deviceName: "00001",
  displayName: "Point 1",
  dehumidifySetpoint: 51.25,
  temperatureC: 23.45,
  humidityPercent: 55.55,
  source: "real",
  dataProfile: "REAL",
  qualityFlags: []
} satisfies ReportRow;

const cjkFontCandidates = [
  "/System/Library/AssetsV2/com_apple_MobileAsset_Font7/eb257c12d1a51c8c661b89f30eec56cacf9b8987.asset/AssetData/STHEITI.ttf",
  "/System/Library/AssetsV2/com_apple_MobileAsset_Font7/3a9dbc8ddc8b85f43055a28fb5d551e905d43de2.asset/AssetData/LiHeiPro.ttf",
  "/System/Library/AssetsV2/com_apple_MobileAsset_Font7/62032b9b64a0e3a9121c50aeb2ed794e3e2c201f.asset/AssetData/Hei.ttf"
] as const;

function serviceWithRows(rows: ReportRow[]) {
  const measurementsService = {
    reportRows: vi.fn(async () => rows)
  };
  return {
    service: new ReportsService(measurementsService as never, {} as never),
    measurementsService
  };
}

function rowWith(overrides: Partial<ReportRow>): ReportRow {
  return { ...row, ...overrides };
}

function excelJsLoadBuffer(body: Buffer | string): Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0] {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as unknown as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0];
}

function testCjkFontPath(): string | undefined {
  return cjkFontCandidates.find((candidate) => existsSync(candidate));
}

async function withTestCjkFont<T>(callback: () => Promise<T>): Promise<T> {
  const original = process.env.PDF_CJK_FONT_PATH;
  const fontPath = testCjkFontPath();
  if (fontPath) {
    process.env.PDF_CJK_FONT_PATH = fontPath;
  }
  try {
    return await callback();
  } finally {
    if (original === undefined) {
      delete process.env.PDF_CJK_FONT_PATH;
    } else {
      process.env.PDF_CJK_FONT_PATH = original;
    }
  }
}

describe("ReportsService.export", () => {
  it("exports CSV metadata and normally rounded 1-decimal climate values", async () => {
    const { service } = serviceWithRows([row]);

    const result = await service.export(
      {
        start: new Date("2026-05-12T01:00:00.000Z"),
        end: new Date("2026-05-12T03:00:00.000Z"),
        interval: "raw",
        dataProfile: "REAL",
        deviceId: "device-1",
        format: "csv",
        timezone: "Asia/Taipei",
        exportContent: "data"
      },
      { id: "user-1", email: "operator@example.local", name: "Operator", roles: ["Operator"], permissions: ["reports:export"] }
    );

    expect(result.contentType).toBe("text/csv; charset=utf-8");
    expect(String(result.body)).toContain("\"Rounding rule\",\"temperature and humidity are rounded to exactly 1 decimal place using normal rounding\"");
    expect(String(result.body)).toContain("\"Humidity setpoint\"");
    expect(String(result.body)).toContain("\"Point 1 (00001)\"");
    expect(String(result.body)).toContain("\"51.3\",\"23.5\",\"55.6\"");
    expect(String(result.body)).not.toContain("23.45");
    expect(String(result.body)).not.toContain("55.55");
  });

  it("rejects empty exports instead of generating misleading files", async () => {
    const { service } = serviceWithRows([]);

    await expect(
      service.export({
        start: new Date("2026-05-12T01:00:00.000Z"),
        end: new Date("2026-05-12T03:00:00.000Z"),
        interval: "raw",
        dataProfile: "REAL",
        deviceId: "device-1",
        format: "csv"
      })
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects full-data exports without a selected device", async () => {
    const { service, measurementsService } = serviceWithRows([row]);

    await expect(
      service.export({
        start: new Date("2026-05-12T01:00:00.000Z"),
        end: new Date("2026-05-12T03:00:00.000Z"),
        interval: "raw",
        dataProfile: "REAL",
        format: "csv"
      })
    ).rejects.toThrow(BadRequestException);
    expect(measurementsService.reportRows).not.toHaveBeenCalled();
  });

  it("formats non-raw aggregation averages to exactly 1 decimal in exports", async () => {
    const { service } = serviceWithRows([
      rowWith({ temperatureC: 23.44, humidityPercent: 52.299999999, dehumidifySetpoint: 50.04 }),
      rowWith({ measuredAt: new Date("2026-05-12T02:05:00.000Z"), time: "02:05:00", temperatureC: 23.45, humidityPercent: 52.25, dehumidifySetpoint: 50.05 })
    ]);

    const result = await service.export({
      start: new Date("2026-05-12T01:00:00.000Z"),
      end: new Date("2026-05-12T03:00:00.000Z"),
      interval: "5m",
      dataProfile: "REAL",
      deviceIds: ["device-1"],
      format: "csv",
      exportContent: "data"
    });

    expect(String(result.body)).toContain("\"50.0\",\"23.4\",\"52.3\"");
    expect(String(result.body)).toContain("\"50.1\",\"23.5\",\"52.3\"");
  });

  it("neutralizes spreadsheet formulas in CSV and XLSX text cells", async () => {
    const formulaRow = rowWith({
      exhibition: "=HYPERLINK(\"http://evil.example\")",
      zone: "+SUM(1,1)",
      point: "-2+3",
      deviceName: "@cmd",
      source: "\tDDE"
    });
    const { service } = serviceWithRows([formulaRow]);

    const csv = await service.export({
      start: new Date("2026-05-12T01:00:00.000Z"),
      end: new Date("2026-05-12T03:00:00.000Z"),
      interval: "raw",
      dataProfile: "REAL",
      deviceIds: ["device-1"],
      format: "csv",
      exportContent: "data"
    });
    expect(String(csv.body)).toContain("\"'=HYPERLINK(\"\"http://evil.example\"\")\"");
    expect(String(csv.body)).toContain("\"'+SUM(1,1)\"");
    expect(String(csv.body)).toContain("\"'-2+3\"");
    expect(String(csv.body)).toContain("\"'@cmd\"");

    const xlsx = await service.export({
      start: new Date("2026-05-12T01:00:00.000Z"),
      end: new Date("2026-05-12T03:00:00.000Z"),
      interval: "raw",
      dataProfile: "REAL",
      deviceIds: ["device-1"],
      format: "xlsx",
      exportContent: "data"
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(excelJsLoadBuffer(xlsx.body));
    const sheet = workbook.getWorksheet("Data list");
    expect(sheet?.getRow(2).getCell(3).value).toBe("'=HYPERLINK(\"http://evil.example\")");
    expect(sheet?.getRow(2).getCell(4).value).toBe("'+SUM(1,1)");
    expect(sheet?.getRow(2).getCell(7).value).toBe("'@cmd");
  });

  it("localizes humidity setpoint in XLSX exports", async () => {
    const { service } = serviceWithRows([row]);

    const result = await service.export({
      start: new Date("2026-05-12T01:00:00.000Z"),
      end: new Date("2026-05-12T03:00:00.000Z"),
      interval: "raw",
      dataProfile: "REAL",
      deviceIds: ["device-1"],
      format: "xlsx",
      exportContent: "data",
      locale: "zh-TW",
      reportTitle: "圖表與報表"
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(excelJsLoadBuffer(result.body));
    const sheet = workbook.getWorksheet("資料清單");
    expect(sheet?.getRow(1).values).toEqual(expect.arrayContaining(["濕度設定值"]));
  });

  it("accepts chart-data-list PDF export requests with a CJK font and chart image payload", async () => {
    const rows = Array.from({ length: 80 }, (_, index) =>
      rowWith({
        measuredAt: new Date(Date.parse("2026-05-12T02:00:00.000Z") + index * 60_000),
        time: `02:${String(index % 60).padStart(2, "0")}:00`,
        deviceId: index % 2 ? "device-2" : "device-1",
        deviceName: index % 2 ? "00002" : "00001",
        displayName: index % 2 ? "Point 2" : "Point 1"
      })
    );
    const { service, measurementsService } = serviceWithRows(rows);
    const onePixelPng =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

    const result = await withTestCjkFont(() =>
      service.export({
        start: new Date("2026-05-12T01:00:00.000Z"),
        end: new Date("2026-05-12T03:00:00.000Z"),
        interval: "raw",
        dataProfile: "REAL",
        deviceIds: ["device-1", "device-2"],
        format: "pdf",
        timezone: "Asia/Taipei",
        exportContent: "chart-data-list",
        chartDataUrl: onePixelPng,
        locale: "zh-TW",
        reportTitle: "圖表與報表"
      })
    );

    expect(measurementsService.reportRows).toHaveBeenCalledWith(expect.objectContaining({ exportContent: "chart-data-list" }), undefined);
    expect(result.contentType).toBe("application/pdf");
    expect(Buffer.isBuffer(result.body)).toBe(true);
    expect((result.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");
    expect((result.body as Buffer).byteLength).toBeGreaterThan(3000);
    const pdfSource = (result.body as Buffer).toString("latin1");
    expect(pdfSource).toContain(REPORT_PDF_CJK_FONT_MARKER);
    expect(pdfSource).toMatch(/\/FontFile[23]?/);
    expect(pdfSource).toContain("/ToUnicode");
  });
});

import { existsSync } from "node:fs";
import { BadRequestException, Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { Prisma } from "@prisma/client";
import { formatClimateValue, isLocale, reportExportRequestSchema, REPORT_ROUNDING_RULE, roundClimateNumber, type Locale } from "@nmth/shared";
import type { z } from "zod";
import { MeasurementsService, type ReportRow } from "../measurements/measurements.service";
import { PrismaService } from "../prisma/prisma.service";
import { writeAuditLog } from "../common/audit.util";
import type { RequestUser } from "../common/current-user.decorator";

type ReportExportRequest = ReturnType<typeof reportExportRequestSchema.parse>;

type ReportExportMetadata = {
  title: string;
  range: string;
  granularity: string;
  dataProfile: string;
  timezone: string;
  generatedAt: string;
  units: string;
  roundingRule: string;
  devices: string[];
  exporter?: string;
  exportContent: string;
  rowCount: number;
};

const DATA_KEYS = [
  "date",
  "time",
  "exhibition",
  "zone",
  "point",
  "deviceId",
  "deviceName",
  "dehumidifySetpoint",
  "temperatureC",
  "humidityPercent",
  "source",
  "dataProfile",
  "qualityFlags"
] as const;

type DataKey = (typeof DATA_KEYS)[number];

type ReportExportLabels = {
  metadata: string;
  value: string;
  metadataSheet: string;
  dataList: string;
  chartTitle: string;
  chartMissing: string;
  reportTitle: string;
  reportTitleLabel: string;
  deviceList: string;
  dateRange: string;
  granularity: string;
  dataProfile: string;
  timezone: string;
  generatedAt: string;
  units: string;
  roundingRule: string;
  exportContent: string;
  dataRows: string;
  exporter: string;
  temperature: string;
  humidity: string;
  humiditySetpoint: string;
  machine: string;
  dataHeaders: Record<DataKey, string>;
};

type PdfDocumentInstance = InstanceType<typeof PDFDocument>;

export const REPORT_PDF_CJK_FONT_MARKER = "NMTH_REPORT_PDF_CJK_FONT";
export const REPORT_PDF_FONT_UNAVAILABLE = "NMTH_REPORT_PDF_FONT_UNAVAILABLE";
const PDF_CJK_FONT_NAME = "NMTH_REPORT_CJK";
const PDF_CHART_HEIGHT = 240;
const PDF_CHART_GAP = 14;
const PDF_DATA_ROW_HEIGHT = 32;
const REPORT_MAX_SYNC_EXPORT_ROWS = 50_000;
const REPORT_MAX_SYNC_PDF_ROWS = 2_000;
const REPORT_MAX_CHART_IMAGE_BYTES = 4 * 1024 * 1024;
const PDF_CJK_FONT_FALLBACK_PATHS = [
  "/System/Library/AssetsV2/com_apple_MobileAsset_Font7/eb257c12d1a51c8c661b89f30eec56cacf9b8987.asset/AssetData/STHEITI.ttf",
  "/System/Library/AssetsV2/com_apple_MobileAsset_Font7/3a9dbc8ddc8b85f43055a28fb5d551e905d43de2.asset/AssetData/LiHeiPro.ttf",
  "/System/Library/AssetsV2/com_apple_MobileAsset_Font7/62032b9b64a0e3a9121c50aeb2ed794e3e2c201f.asset/AssetData/Hei.ttf"
] as const;

const REPORT_EXPORT_LABELS: Record<Locale, ReportExportLabels> = {
  "zh-TW": {
    metadata: "中繼資料",
    value: "值",
    metadataSheet: "中繼資料",
    dataList: "資料清單",
    chartTitle: "曲線圖",
    chartMissing: "此次匯出要求未包含圖表圖片。",
    reportTitle: "圖表與報表",
    reportTitleLabel: "報表標題",
    deviceList: "設備清單",
    dateRange: "日期區間",
    granularity: "取樣間隔",
    dataProfile: "資料模式",
    timezone: "時區",
    generatedAt: "產生時間",
    units: "單位",
    roundingRule: "四捨五入規則",
    exportContent: "匯出內容",
    dataRows: "資料列數",
    exporter: "匯出者",
    temperature: "溫度",
    humidity: "濕度",
    humiditySetpoint: "濕度設定值",
    machine: "機器",
    dataHeaders: {
      date: "日期",
      time: "時間",
      exhibition: "展覽",
      zone: "區域",
      point: "點位",
      deviceId: "設備 ID",
      deviceName: "機器名稱",
      dehumidifySetpoint: "濕度設定值",
      temperatureC: "溫度 C",
      humidityPercent: "濕度 %",
      source: "資料來源",
      dataProfile: "資料模式",
      qualityFlags: "品質旗標"
    }
  },
  en: {
    metadata: "Metadata",
    value: "Value",
    metadataSheet: "Metadata",
    dataList: "Data list",
    chartTitle: "Trend Chart",
    chartMissing: "Chart image was not included in this export request.",
    reportTitle: "Charts & Reports",
    reportTitleLabel: "Report title",
    deviceList: "Device list",
    dateRange: "Date range",
    granularity: "Granularity",
    dataProfile: "Data profile",
    timezone: "Timezone",
    generatedAt: "Generated at",
    units: "Units",
    roundingRule: "Rounding rule",
    exportContent: "Export content",
    dataRows: "Data rows",
    exporter: "Exporter",
    temperature: "Temperature",
    humidity: "Humidity",
    humiditySetpoint: "Humidity setpoint",
    machine: "Machine",
    dataHeaders: {
      date: "Date",
      time: "Time",
      exhibition: "Exhibition",
      zone: "Zone",
      point: "Point",
      deviceId: "Device ID",
      deviceName: "Machine name",
      dehumidifySetpoint: "Humidity setpoint",
      temperatureC: "Temperature C",
      humidityPercent: "Humidity %",
      source: "Source",
      dataProfile: "Data profile",
      qualityFlags: "Quality flags"
    }
  },
  ja: {
    metadata: "メタデータ",
    value: "値",
    metadataSheet: "メタデータ",
    dataList: "データ一覧",
    chartTitle: "トレンドグラフ",
    chartMissing: "このエクスポート要求にはグラフ画像が含まれていません。",
    reportTitle: "グラフとレポート",
    reportTitleLabel: "レポート名",
    deviceList: "機器一覧",
    dateRange: "期間",
    granularity: "サンプリング間隔",
    dataProfile: "データプロファイル",
    timezone: "タイムゾーン",
    generatedAt: "生成日時",
    units: "単位",
    roundingRule: "丸め規則",
    exportContent: "エクスポート内容",
    dataRows: "データ行数",
    exporter: "エクスポート実行者",
    temperature: "温度",
    humidity: "湿度",
    humiditySetpoint: "湿度設定値",
    machine: "機器",
    dataHeaders: {
      date: "日付",
      time: "時刻",
      exhibition: "展示",
      zone: "エリア",
      point: "ポイント",
      deviceId: "機器 ID",
      deviceName: "機器名",
      dehumidifySetpoint: "湿度設定値",
      temperatureC: "温度 C",
      humidityPercent: "湿度 %",
      source: "データソース",
      dataProfile: "データプロファイル",
      qualityFlags: "品質フラグ"
    }
  }
};

@Injectable()
export class ReportsService {
  constructor(
    private readonly measurementsService: MeasurementsService,
    private readonly prisma: PrismaService
  ) {}

  async export(rawQuery: unknown, user?: RequestUser): Promise<{ contentType: string; filename: string; body: Buffer | string }> {
    const query = this.parseExportRequest(rawQuery);
    const rows = await this.measurementsService.reportRows(query, user);
    if (!rows.length) {
      throw new BadRequestException("No report data is available for the selected filters.");
    }
    if (rows.length > REPORT_MAX_SYNC_EXPORT_ROWS) {
      throw new BadRequestException(`Report export exceeds ${REPORT_MAX_SYNC_EXPORT_ROWS} rows. Narrow the range or use a background export job.`);
    }
    const labels = this.exportLabels(query.locale);
    const metadata = this.exportMetadata(query, rows, labels, user);
    const format = query.format ?? "csv";
    if (format === "xlsx") {
      return {
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename: "nmth-climate-report.xlsx",
        body: await this.toXlsx(rows, metadata, labels)
      };
    }
    if (format === "pdf") {
      if (rows.length > REPORT_MAX_SYNC_PDF_ROWS) {
        throw new BadRequestException(`PDF export exceeds ${REPORT_MAX_SYNC_PDF_ROWS} rows. Export CSV/XLSX or narrow the range.`);
      }
      return {
        contentType: "application/pdf",
        filename: "nmth-climate-report.pdf",
        body: await this.toPdf(rows, metadata, query, labels)
      };
    }
    return {
      contentType: "text/csv; charset=utf-8",
      filename: "nmth-climate-report.csv",
      body: this.toCsv(rows, metadata, labels)
    };
  }

  async createScheduledReport(input: { name: string; cron: string; recipients: unknown[]; parameters: unknown; locale?: string }, user?: RequestUser) {
    const report = await this.prisma.scheduledReport.create({
      data: {
        name: input.name,
        cron: input.cron,
        recipients: input.recipients as Prisma.InputJsonValue,
        parameters: input.parameters as Prisma.InputJsonValue,
        locale: input.locale ?? "zh-TW"
      }
    });
    await writeAuditLog(this.prisma, {
      userId: user?.id,
      action: "scheduled_report.create",
      entityType: "scheduled_report",
      entityId: report.id,
      after: report
    });
    return report;
  }

  private toCsv(rows: ReportRow[], metadata: ReportExportMetadata, labels: ReportExportLabels): string {
    const lines = [
      [labels.metadata, labels.value].map((value) => this.csvCell(value)).join(","),
      ...this.metadataPairs(metadata, labels).map((pair) => pair.map((value) => this.csvCell(value)).join(",")),
      "",
      DATA_KEYS.map((key) => this.csvCell(labels.dataHeaders[key])).join(",")
    ];
    for (const row of rows) {
      lines.push(
        DATA_KEYS
          .map((key) => {
            const value = this.exportCellValue(row, key);
            return this.csvCell(value);
          })
          .join(",")
      );
    }
    return `\uFEFF${lines.join("\n")}`;
  }

  private async toXlsx(rows: ReportRow[], metadata: ReportExportMetadata, labels: ReportExportLabels): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "NMTH Climate Monitor";
    const metadataSheet = workbook.addWorksheet(labels.metadataSheet);
    metadataSheet.columns = [
      { header: labels.metadata, key: "key", width: 24 },
      { header: labels.value, key: "value", width: 80 }
    ];
    this.metadataPairs(metadata, labels).forEach(([key, value]) =>
      metadataSheet.addRow({ key: this.spreadsheetSafeText(key), value: this.spreadsheetSafeText(value) })
    );
    metadataSheet.getRow(1).font = { bold: true };

    const sheet = workbook.addWorksheet(labels.dataList);
    sheet.columns = [
      { header: labels.dataHeaders.date, key: "date", width: 12 },
      { header: labels.dataHeaders.time, key: "time", width: 12 },
      { header: labels.dataHeaders.exhibition, key: "exhibition", width: 24 },
      { header: labels.dataHeaders.zone, key: "zone", width: 18 },
      { header: labels.dataHeaders.point, key: "point", width: 22 },
      { header: labels.dataHeaders.deviceId, key: "deviceId", width: 38 },
      { header: labels.dataHeaders.deviceName, key: "deviceName", width: 16 },
      { header: labels.dataHeaders.dehumidifySetpoint, key: "dehumidifySetpoint", width: 16 },
      { header: labels.dataHeaders.temperatureC, key: "temperatureC", width: 16 },
      { header: labels.dataHeaders.humidityPercent, key: "humidityPercent", width: 14 },
      { header: labels.dataHeaders.source, key: "source", width: 18 },
      { header: labels.dataHeaders.dataProfile, key: "dataProfile", width: 14 },
      { header: labels.dataHeaders.qualityFlags, key: "qualityFlags", width: 28 }
    ];
    rows.forEach((row) =>
      sheet.addRow({
        ...row,
        date: this.spreadsheetSafeText(row.date),
        time: this.spreadsheetSafeText(row.time),
        exhibition: this.spreadsheetSafeText(row.exhibition),
        zone: this.spreadsheetSafeText(row.zone),
        point: this.spreadsheetSafeText(row.point),
        deviceId: this.spreadsheetSafeText(row.deviceId),
        deviceName: this.spreadsheetSafeText(row.deviceName),
        source: this.spreadsheetSafeText(row.source),
        dataProfile: this.spreadsheetSafeText(row.dataProfile),
        dehumidifySetpoint: roundClimateNumber(row.dehumidifySetpoint) ?? undefined,
        temperatureC: roundClimateNumber(row.temperatureC) ?? undefined,
        humidityPercent: roundClimateNumber(row.humidityPercent) ?? undefined,
        qualityFlags: this.spreadsheetSafeText(JSON.stringify(row.qualityFlags ?? []))
      })
    );
    sheet.getRow(1).font = { bold: true };
    sheet.getColumn("dehumidifySetpoint").numFmt = "0.0";
    sheet.getColumn("temperatureC").numFmt = "0.0";
    sheet.getColumn("humidityPercent").numFmt = "0.0";
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }

  private async toPdf(rows: ReportRow[], metadata: ReportExportMetadata, query: ReportExportRequest, labels: ReportExportLabels): Promise<Buffer> {
    const cjkFontPath = this.resolveCjkFontPath();
    if (!cjkFontPath) {
      throw new BadRequestException({
        message: REPORT_PDF_FONT_UNAVAILABLE,
        code: REPORT_PDF_FONT_UNAVAILABLE
      });
    }
    const doc = new PDFDocument({ margin: 36, size: "A4" });
    const chunks: Buffer[] = [];
    const finished = new Promise<void>((resolve) => doc.on("end", resolve));
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.info.Producer = `${REPORT_PDF_CJK_FONT_MARKER}:${cjkFontPath}`;
    doc.registerFont(PDF_CJK_FONT_NAME, cjkFontPath);
    doc.font(PDF_CJK_FONT_NAME);
    doc.fontSize(16).text(metadata.title);
    doc.moveDown(0.4);
    if (query.exportContent === "chart-data-list") {
      this.drawPdfChartBlock(doc, query, labels);
    }
    this.ensurePdfSpace(doc, 96);
    doc.fontSize(8);
    for (const [key, value] of this.metadataPairs(metadata, labels)) {
      doc.text(`${key}: ${value}`);
    }
    doc.moveDown();
    this.ensurePdfSpace(doc, 36);
    doc.fontSize(11).text(labels.dataList, { underline: true });
    doc.moveDown(0.4);
    for (const row of rows) {
      this.drawPdfDataRow(doc, row, labels);
    }
    doc.end();
    await finished;
    return Buffer.concat(chunks);
  }

  private drawPdfChartBlock(doc: PdfDocumentInstance, query: ReportExportRequest, labels: ReportExportLabels): void {
    const chartImage = this.decodeImageDataUrl(query.chartDataUrl);
    const titleHeight = 18;
    const requiredHeight = chartImage ? titleHeight + PDF_CHART_HEIGHT + PDF_CHART_GAP : titleHeight + 28;
    this.ensurePdfSpace(doc, requiredHeight);
    doc.fontSize(11).text(labels.chartTitle, { underline: true });
    doc.moveDown(0.4);
    if (!chartImage) {
      doc.fontSize(9).text(labels.chartMissing);
      doc.moveDown();
      return;
    }

    const chartX = doc.page.margins.left;
    const chartY = doc.y;
    const chartWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    doc.save().rect(chartX, chartY, chartWidth, PDF_CHART_HEIGHT).fill("#ffffff").restore();
    doc.image(chartImage, chartX, chartY, {
      fit: [chartWidth, PDF_CHART_HEIGHT],
      align: "center",
      valign: "center"
    });
    doc.x = doc.page.margins.left;
    doc.y = chartY + PDF_CHART_HEIGHT + PDF_CHART_GAP;
  }

  private drawPdfDataRow(doc: PdfDocumentInstance, row: ReportRow, labels: ReportExportLabels): void {
    this.ensurePdfSpace(doc, PDF_DATA_ROW_HEIGHT);
    const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const time = row.time.length >= 5 ? row.time.slice(0, 5) : row.time;
    const contextLine = `${row.date} ${time}  ${row.exhibition ?? "-"}  ${row.displayName}  ${labels.machine} ${row.deviceName}`;
    const valueLine = `${labels.humiditySetpoint} ${formatClimateValue(row.dehumidifySetpoint, "-")} %RH  ${labels.temperature} ${formatClimateValue(row.temperatureC, "-")} C  ${labels.humidity} ${formatClimateValue(row.humidityPercent, "-")} %RH`;
    doc.fontSize(8.5).text(contextLine, {
      width: contentWidth,
      lineGap: 1
    });
    doc.fontSize(8.5).text(valueLine, {
      width: contentWidth,
      lineGap: 1
    });
    doc.moveDown(0.2);
  }

  private ensurePdfSpace(doc: PdfDocumentInstance, requiredHeight: number): void {
    const bottomY = doc.page.height - doc.page.margins.bottom;
    if (doc.y + requiredHeight > bottomY) {
      doc.addPage();
      doc.font(PDF_CJK_FONT_NAME);
      doc.x = doc.page.margins.left;
    }
  }

  private exportMetadata(query: ReportExportRequest, rows: ReportRow[], labels: ReportExportLabels, user?: RequestUser): ReportExportMetadata {
    const devices = Array.from(new Set(rows.map((row) => `${row.displayName} (${row.deviceName})`))).sort((a, b) => a.localeCompare(b));
    return {
      title: query.reportTitle ?? labels.reportTitle,
      range: `${query.start.toISOString()} - ${query.end.toISOString()}`,
      granularity: query.interval,
      dataProfile: query.dataProfile ?? rows[0]?.dataProfile ?? "-",
      timezone: query.timezone ?? "UTC",
      generatedAt: new Date().toISOString(),
      units: `${labels.temperature}=C; ${labels.humidity}=%RH; ${labels.humiditySetpoint}=%RH`,
      roundingRule: REPORT_ROUNDING_RULE,
      devices,
      exporter: user?.name || user?.email,
      exportContent: query.exportContent,
      rowCount: rows.length
    };
  }

  private metadataPairs(metadata: ReportExportMetadata, labels: ReportExportLabels): string[][] {
    return [
      [labels.reportTitleLabel, metadata.title],
      [labels.deviceList, metadata.devices.join("; ")],
      [labels.dateRange, metadata.range],
      [labels.granularity, metadata.granularity],
      [labels.dataProfile, metadata.dataProfile],
      [labels.timezone, metadata.timezone],
      [labels.generatedAt, metadata.generatedAt],
      [labels.units, metadata.units],
      [labels.roundingRule, metadata.roundingRule],
      [labels.exportContent, metadata.exportContent],
      [labels.dataRows, String(metadata.rowCount)],
      ...(metadata.exporter ? [[labels.exporter, metadata.exporter]] : [])
    ];
  }

  private parseExportRequest(rawQuery: unknown): z.infer<typeof reportExportRequestSchema> {
    if (!this.hasReportDeviceSelection(rawQuery)) {
      throw new BadRequestException({
        message: "Validation failed",
        issues: [{ path: ["deviceIds"], message: "NMTH_REPORT_REQUIRES_DEVICE_SELECTION" }]
      });
    }
    const result = reportExportRequestSchema.safeParse(rawQuery);
    if (!result.success) {
      throw new BadRequestException({
        message: "Validation failed",
        issues: result.error.issues
      });
    }
    return result.data;
  }

  private hasReportDeviceSelection(rawQuery: unknown): boolean {
    const query = rawQuery && typeof rawQuery === "object" ? (rawQuery as Record<string, unknown>) : {};
    const deviceId = typeof query.deviceId === "string" ? query.deviceId.trim() : "";
    const rawDeviceIds = query.deviceIds;
    const deviceIds = (Array.isArray(rawDeviceIds) ? rawDeviceIds : rawDeviceIds === undefined ? [] : [rawDeviceIds])
      .flatMap((value) => String(value).split(","))
      .map((value) => value.trim())
      .filter(Boolean);
    return Boolean(deviceId || deviceIds.length);
  }

  private exportCellValue(row: ReportRow, key: DataKey): unknown {
    if (key === "dehumidifySetpoint" || key === "temperatureC" || key === "humidityPercent") {
      return formatClimateValue(row[key]);
    }
    if (key === "qualityFlags") {
      return JSON.stringify(row.qualityFlags ?? []);
    }
    return row[key];
  }

  private exportLabels(locale: string | undefined): ReportExportLabels {
    return REPORT_EXPORT_LABELS[isLocale(locale) ? locale : "en"];
  }

  private resolveCjkFontPath(): string | null {
    const candidates = [process.env.PDF_CJK_FONT_PATH, ...PDF_CJK_FONT_FALLBACK_PATHS]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value));
    for (const candidate of candidates) {
      if (!existsSync(candidate)) {
        continue;
      }
      if (this.canLoadPdfFont(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  private canLoadPdfFont(fontPath: string): boolean {
    try {
      const doc = new PDFDocument({ autoFirstPage: false });
      doc.registerFont(PDF_CJK_FONT_NAME, fontPath);
      doc.font(PDF_CJK_FONT_NAME);
      doc.end();
      return true;
    } catch {
      return false;
    }
  }

  private csvCell(value: unknown): string {
    return `"${this.spreadsheetSafeText(value).replaceAll("\"", "\"\"")}"`;
  }

  private decodeImageDataUrl(value?: string): Buffer | null {
    const match = value?.match(/^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=]+)$/);
    if (!match?.[1] || !match[2]) {
      return null;
    }
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.byteLength > REPORT_MAX_CHART_IMAGE_BYTES) {
      throw new BadRequestException("Chart image is too large for PDF export");
    }
    const imageType = match[1];
    const isPng = imageType === "png" && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isJpeg = (imageType === "jpeg" || imageType === "jpg") && buffer[0] === 0xff && buffer[1] === 0xd8;
    return isPng || isJpeg ? buffer : null;
  }

  private spreadsheetSafeText(value: unknown): string {
    const text = String(value ?? "");
    return /^[=+\-@\t\r\n]/.test(text) ? `'${text}` : text;
  }
}

import { z } from "zod";
import { DATA_PROFILES, EXPORT_FORMATS, REPORT_EXPORT_CONTENTS, SAMPLING_INTERVALS, SOURCE_TYPES } from "../domain/constants.js";

export const REPORT_DEVICE_SELECTION_REQUIRED_MARKER = "NMTH_REPORT_REQUIRES_DEVICE_SELECTION";
export const REPORT_MAX_DEVICE_IDS = 50;
export const REPORT_RAW_MAX_DAYS = 31;
export const REPORT_AGGREGATE_MAX_DAYS = 366;

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  search: z.string().optional(),
  sort: z.string().optional(),
  order: z.enum(["asc", "desc"]).optional()
});

const optionalStringListSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const values = Array.isArray(value) ? value : [value];
  const normalized = values
    .flatMap((item) => String(item).split(","))
    .map((item) => item.trim())
    .filter(Boolean);
  return normalized.length ? Array.from(new Set(normalized)) : undefined;
}, z.array(z.string().min(1)).max(REPORT_MAX_DEVICE_IDS).optional());

const booleanQuerySchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  return value;
}, z.boolean());

const reportDeviceSelectionRefinement = (
  value: { deviceId?: string; deviceIds?: string[] },
  ctx: z.RefinementCtx
) => {
  const selectedIds = Array.from(new Set([...(value.deviceIds ?? []), ...(value.deviceId ? [value.deviceId] : [])].filter(Boolean)));
  if (!selectedIds.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["deviceIds"],
      message: REPORT_DEVICE_SELECTION_REQUIRED_MARKER
    });
  }
};

const reportResourceLimitRefinement = (
  value: { start: Date; end: Date; interval?: string },
  ctx: z.RefinementCtx
) => {
  const start = value.start.getTime();
  const end = value.end.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return;
  }
  if (end < start) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["end"],
      message: "Report end must be after start"
    });
    return;
  }
  const days = (end - start) / 86_400_000;
  const maxDays = value.interval === "raw" ? REPORT_RAW_MAX_DAYS : REPORT_AGGREGATE_MAX_DAYS;
  if (days > maxDays) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["end"],
      message: `Report range exceeds ${maxDays} days for ${value.interval ?? "raw"} interval`
    });
  }
};

const reportQueryBaseSchema = z.object({
  start: z.coerce.date(),
  end: z.coerce.date(),
  dataProfile: z.enum(DATA_PROFILES).optional(),
  exhibitionId: z.string().optional(),
  zoneId: z.string().optional(),
  deviceId: z.string().optional(),
  deviceIds: optionalStringListSchema,
  source: z.enum(SOURCE_TYPES).optional(),
  interval: z.enum(SAMPLING_INTERVALS).default("raw"),
  includeCompensated: booleanQuerySchema.default(true),
  includeSynthetic: booleanQuerySchema.default(false),
  format: z.enum(EXPORT_FORMATS).optional(),
  exportContent: z.enum(REPORT_EXPORT_CONTENTS).default("data"),
  timezone: z.string().max(80).optional()
});

const reportQueryRefinement = (
  value: z.infer<typeof reportQueryBaseSchema>,
  ctx: z.RefinementCtx
) => {
  reportDeviceSelectionRefinement(value, ctx);
  reportResourceLimitRefinement(value, ctx);
};

export const reportQuerySchema = reportQueryBaseSchema.superRefine(reportQueryRefinement);

export const reportExportRequestSchema = reportQueryBaseSchema
  .extend({
    chartDataUrl: z.string().startsWith("data:image/").max(8_000_000).optional(),
    locale: z.string().max(16).optional(),
    reportTitle: z.string().max(120).optional()
  })
  .superRefine(reportQueryRefinement);

export const highRiskConfirmationSchema = z.object({
  confirmationText: z.string().min(6),
  reason: z.string().min(3)
});

export type PaginationQuery = z.infer<typeof paginationSchema>;
export type ReportQuery = z.infer<typeof reportQuerySchema>;
export type ReportExportRequest = z.infer<typeof reportExportRequestSchema>;

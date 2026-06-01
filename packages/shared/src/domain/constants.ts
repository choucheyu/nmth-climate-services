export const SYSTEM_BRAND = "NMTH Climate Monitor";

export const SOURCE_TYPES = [
  "real",
  "imported",
  "compensated",
  "derived",
  "manual"
] as const;

export type MeasurementSource = (typeof SOURCE_TYPES)[number];

export const DATA_PROFILES = ["DEMO", "REAL"] as const;
export type DataProfile = (typeof DATA_PROFILES)[number];

export const ALERT_LEVELS = ["info", "warning", "critical"] as const;
export type AlertLevel = (typeof ALERT_LEVELS)[number];

export const POINT_STATUS = [
  "normal",
  "attention",
  "warning",
  "critical",
  "offline",
  "compensated",
  "no_data"
] as const;

export type PointStatus = (typeof POINT_STATUS)[number];

export const DEVICE_TYPES = ["showcase", "ambient", "storage", "other"] as const;
export type DevicePointType = (typeof DEVICE_TYPES)[number];

export const SAMPLING_INTERVALS = [
  "raw",
  "5m",
  "10m",
  "30m",
  "1h",
  "1d"
] as const;
export type SamplingInterval = (typeof SAMPLING_INTERVALS)[number];

export const EXPORT_FORMATS = ["csv", "xlsx", "pdf"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const REPORT_EXPORT_CONTENTS = ["data", "chart-data-list"] as const;
export type ReportExportContent = (typeof REPORT_EXPORT_CONTENTS)[number];

export const DEFAULT_PARSE_VERSION = "usr-c215-v1";

export const DESIGN_TOKENS = {
  colors: {
    primary: "#004EA2",
    primaryHover: "#0067C5",
    primarySoft: "#EAF3FB",
    surface: "#FFFFFF",
    background: "#F4F9FD",
    backgroundAlt: "#EBF3F5",
    border: "#D8E3EA",
    text: "#142033",
    muted: "#66798A",
    danger: "#E8374A",
    warning: "#D9822B",
    success: "#14855B",
    attention: "#2B78C5",
    offline: "#8A98A8"
  },
  chartPalette: ["#004EA2", "#2B78C5", "#23A6A0", "#7BAE3B", "#D9822B", "#E8374A"],
  radius: {
    sm: 4,
    md: 6,
    lg: 8,
    pill: 999
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48
  },
  shadow: {
    card: "0 8px 24px rgba(0, 78, 162, 0.08)",
    panel: "0 16px 42px rgba(20, 32, 51, 0.12)"
  },
  layout: {
    contentMaxWidth: 1440,
    shellPadding: 24,
    headerHeight: 64
  }
} as const;

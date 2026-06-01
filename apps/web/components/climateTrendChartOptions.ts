import { DESIGN_TOKENS, formatClimateValue, REPORT_HUMIDITY_AXIS, REPORT_TEMPERATURE_AXIS, roundClimateNumber } from "@nmth/shared";

export type TrendPoint = {
  measuredAt: string;
  temperatureC: number | null;
  humidityPercent: number | null;
  dehumidifySetpoint?: number | null;
  deviceId?: string;
  deviceName?: string;
  displayName?: string;
  source?: string;
  device?: { displayName?: string; deviceName?: string };
};

type ClimateTrendChartLabels = {
  temperature?: string;
  humidity?: string;
  setpoint?: string;
};

export const CLIMATE_TREND_AXIS_CONFIG_MARKER = "NMTH_TREND_AXIS_TEMP_0_35_5_HUMIDITY_0_70_10";
export type ClimateTrendChartAxisPreset = "auto" | "reports";
export type ClimateTrendChartSeriesMode = "aggregate" | "device-source";

export function createClimateTrendChartOption({
  data,
  axisPreset = "auto",
  seriesMode = "aggregate",
  labels = {},
  compact = false
}: {
  data: TrendPoint[];
  axisPreset?: ClimateTrendChartAxisPreset;
  seriesMode?: ClimateTrendChartSeriesMode;
  labels?: ClimateTrendChartLabels;
  compact?: boolean;
}) {
  const temperatureLabel = labels.temperature ?? "Temperature";
  const humidityLabel = labels.humidity ?? "Humidity";
  const setpointLabel = labels.setpoint ?? "Setpoint";
  const yAxis =
    axisPreset === "reports"
      ? [
          {
            type: "value",
            name: "C",
            min: REPORT_TEMPERATURE_AXIS.min,
            max: REPORT_TEMPERATURE_AXIS.max,
            interval: REPORT_TEMPERATURE_AXIS.interval,
            splitNumber: REPORT_TEMPERATURE_AXIS.tickCount - 1,
            axisLabel: { color: "#66798A" },
            splitLine: { lineStyle: { color: "#E5EEF4" } }
          },
          {
            type: "value",
            name: "%RH",
            min: REPORT_HUMIDITY_AXIS.min,
            max: REPORT_HUMIDITY_AXIS.max,
            interval: REPORT_HUMIDITY_AXIS.interval,
            splitNumber: REPORT_HUMIDITY_AXIS.tickCount - 1,
            axisLabel: { color: "#66798A" },
            splitLine: { show: false }
          }
        ]
      : [
          {
            type: "value",
            name: "C",
            axisLabel: { color: "#66798A" },
            splitLine: { lineStyle: { color: "#E5EEF4" } }
          },
          {
            type: "value",
            name: "%RH",
            axisLabel: { color: "#66798A" },
            splitLine: { show: false }
          }
        ];

  return {
    color: [...DESIGN_TOKENS.chartPalette],
    aria: { enabled: true, label: { description: CLIMATE_TREND_AXIS_CONFIG_MARKER } },
    tooltip: {
      confine: true,
      trigger: "axis",
      formatter: (params: unknown) =>
        formatTooltip(params, { temperatureLabel, humidityLabel, setpointLabel })
    },
    legend: compact
      ? { top: 0, type: "scroll", itemGap: 8, itemHeight: 6, itemWidth: 12, pageIconSize: 8, textStyle: { fontSize: 10 } }
      : { top: 0, type: "scroll" },
    grid: compact ? { top: 34, left: 34, right: 26, bottom: 28 } : { top: axisPreset === "reports" ? 62 : 42, left: 46, right: 44, bottom: 42 },
    xAxis: {
      type: "time",
      axisLine: { lineStyle: { color: "#BFD3DF" } },
      axisLabel: compact ? { color: "#66798A", fontSize: 10, hideOverlap: true } : { color: "#66798A" }
    },
    yAxis,
    dataZoom: compact ? [{ type: "inside" }] : [{ type: "inside" }, { type: "slider", height: 22, bottom: 8 }],
    series:
      seriesMode === "device-source"
        ? createDeviceSourceSeries(data, { temperatureLabel, humidityLabel, setpointLabel })
        : createAggregateSeries(data, { temperatureLabel, humidityLabel, setpointLabel })
  };
}

function createAggregateSeries(
  data: TrendPoint[],
  labels: { temperatureLabel: string; humidityLabel: string; setpointLabel: string }
) {
  return [
    {
      name: labels.temperatureLabel,
      type: "line",
      smooth: true,
      symbol: "none",
      yAxisIndex: 0,
      data: data.map((item) => [item.measuredAt, climateSeriesValue(item.temperatureC)])
    },
    {
      name: labels.humidityLabel,
      type: "line",
      smooth: true,
      symbol: "none",
      yAxisIndex: 1,
      data: data.map((item) => [item.measuredAt, climateSeriesValue(item.humidityPercent)])
    },
    {
      name: labels.setpointLabel,
      type: "line",
      smooth: true,
      symbol: "none",
      lineStyle: { type: "dashed" },
      yAxisIndex: 1,
      data: data.map((item) => [item.measuredAt, climateSeriesValue(item.dehumidifySetpoint)])
    }
  ];
}

function createDeviceSourceSeries(
  data: TrendPoint[],
  labels: { temperatureLabel: string; humidityLabel: string; setpointLabel: string }
) {
  const groups = new Map<string, TrendPoint[]>();
  for (const item of data) {
    const label = deviceSourceLabel(item);
    groups.set(label, [...(groups.get(label) ?? []), item]);
  }
  return Array.from(groups.entries()).flatMap(([label, points]) => {
    const prefix = `${label} - `;
    const series: Array<Record<string, unknown>> = [
      {
        name: `${prefix}${labels.temperatureLabel}`,
        type: "line",
        smooth: true,
        symbol: "none",
        yAxisIndex: 0,
        data: points.map((item) => [item.measuredAt, climateSeriesValue(item.temperatureC)])
      },
      {
        name: `${prefix}${labels.humidityLabel}`,
        type: "line",
        smooth: true,
        symbol: "none",
        yAxisIndex: 1,
        data: points.map((item) => [item.measuredAt, climateSeriesValue(item.humidityPercent)])
      }
    ];
    if (points.some((item) => item.dehumidifySetpoint !== null && item.dehumidifySetpoint !== undefined)) {
      series.push({
        name: `${prefix}${labels.setpointLabel}`,
        type: "line",
        smooth: true,
        symbol: "none",
        lineStyle: { type: "dashed" },
        yAxisIndex: 1,
        data: points.map((item) => [item.measuredAt, climateSeriesValue(item.dehumidifySetpoint)])
      });
    }
    return series;
  });
}

function deviceSourceLabel(item: TrendPoint): string {
  const deviceLabel = item.displayName ?? item.device?.displayName ?? item.deviceName ?? item.device?.deviceName ?? item.deviceId ?? "Device";
  return item.source ? `${deviceLabel} / ${item.source}` : deviceLabel;
}

function climateSeriesValue(value: unknown): number | null {
  return roundClimateNumber(value);
}

function formatTooltip(
  params: unknown,
  labels: { temperatureLabel: string; humidityLabel: string; setpointLabel: string }
): string {
  const items = Array.isArray(params) ? params : params ? [params] : [];
  const first = items[0] as { axisValueLabel?: string; value?: unknown } | undefined;
  const title = escapeHtml(first?.axisValueLabel ?? tooltipTimeLabel(first?.value));
  const lines = items.map((item) => formatTooltipItem(item, labels));
  return [title, ...lines].filter(Boolean).join("<br/>");
}

function formatTooltipItem(
  item: unknown,
  labels: { temperatureLabel: string; humidityLabel: string; setpointLabel: string }
): string {
  const param = item as { marker?: string; seriesName?: string; value?: unknown };
  const rawValue = Array.isArray(param.value) ? param.value[1] : param.value;
  const formatted = formatClimateValue(rawValue, "-");
  const unit = tooltipUnit(param.seriesName ?? "", labels);
  const value = formatted === "-" ? formatted : `${formatted}${unit}`;
  return `${param.marker ?? ""}${escapeHtml(param.seriesName ?? "")}: ${escapeHtml(value)}`;
}

function tooltipUnit(
  seriesName: string,
  labels: { temperatureLabel: string; humidityLabel: string; setpointLabel: string }
): string {
  if (seriesName.endsWith(labels.temperatureLabel)) {
    return " C";
  }
  if (seriesName.endsWith(labels.humidityLabel) || seriesName.endsWith(labels.setpointLabel)) {
    return " %RH";
  }
  return "";
}

function tooltipTimeLabel(value: unknown): string {
  if (Array.isArray(value)) {
    return String(value[0] ?? "");
  }
  return "";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    };
    return map[char] ?? char;
  });
}

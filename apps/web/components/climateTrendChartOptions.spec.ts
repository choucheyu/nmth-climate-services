import { describe, expect, it } from "vitest";
import { REPORT_HUMIDITY_AXIS, REPORT_TEMPERATURE_AXIS } from "@nmth/shared";
import { CLIMATE_TREND_AXIS_CONFIG_MARKER, createClimateTrendChartOption } from "./climateTrendChartOptions";

describe("createClimateTrendChartOption", () => {
  it("uses aligned commercial Reports axes without changing the default chart mode", () => {
    const reportsOption = createClimateTrendChartOption({ data: [], axisPreset: "reports" }) as any;
    expect(reportsOption.yAxis[0]).toMatchObject({
      min: REPORT_TEMPERATURE_AXIS.min,
      max: REPORT_TEMPERATURE_AXIS.max,
      interval: REPORT_TEMPERATURE_AXIS.interval,
      splitNumber: REPORT_TEMPERATURE_AXIS.tickCount - 1
    });
    expect(reportsOption.yAxis[1]).toMatchObject({
      min: REPORT_HUMIDITY_AXIS.min,
      max: REPORT_HUMIDITY_AXIS.max,
      interval: REPORT_HUMIDITY_AXIS.interval,
      splitNumber: REPORT_HUMIDITY_AXIS.tickCount - 1
    });
    expect(reportsOption.aria.label.description).toBe(CLIMATE_TREND_AXIS_CONFIG_MARKER);

    const defaultOption = createClimateTrendChartOption({ data: [] }) as any;
    expect(defaultOption.yAxis[0].min).toBeUndefined();
    expect(defaultOption.yAxis[1].max).toBeUndefined();
  });

  it("separates report series by device and source", () => {
    const option = createClimateTrendChartOption({
      axisPreset: "reports",
      seriesMode: "device-source",
      data: [
        {
          measuredAt: "2026-05-12T02:00:00.000Z",
          deviceId: "device-1",
          deviceName: "00001",
          displayName: "Point 1",
          source: "real",
          temperatureC: 23.4,
          humidityPercent: 55.2
        },
        {
          measuredAt: "2026-05-12T02:00:00.000Z",
          deviceId: "device-2",
          deviceName: "00002",
          displayName: "Point 2",
          source: "manual",
          temperatureC: 24.1,
          humidityPercent: 57.3
        }
      ]
    }) as any;

    expect(option.series.map((series: any) => series.name)).toEqual(
      expect.arrayContaining([
        "Point 1 / real - Temperature",
        "Point 1 / real - Humidity",
        "Point 2 / manual - Temperature",
        "Point 2 / manual - Humidity"
      ])
    );
  });

  it("formats chart data and tooltip climate values to exactly 1 decimal", () => {
    const option = createClimateTrendChartOption({
      data: [
        {
          measuredAt: "2026-05-12T02:00:00.000Z",
          temperatureC: 23.44,
          humidityPercent: 52.299999999,
          dehumidifySetpoint: 51.45
        }
      ],
      labels: { temperature: "溫度", humidity: "濕度", setpoint: "濕度設定值" }
    }) as any;

    expect(option.series[0].data[0][1]).toBe(23.4);
    expect(option.series[1].data[0][1]).toBe(52.3);
    expect(option.series[2].data[0][1]).toBe(51.5);
    expect(
      option.tooltip.formatter([
        { axisValueLabel: "2026-05-12 10:00", marker: "", seriesName: "溫度", value: ["2026-05-12T02:00:00.000Z", 23.44] },
        { marker: "", seriesName: "濕度", value: ["2026-05-12T02:00:00.000Z", 52.299999999] },
        { marker: "", seriesName: "濕度設定值", value: ["2026-05-12T02:00:00.000Z", Number.NaN] }
      ])
    ).toContain("溫度: 23.4 C");
    expect(
      option.tooltip.formatter([
        { axisValueLabel: "2026-05-12 10:00", marker: "", seriesName: "溫度", value: ["2026-05-12T02:00:00.000Z", 23.45] }
      ])
    ).toContain("溫度: 23.5 C");
  });
});

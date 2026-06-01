"use client";

import * as echarts from "echarts";
import type { ECharts } from "echarts";
import { useEffect, useMemo, useRef } from "react";
import {
  createClimateTrendChartOption,
  type ClimateTrendChartAxisPreset,
  type ClimateTrendChartSeriesMode,
  type TrendPoint
} from "./climateTrendChartOptions";
import { useResponsiveMode } from "../lib/responsive";

export function ClimateTrendChart({
  data,
  height = 320,
  resizeKey,
  axisPreset = "auto",
  seriesMode = "aggregate",
  labels,
  onChartReady,
  compact,
}: {
  data: TrendPoint[];
  height?: number;
  resizeKey?: string | number;
  axisPreset?: ClimateTrendChartAxisPreset;
  seriesMode?: ClimateTrendChartSeriesMode;
  labels?: {
    temperature?: string;
    humidity?: string;
    setpoint?: string;
  };
  onChartReady?: (instance: unknown) => void;
  compact?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ECharts | null>(null);
  const onChartReadyRef = useRef(onChartReady);
  const { isMobile } = useResponsiveMode();
  const compactMode = compact ?? isMobile;
  const chartHeight = compactMode ? Math.min(height, 300) : height;
  const option = useMemo(
    () => createClimateTrendChartOption({ data, axisPreset, seriesMode, labels, compact: compactMode }),
    [axisPreset, compactMode, data, labels, seriesMode],
  );

  useEffect(() => {
    onChartReadyRef.current = onChartReady;
  }, [onChartReady]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    const instance = chartRef.current ?? echarts.init(containerRef.current);
    chartRef.current = instance;
    onChartReadyRef.current?.(instance);
    return () => {
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, true, true);
  }, [option]);

  useEffect(() => {
    const resize = () => chartRef.current?.resize();
    resize();
    const animationFrame = window.requestAnimationFrame(resize);
    const timeout = window.setTimeout(resize, 260);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(timeout);
    };
  }, [resizeKey]);

  return <div ref={containerRef} style={{ height: chartHeight, width: "100%" }} />;
}

"use client";

import {
  Button,
  Card,
  Col,
  Empty,
  Row,
  Select,
  Space,
  Statistic,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, ScreenShare, Thermometer, Waves } from "lucide-react";
import { formatClimateValue } from "@nmth/shared";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../../../components/AppShell";
import { AutoRefreshStatus } from "../../../components/AutoRefreshStatus";
import { ClimateTrendChart } from "../../../components/ClimateTrendChart";
import { FloorPlanDashboard } from "../../../components/FloorPlanDashboard";
import { MetricCard } from "../../../components/MetricCard";
import { PageHeader } from "../../../components/PageHeader";
import { apiFetch } from "../../../lib/api";
import {
  newestTimestamp,
  useAutoRefreshControl,
} from "../../../lib/autoRefresh";
import { RequirePermission, usePermissions } from "../../../lib/permissions";
import { useResponsiveMode } from "../../../lib/responsive";

const DASHBOARD_OVERVIEW_REFRESH_MS = 30_000;
const DASHBOARD_TREND_REFRESH_MS = 60_000;
const DASHBOARD_WEATHER_REFRESH_MS = 15 * 60_000;
const DASHBOARD_STRUCTURE_STALE_MS = 10 * 60_000;
const DASHBOARD_STALE_WARNING_MS = 2 * 60_000;

export default function DashboardPage() {
  const t = useTranslations();
  const permissions = usePermissions();
  const { isMobile, isTabletPortrait } = useResponsiveMode();
  const isCompactFloorPlanControls = isMobile || isTabletPortrait;
  const canManageFloorPlans = permissions.hasPermission("floorplans:manage");
  const [exhibitionId, setExhibitionId] = useState<string>();
  const [deviceId, setDeviceId] = useState<string>();
  const [selectedFloorPlanId, setSelectedFloorPlanId] = useState<string>();
  const [selectedVersionId, setSelectedVersionId] = useState<string>();
  const selectedExhibitionId = exhibitionId;
  const autoRefresh = useAutoRefreshControl({
    storageKey: "nmth.dashboard.autoRefresh",
  });
  const exhibitions = useQuery({
    queryKey: ["exhibitions", "switcher"],
    queryFn: () =>
      apiFetch<any>("/exhibitions?page=1&pageSize=50&status=active"),
    retry: 1,
    refetchOnWindowFocus: false,
    staleTime: DASHBOARD_STRUCTURE_STALE_MS,
  });
  const overview = useQuery({
    queryKey: ["overview", selectedExhibitionId],
    queryFn: () =>
      apiFetch<any>(
        `/measurements/overview?exhibitionId=${selectedExhibitionId}`,
      ),
    retry: 1,
    enabled: Boolean(selectedExhibitionId),
    ...autoRefresh.queryOptions(
      DASHBOARD_OVERVIEW_REFRESH_MS,
      Boolean(selectedExhibitionId),
    ),
  });
  const trend = useQuery({
    queryKey: ["trend-24h", selectedExhibitionId, deviceId],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("exhibitionId", selectedExhibitionId ?? "");
      if (deviceId) params.set("deviceId", deviceId);
      return apiFetch<any[]>(`/measurements/trend-24h?${params.toString()}`);
    },
    retry: 1,
    enabled: Boolean(selectedExhibitionId && deviceId),
    ...autoRefresh.queryOptions(
      DASHBOARD_TREND_REFRESH_MS,
      Boolean(selectedExhibitionId && deviceId),
    ),
  });
  const weather = useQuery({
    queryKey: ["weather", "current", "tainan-annan"],
    queryFn: () => apiFetch<any>("/weather/current"),
    retry: 1,
    staleTime: DASHBOARD_WEATHER_REFRESH_MS,
    ...autoRefresh.queryOptions(DASHBOARD_WEATHER_REFRESH_MS),
  });
  const floorPlans = useQuery({
    queryKey: ["floor-plans", selectedExhibitionId],
    queryFn: () =>
      apiFetch<any[]>(`/floor-plans?exhibitionId=${selectedExhibitionId}`),
    retry: 1,
    enabled: Boolean(selectedExhibitionId),
    refetchOnWindowFocus: false,
    staleTime: DASHBOARD_STRUCTURE_STALE_MS,
  });
  const floorPlanTelemetry = useQuery({
    queryKey: ["measurements", "latest", selectedExhibitionId],
    queryFn: () =>
      apiFetch<any>(`/measurements/latest?exhibitionId=${selectedExhibitionId}`),
    retry: 1,
    enabled: Boolean(selectedExhibitionId),
    ...autoRefresh.queryOptions(
      DASHBOARD_OVERVIEW_REFRESH_MS,
      Boolean(selectedExhibitionId),
    ),
  });

  const activeExhibitions = useMemo(
    () => (exhibitions.data?.items ?? []) as any[],
    [exhibitions.data?.items],
  );
  const summary = overview.data?.summary ?? {};
  const devices = useMemo(
    () => overview.data?.devices ?? [],
    [overview.data?.devices],
  );
  const deviceOptions = devices.map((device: any) => ({
    value: device.id,
    label: `${device.deviceName} - ${device.displayName}`,
  }));
  const defaultFloorPlan =
    floorPlans.data?.find(
      (floorPlan: any) =>
        (floorPlan.points?.length ?? 0) > 0 &&
        (floorPlan.activeVersion?.pdfUrl ||
          floorPlan.activeVersion?.renderedImageUrl ||
          floorPlan.activeVersion?.fileUrl ||
          floorPlan.activeVersionId),
    ) ??
    floorPlans.data?.find(
      (floorPlan: any) =>
        floorPlan.activeVersion?.pdfUrl ||
        floorPlan.activeVersion?.renderedImageUrl ||
        floorPlan.activeVersion?.fileUrl ||
        floorPlan.activeVersionId,
    ) ??
    floorPlans.data?.[0];
  const activeFloorPlan =
    floorPlans.data?.find(
      (floorPlan: any) => floorPlan.id === selectedFloorPlanId,
    ) ?? defaultFloorPlan;
  const floorPlanOptions = (floorPlans.data ?? []).map((floorPlan: any) => ({
    value: floorPlan.id,
    label: `${floorPlan.exhibition?.name ?? "-"} / ${floorPlan.name}`,
  }));
  const defaultFloorPlanVersion =
    activeFloorPlan?.activeVersion ??
    activeFloorPlan?.versions?.find(
      (version: any) => version.id === activeFloorPlan?.activeVersionId,
    ) ??
    activeFloorPlan?.versions?.[0];
  const activeFloorPlanVersion =
    activeFloorPlan?.versions?.find(
      (version: any) => version.id === selectedVersionId,
    ) ?? defaultFloorPlanVersion;
  const floorPlanPdfUrl =
    activeFloorPlanVersion?.pdfUrl ?? activeFloorPlanVersion?.fileUrl ?? null;
  const floorPlanRenderedImageUrl =
    activeFloorPlanVersion?.renderedImageUrl ?? null;
  const latestTelemetryByDevice = useMemo(
    () =>
      new Map(
        ((floorPlanTelemetry.data?.items ?? []) as any[]).map((item) => [
          item.deviceId,
          item,
        ]),
      ),
    [floorPlanTelemetry.data?.items],
  );
  const points = useMemo(
    () =>
      ((activeFloorPlan?.points ?? []) as any[])
        .filter(
          (point: any) =>
            !point.versionId || point.versionId === activeFloorPlanVersion?.id,
        )
        .map((point: any) => {
          const telemetry = point.device?.id
            ? latestTelemetryByDevice.get(point.device.id)
            : null;
          if (!telemetry || !point.device) {
            return point;
          }
          const latestMeasurement = telemetry.latestMeasurement ?? null;
          const currentAlerts =
            telemetry.currentAlerts ?? telemetry.alerts ?? point.device.alerts;
          return {
            ...point,
            device: {
              ...point.device,
              lastSeenAt: telemetry.lastSeenAt ?? point.device.lastSeenAt,
              latestMeasurement,
              measurements: latestMeasurement ? [latestMeasurement] : [],
              alerts: currentAlerts,
              currentAlerts,
            },
          };
        }),
    [
      activeFloorPlan?.points,
      activeFloorPlanVersion?.id,
      latestTelemetryByDevice,
    ],
  );
  const floorPlanVersionOptions = (activeFloorPlan?.versions ?? []).map(
    (version: any) => ({
      value: version.id,
      label: `${t("app.version")} ${version.version}${version.id === activeFloorPlan?.activeVersionId ? ` / ${t("floorPlan.activeVersion")}` : ""}`,
    }),
  );
  const hasFloorPlanControls =
    floorPlanOptions.length > 1 || Boolean(activeFloorPlan?.versions?.length);
  const weatherData = weather.data;
  const weatherOk = weatherData?.status === "ok";
  const dashboardLastUpdatedAt = newestTimestamp([
    overview.dataUpdatedAt,
    floorPlanTelemetry.dataUpdatedAt,
    trend.dataUpdatedAt,
    weather.dataUpdatedAt,
  ]);
  const dashboardHasRefreshError =
    overview.isError ||
    floorPlanTelemetry.isError ||
    trend.isError ||
    weather.isError;
  const dashboardIsFetching =
    overview.isFetching ||
    floorPlanTelemetry.isFetching ||
    trend.isFetching ||
    weather.isFetching;

  useEffect(() => {
    if (!activeExhibitions.length) {
      setExhibitionId(undefined);
      setDeviceId(undefined);
      setSelectedFloorPlanId(undefined);
      setSelectedVersionId(undefined);
      return;
    }
    if (
      !exhibitionId ||
      !activeExhibitions.some((item) => item.id === exhibitionId)
    ) {
      setExhibitionId(activeExhibitions[0]?.id);
      setDeviceId(undefined);
      setSelectedFloorPlanId(undefined);
      setSelectedVersionId(undefined);
    }
  }, [activeExhibitions, exhibitionId]);

  useEffect(() => {
    if (!activeFloorPlan) {
      setSelectedVersionId(undefined);
      return;
    }
    const validVersion = activeFloorPlan.versions?.some(
      (version: any) => version.id === selectedVersionId,
    );
    if (!selectedVersionId || !validVersion) {
      setSelectedVersionId(defaultFloorPlanVersion?.id);
    }
  }, [activeFloorPlan, defaultFloorPlanVersion?.id, selectedVersionId]);

  useEffect(() => {
    if (!floorPlans.data?.length) {
      setSelectedFloorPlanId(undefined);
      return;
    }
    const validFloorPlan = floorPlans.data.some(
      (floorPlan: any) => floorPlan.id === selectedFloorPlanId,
    );
    if (!selectedFloorPlanId || !validFloorPlan) {
      setSelectedFloorPlanId(defaultFloorPlan?.id);
    }
  }, [defaultFloorPlan?.id, floorPlans.data, selectedFloorPlanId]);

  useEffect(() => {
    if (!devices.length) {
      setDeviceId(undefined);
      return;
    }
    if (!deviceId || !devices.some((device: any) => device.id === deviceId)) {
      setDeviceId(devices[0].id);
    }
  }, [deviceId, devices]);

  async function refreshAll() {
    await Promise.all([
      overview.refetch(),
      trend.refetch(),
      floorPlanTelemetry.refetch(),
      floorPlans.refetch(),
      exhibitions.refetch(),
      weather.refetch(),
    ]);
  }

  async function toggleKiosk() {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  }

  return (
    <AppShell>
      <RequirePermission permission="dashboard:read">
        <PageHeader
        eyebrow="Climate Operations"
        title={t("nav.dashboard")}
        actions={
          <>
            <AutoRefreshStatus
              enabled={autoRefresh.autoRefreshEnabled}
              intervalMs={DASHBOARD_OVERVIEW_REFRESH_MS}
              isError={dashboardHasRefreshError}
              isFetching={dashboardIsFetching}
              isPaused={
                autoRefresh.autoRefreshEnabled && !autoRefresh.isVisible
              }
              isStale={autoRefresh.isTimestampStale(
                dashboardLastUpdatedAt,
                DASHBOARD_STALE_WARNING_MS,
              )}
              lastUpdatedAt={dashboardLastUpdatedAt}
              onEnabledChange={autoRefresh.setAutoRefreshEnabled}
            />
            <Tag>{overview.data?.dataProfile ?? "REAL"}</Tag>
            <Button
              icon={<RefreshCw size={15} />}
              onClick={() => void refreshAll()}
            >
              {t("app.refresh")}
            </Button>
            <Button
              icon={<ScreenShare size={15} />}
              onClick={() => void toggleKiosk()}
            >
              {t("dashboard.kioskMode")}
            </Button>
          </>
        }
      />

        {!activeExhibitions.length && !exhibitions.isLoading ? (
        <Empty description={t("dashboard.noActiveExhibitions")} />
      ) : (
        <Tabs
          tabBarGutter={isMobile ? 8 : undefined}
          activeKey={selectedExhibitionId}
          onChange={(value) => {
            setExhibitionId(value);
            setDeviceId(undefined);
            setSelectedFloorPlanId(undefined);
            setSelectedVersionId(undefined);
          }}
          items={activeExhibitions.map((exhibition) => ({
            key: exhibition.id,
            label: exhibition.name,
            children:
              exhibition.id === selectedExhibitionId ? (
                <>
                  <Row gutter={[16, 16]} style={{ marginBottom: 18 }}>
                    <Col xs={24} sm={12} lg={6}>
                      <MetricCard
                        title={t("dashboard.normal")}
                        value={summary.normal ?? 0}
                        status="normal"
                      />
                    </Col>
                    <Col xs={24} sm={12} lg={6}>
                      <MetricCard
                        title={t("dashboard.warning")}
                        value={summary.warning ?? 0}
                        status="warning"
                      />
                    </Col>
                    <Col xs={24} sm={12} lg={6}>
                      <MetricCard
                        title={t("dashboard.critical")}
                        value={summary.critical ?? 0}
                        status="critical"
                      />
                    </Col>
                    <Col xs={24} sm={12} lg={6}>
                      <MetricCard
                        title={t("dashboard.offline")}
                        value={summary.offline ?? 0}
                        status="offline"
                      />
                    </Col>
                  </Row>

                  <Row gutter={[16, 16]} style={{ marginBottom: 18 }}>
                    <Col xs={24} md={12}>
                      <>
                        <MetricCard
                          title={t("weather.temperature")}
                          value={
                            weatherOk
                              ? formatClimateValue(weatherData.temperatureC, "--")
                              : "--"
                          }
                          suffix="C"
                          icon={<Thermometer size={18} />}
                        />
                        <Typography.Text type="secondary">
                          {t("weather.source")}:{" "}
                          {weatherData?.source ?? "中央氣象署 Open Data"} ·{" "}
                          {t("weather.station")}:{" "}
                          {weatherData?.station?.name ?? "-"} ·{" "}
                          {t("weather.observedAt")}:{" "}
                          {weatherData?.observedAt && weatherOk
                            ? new Date(weatherData.observedAt).toLocaleString()
                            : "-"}
                        </Typography.Text>
                        {!weatherOk ? (
                          <Tag color="orange">
                            {weatherData?.requiresApiKey
                              ? t("weather.missingApiKey")
                              : (weatherData?.error ??
                                t("weather.unavailable"))}
                          </Tag>
                        ) : null}
                      </>
                    </Col>
                    <Col xs={24} md={12}>
                      <>
                        <MetricCard
                          title={t("weather.humidity")}
                          value={
                            weatherOk
                              ? formatClimateValue(weatherData.humidityPercent, "--")
                              : "--"
                          }
                          suffix="%RH"
                          icon={<Waves size={18} />}
                        />
                        <Typography.Text type="secondary">
                          {t("weather.location")}:{" "}
                          {weatherData?.location
                            ? `${weatherData.location.county}${weatherData.location.town}`
                            : "臺南市安南區"}{" "}
                          · {t("weather.source")}:{" "}
                          {weatherData?.source ?? "中央氣象署 Open Data"} ·{" "}
                          {t("weather.observedAt")}:{" "}
                          {weatherData?.observedAt && weatherOk
                            ? new Date(weatherData.observedAt).toLocaleString()
                            : "-"}
                        </Typography.Text>
                        {!weatherOk ? (
                          <Tag color="orange">{t("weather.unavailable")}</Tag>
                        ) : null}
                      </>
                    </Col>
                  </Row>

                  <Tabs
                    items={[
                      {
                        key: "floor",
                        label: t("dashboard.floorPlan"),
                        children: (
                          <>
                            {hasFloorPlanControls ? (
                              <div className="nmth-page-toolbar" style={isCompactFloorPlanControls ? { display: "grid", gap: 12 } : undefined}>
                                {floorPlanOptions.length > 1 ? (
                                  <Space wrap>
                                    <Typography.Text strong>
                                      {t("exhibition.floorPlans")}
                                    </Typography.Text>
                                    <Select
                                      value={activeFloorPlan?.id}
                                      onChange={(value) => {
                                        setSelectedFloorPlanId(value);
                                        setSelectedVersionId(undefined);
                                      }}
                                      options={floorPlanOptions}
                                      placeholder={t("exhibition.floorPlans")}
                                      style={{ minWidth: isCompactFloorPlanControls ? 0 : 260, width: isCompactFloorPlanControls ? "100%" : undefined }}
                                    />
                                  </Space>
                                ) : null}
                                {activeFloorPlan?.versions?.length ? (
                                  <Space wrap>
                                    <Typography.Text strong>
                                      {t("floorPlan.selectVersion")}
                                    </Typography.Text>
                                    <Select
                                      value={activeFloorPlanVersion?.id}
                                      onChange={setSelectedVersionId}
                                      options={floorPlanVersionOptions}
                                     placeholder={t("floorPlan.selectVersion")}
                                      style={{ minWidth: isCompactFloorPlanControls ? 0 : 220, width: isCompactFloorPlanControls ? "100%" : undefined }}
                                    />
                                  </Space>
                                ) : null}
                              </div>
                            ) : null}
                            <FloorPlanDashboard
                              points={points}
                              editable={canManageFloorPlans}
                              hasFloorPlan={Boolean(activeFloorPlan)}
                              pdfUrl={floorPlanPdfUrl}
                              renderedImageUrl={floorPlanRenderedImageUrl}
                              pageNumber={activeFloorPlanVersion?.pageNumber}
                              pageWidth={activeFloorPlanVersion?.width}
                              pageHeight={activeFloorPlanVersion?.height}
                              renderScale={activeFloorPlanVersion?.renderScale}
                              onPointSaved={() => floorPlans.refetch()}
                            />
                          </>
                        ),
                      },
                      {
                        key: "cards",
                        label: t("dashboard.cards"),
                        children: devices.length ? (
                          <Row gutter={[16, 16]}>
                            {devices.map((device: any) => {
                              const latest =
                                device.latestMeasurement ??
                                device.measurements?.[0];
                              const isOffline =
                                !device.lastSeenAt ||
                                Date.now() -
                                  new Date(device.lastSeenAt).getTime() >
                                  3 * 60_000;
                              const alertLevel = device.currentAlerts?.some(
                                (alert: any) => alert.level === "critical",
                              )
                                ? "critical"
                                : device.currentAlerts?.length
                                  ? "warning"
                                  : "normal";
                              const status = isOffline ? "offline" : alertLevel;
                              return (
                                <Col xs={24} md={12} xl={6} key={device.id}>
                                  <Card
                                    className="nmth-panel"
                                    styles={{ body: { padding: 18 } }}
                                  >
                                    <div
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        gap: 12,
                                      }}
                                    >
                                      <span
                                        style={{
                                          color: "var(--nmth-muted)",
                                          fontWeight: 600,
                                        }}
                                      >
                                        {device.displayName}
                                      </span>
                                      <span
                                        className={`nmth-status-dot ${status}`}
                                      />
                                    </div>
                                    <Space
                                      size={24}
                                      wrap
                                      style={{ marginTop: 8 }}
                                    >
                                      <Statistic
                                        title={t("device.temperature")}
                                        value={
                                          latest
                                            ? formatClimateValue(latest.temperatureC, "--")
                                            : "--"
                                        }
                                        suffix="C"
                                        valueStyle={{
                                          color: "var(--nmth-blue)",
                                          fontWeight: 700,
                                        }}
                                      />
                                      <Statistic
                                        title={t("device.humidity")}
                                        value={
                                          latest
                                            ? formatClimateValue(latest.humidityPercent, "--")
                                            : "--"
                                        }
                                        suffix="%RH"
                                        valueStyle={{
                                          color: "var(--nmth-blue)",
                                          fontWeight: 700,
                                        }}
                                      />
                                    </Space>
                                  </Card>
                                </Col>
                              );
                            })}
                          </Row>
                        ) : (
                          <Empty description={t("dashboard.noDevices")} />
                        ),
                      },
                      {
                        key: "chart",
                        label: t("nav.reports"),
                        children: (
                          <div className="nmth-panel" style={{ padding: 16 }}>
                            <Space wrap style={{ marginBottom: 12, width: "100%" }}>
                              <Typography.Text strong>
                                {t("report.chartTitle")}
                              </Typography.Text>
                              <Select
                                value={deviceId}
                                onChange={setDeviceId}
                                options={deviceOptions}
                                loading={overview.isLoading}
                                placeholder={t("dashboard.deviceFilter")}
                                style={{ minWidth: isMobile ? 0 : 260, width: isMobile ? "100%" : undefined }}
                              />
                            </Space>
                            <ClimateTrendChart
                              data={trend.data ?? []}
                              height={isMobile ? 280 : 420}
                              compact={isMobile}
                              axisPreset="reports"
                              labels={{ temperature: t("device.temperature"), humidity: t("device.humidity"), setpoint: t("report.humiditySetpoint") }}
                            />
                          </div>
                        ),
                      },
                    ]}
                  />
                </>
              ) : null,
          }))}
        />
        )}
      </RequirePermission>
    </AppShell>
  );
}

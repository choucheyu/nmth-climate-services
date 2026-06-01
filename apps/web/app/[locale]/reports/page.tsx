"use client";

import {
  Alert,
  App,
  Badge,
  Button,
  Card,
  Col,
  Collapse,
  DatePicker,
  Empty,
  Form,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { useQuery } from "@tanstack/react-query";
import dayjs, { type Dayjs } from "dayjs";
import { Download, FileChartColumn, ShieldAlert, Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { AppShell } from "../../../components/AppShell";
import { ClimateTrendChart } from "../../../components/ClimateTrendChart";
import { PageHeader } from "../../../components/PageHeader";
import { ActionTextButton } from "../../../components/actions";
import { ApiError, apiFetch, apiUrl, csrfHeaders } from "../../../lib/api";
import { RequirePermission, usePermissions } from "../../../lib/permissions";
import { useResponsiveMode } from "../../../lib/responsive";
import {
  buildCrossAnalysis,
  buildDeviceNameSummary,
  buildReportQueryParams,
  computeReportSummary,
  exportDisabledReason,
  formatReportClimateValue,
  hasSelectedReportDevices,
  isLargeReportQuery,
  REPORT_NO_AUTO_QUERY_MARKER,
  type CrossAnalysisRow,
  type ReportDevice,
  type ReportQueryParamsInput,
  type ReportRow,
} from "./reportsModel";

type QuickRange = "24h" | "7d" | "custom";
type ExportFormat = "csv" | "xlsx" | "pdf";
type ReportFormValues = {
  quickRange: QuickRange;
  range: [Dayjs, Dayjs];
  interval: string;
  dataProfile?: "DEMO" | "REAL";
  exhibitionId?: string;
  zoneId?: string;
  deviceIds?: string[];
  source?: string;
  includeCompensated: boolean;
  includeSynthetic: boolean;
};

type ChartInstance = {
  getDataURL?: (options: Record<string, unknown>) => string;
};

const DEFAULT_INTERVAL = "1h";
const PDF_UI_DOWNLOAD_FIX_MARKER = "NMTH_PDF_UI_DOWNLOAD_ANCHOR_FIX";
const QUICK_RANGE_LABEL_STYLE: CSSProperties = {
  display: "block",
  minWidth: 76,
  textAlign: "center",
  whiteSpace: "nowrap",
};

function quickRangeValue(value: QuickRange): [Dayjs, Dayjs] {
  const now = dayjs();
  return value === "7d"
    ? [now.subtract(7, "day"), now]
    : [now.subtract(24, "hour"), now];
}

function quickRangeLabel(testId: string, label: string) {
  return (
    <span data-testid={testId} style={QUICK_RANGE_LABEL_STYLE}>
      {label}
    </span>
  );
}

function createInitialReportValues(
  dataProfile: "DEMO" | "REAL",
  searchParams: URLSearchParams,
): ReportFormValues {
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  const parsedStart = start ? dayjs(start) : null;
  const parsedEnd = end ? dayjs(end) : null;
  const hasValidRange = Boolean(parsedStart?.isValid() && parsedEnd?.isValid());
  const quickRange =
    (searchParams.get("quickRange") as QuickRange | null) ??
    (hasValidRange ? "custom" : "24h");
  const legacyDeviceId = searchParams.get("deviceId");
  const deviceIds = Array.from(
    new Set([
      ...searchParams.getAll("deviceIds"),
      ...(legacyDeviceId ? [legacyDeviceId] : []),
    ]),
  );
  return {
    quickRange,
    range: hasValidRange
      ? [parsedStart!, parsedEnd!]
      : quickRangeValue(quickRange === "custom" ? "24h" : quickRange),
    interval: searchParams.get("interval") ?? DEFAULT_INTERVAL,
    dataProfile:
      (searchParams.get("dataProfile") as "DEMO" | "REAL" | null) ??
      dataProfile,
    exhibitionId: searchParams.get("exhibitionId") ?? undefined,
    zoneId: searchParams.get("zoneId") ?? undefined,
    deviceIds,
    source: searchParams.get("source") ?? undefined,
    includeCompensated: searchParams.get("includeCompensated") !== "false",
    includeSynthetic: searchParams.get("includeSynthetic") === "true",
  };
}

function timezoneName(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export default function ReportsPage() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { message } = App.useApp();
  const [form] = Form.useForm<ReportFormValues>();
  const { isMobile, isTabletPortrait, isTabletLandscape } = useResponsiveMode();
  const initialized = useRef(false);
  const chartInstanceRef = useRef<ChartInstance | null>(null);
  const permissions = usePermissions();
  const canExportReports = permissions.hasPermission("reports:export");
  const [draftValues, setDraftValues] = useState<ReportFormValues | null>(null);
  const [reportValues, setReportValues] = useState<ReportFormValues | null>(
    null,
  );
  const [exportContent, setExportContent] = useState<
    "data" | "chart-data-list"
  >("chart-data-list");
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(
    null,
  );
  const timezone = useMemo(timezoneName, []);

  const selectedDataProfile =
    Form.useWatch("dataProfile", form) ?? draftValues?.dataProfile;
  const selectedExhibitionId = Form.useWatch("exhibitionId", form);
  const selectedZoneId = Form.useWatch("zoneId", form);

  const dataProfile = useQuery({
    queryKey: ["data-profile", "reports"],
    queryFn: () =>
      apiFetch<{ profile: "DEMO" | "REAL"; profiles: Array<"DEMO" | "REAL"> }>(
        "/system/data-profile",
      ),
    retry: 1,
  });
  const activeProfile =
    selectedDataProfile ?? dataProfile.data?.profile ?? "REAL";
  const exhibitions = useQuery({
    queryKey: ["exhibitions", "report-filter", activeProfile],
    queryFn: () =>
      apiFetch<any>(
        `/exhibitions?page=1&pageSize=100&dataProfile=${activeProfile}`,
      ),
    retry: 1,
    enabled: Boolean(activeProfile),
  });
  const devices = useQuery({
    queryKey: ["devices", "report-filter", activeProfile],
    queryFn: () =>
      apiFetch<{ items: ReportDevice[] }>(
        `/devices?page=1&pageSize=200&dataProfile=${activeProfile}`,
      ),
    retry: 1,
    enabled: Boolean(activeProfile),
  });

  const exhibitionOptions = useMemo(
    () =>
      (exhibitions.data?.items ?? []).map((item: any) => ({
        value: item.id,
        label: item.name,
      })),
    [exhibitions.data],
  );
  const allZoneOptions = useMemo(
    () =>
      (exhibitions.data?.items ?? []).flatMap((item: any) =>
        (item.zones ?? []).map((zone: any) => ({
          value: zone.id,
          label: `${item.name} / ${zone.name}`,
          exhibitionId: item.id,
        })),
      ),
    [exhibitions.data],
  );
  const zoneOptions = useMemo(
    () =>
      allZoneOptions.filter(
        (item: any) =>
          !selectedExhibitionId || item.exhibitionId === selectedExhibitionId,
      ),
    [allZoneOptions, selectedExhibitionId],
  );
  const filteredDevices = useMemo(
    () =>
      (devices.data?.items ?? [])
        .filter(
          (item) =>
            !selectedExhibitionId || item.exhibitionId === selectedExhibitionId,
        )
        .filter((item) => !selectedZoneId || item.zoneId === selectedZoneId),
    [devices.data?.items, selectedExhibitionId, selectedZoneId],
  );
  const deviceOptions = useMemo(
    () =>
      filteredDevices.map((item) => ({
        value: item.id,
        label: `${item.displayName} (${item.deviceName})`,
      })),
    [filteredDevices],
  );
  const dataProfileOptions = useMemo(
    () =>
      (dataProfile.data?.profiles ?? ["REAL", "DEMO"]).map((profile) => ({
        value: profile,
        label: t(`profile.${profile}`),
      })),
    [dataProfile.data?.profiles, t],
  );

  useEffect(() => {
    if (initialized.current || dataProfile.isLoading) return;
    const initialValues = createInitialReportValues(
      dataProfile.data?.profile ?? "REAL",
      new URLSearchParams(searchParams.toString()),
    );
    initialized.current = true;
    form.setFieldsValue(initialValues);
    setDraftValues(initialValues);
    setReportValues(null);
  }, [dataProfile.data?.profile, dataProfile.isLoading, form, searchParams]);

  const reportParams = useMemo(() => {
    if (!reportValues) return null;
    return buildReportQueryParams(
      formValuesToQueryInput(reportValues, timezone),
    );
  }, [reportValues, timezone]);

  const reportRows = useQuery({
    queryKey: ["measurements", "report", reportParams?.toString()],
    queryFn: () =>
      apiFetch<ReportRow[]>(`/measurements/report?${reportParams!.toString()}`),
    retry: 1,
    enabled: Boolean(reportParams && hasSelectedReportDevices(reportValues)),
  });
  const rows = reportRows.data ?? [];

  const committedDevices = useMemo(
    () => filterDevicesForValues(devices.data?.items ?? [], reportValues),
    [devices.data?.items, reportValues],
  );
  const selectedDeviceIds = draftValues?.deviceIds ?? [];
  const committedSelectedDeviceIds = reportValues?.deviceIds ?? [];
  const hasSelectedDevice = hasSelectedReportDevices(draftValues);
  const queryDeviceCount = selectedDeviceIds.length;
  const querySummary = useMemo(() => {
    if (!draftValues) return [];
    return [
      `${t("report.deviceCount")}: ${queryDeviceCount}`,
      `${t("report.deviceSummary")}: ${buildDeviceNameSummary(filteredDevices, selectedDeviceIds, t("report.selectDeviceFirst"))}`,
      `${t("report.range")}: ${draftValues.range[0].format("YYYY-MM-DD HH:mm")} - ${draftValues.range[1].format("YYYY-MM-DD HH:mm")}`,
      `${t("report.sampling")}: ${draftValues.interval}`,
      `${t("profile.title")}: ${draftValues.dataProfile ?? activeProfile}`,
      `${t("report.timezone")}: ${timezone}`,
    ];
  }, [
    activeProfile,
    draftValues,
    filteredDevices,
    queryDeviceCount,
    selectedDeviceIds,
    t,
    timezone,
  ]);
  const resultSummary = useMemo(
    () =>
      reportValues
        ? computeReportSummary({
            rows,
            devices: committedDevices,
            selectedDeviceIds: committedSelectedDeviceIds,
            start: reportValues.range[0].toDate(),
            end: reportValues.range[1].toDate(),
            interval: reportValues.interval,
          })
        : null,
    [committedDevices, committedSelectedDeviceIds, reportValues, rows],
  );
  const crossAnalysis = useMemo(() => buildCrossAnalysis(rows), [rows]);
  const chartRows = useMemo(
    () =>
      rows.map((row) => ({
        ...row,
        measuredAt: String(row.measuredAt),
        temperatureC: row.temperatureC ?? null,
        humidityPercent: row.humidityPercent ?? null,
      })),
    [rows],
  );
  const exportReason = exportDisabledReason({
    canExport: canExportReports,
    hasReportValues: Boolean(reportValues),
    isLoading: reportRows.isFetching,
    hasError: reportRows.isError,
    rowCount: rows.length,
  });
  const largeQuery =
    draftValues && hasSelectedDevice
      ? isLargeReportQuery(
          draftValues.range[0].toDate(),
          draftValues.range[1].toDate(),
          queryDeviceCount,
        )
      : false;
  const isTouchReportWorkflow =
    isMobile || isTabletPortrait || isTabletLandscape;
  const usesReportCards = isMobile || isTabletPortrait;
  const compactReportFilters = isMobile || isTabletPortrait;
  const touchControlSize = isTouchReportWorkflow ? "large" : "middle";
  const reportChartHeight = isMobile
    ? 280
    : isTabletPortrait
      ? 340
      : isTabletLandscape
        ? 360
        : 420;
  const reportChartMinHeight = isMobile
    ? 312
    : isTabletPortrait
      ? 372
      : isTabletLandscape
        ? 392
        : 456;
  const reportFilterGutter: [number, number] = isTouchReportWorkflow
    ? [12, 12]
    : [12, 4];
  const exportActions = canExportReports ? (
    <Space
      direction={compactReportFilters ? "vertical" : "horizontal"}
      wrap={!compactReportFilters}
      size={compactReportFilters ? 10 : undefined}
      style={compactReportFilters ? { width: "100%" } : undefined}
    >
      <Select
        value={exportContent}
        size={touchControlSize}
        style={compactReportFilters ? { width: "100%" } : { minWidth: 188 }}
        options={[
          { value: "data", label: t("report.exportContentData") },
          {
            value: "chart-data-list",
            label: t("report.exportContentChartDataList"),
          },
        ]}
        onChange={setExportContent}
      />
      <Space
        wrap
        size={[8, 8]}
        style={compactReportFilters ? { width: "100%" } : undefined}
      >
        {(["csv", "xlsx", "pdf"] as ExportFormat[]).map((format) => (
          <span
            key={format}
            style={compactReportFilters ? { flex: "1 1 88px" } : undefined}
          >
            <ActionTextButton
              block={compactReportFilters}
              disabled={Boolean(exportReason)}
              disabledReason={
                exportReason
                  ? t(`report.exportDisabled.${exportReason}`)
                  : undefined
              }
              icon={<Download size={15} />}
              loading={exportingFormat === format}
              onClick={() => void handleExport(format)}
              size={touchControlSize}
              tooltip={
                exportReason
                  ? t(`report.exportDisabled.${exportReason}`)
                  : undefined
              }
            >
              {format === "xlsx" ? "Excel" : format.toUpperCase()}
            </ActionTextButton>
          </span>
        ))}
      </Space>
    </Space>
  ) : null;

  function normalizeValues(
    values: Partial<ReportFormValues>,
  ): ReportFormValues {
    const defaults =
      draftValues ??
      reportValues ??
      createInitialReportValues(
        dataProfile.data?.profile ?? "REAL",
        new URLSearchParams(),
      );
    return {
      ...defaults,
      ...values,
      quickRange: values.quickRange ?? defaults.quickRange,
      range: values.range ?? defaults.range,
      interval: values.interval ?? defaults.interval,
      dataProfile: values.dataProfile ?? defaults.dataProfile,
      deviceIds: Array.isArray(values.deviceIds)
        ? values.deviceIds
        : "deviceIds" in values
          ? []
          : (defaults.deviceIds ?? []),
      includeCompensated:
        values.includeCompensated ?? defaults.includeCompensated,
      includeSynthetic: values.includeSynthetic ?? defaults.includeSynthetic,
    };
  }

  function commitQuery(values: ReportFormValues) {
    const normalized = normalizeValues(values);
    setDraftValues(normalized);
    if (!hasSelectedReportDevices(normalized)) {
      setReportValues(null);
      message.warning(t("report.selectDeviceFirst"));
      form.setFields([
        { name: "deviceIds", errors: [t("report.selectDeviceFirst")] },
      ]);
      return;
    }
    chartInstanceRef.current = null;
    setReportValues(normalized);
    const params = buildReportQueryParams(
      formValuesToQueryInput(normalized, timezone),
    );
    params.set("quickRange", normalized.quickRange);
    router.replace(`/${locale}/reports?${params.toString()}`, {
      scroll: false,
    });
  }

  async function handleExport(format: ExportFormat) {
    if (!reportValues) return;
    const disabledReason = exportReason;
    if (disabledReason) {
      message.warning(t(`report.exportDisabled.${disabledReason}`));
      return;
    }
    const payload: ReportQueryParamsInput & { chartDataUrl?: string } = {
      ...formValuesToQueryInput(reportValues, timezone, {
        format,
        exportContent,
        locale,
        reportTitle: t("report.title"),
      }),
    };
    if (format === "pdf" && exportContent === "chart-data-list") {
      const chartDataUrl = chartInstanceRef.current?.getDataURL?.({
        type: "png",
        pixelRatio: 1.5,
        backgroundColor: "#ffffff",
      });
      if (!chartDataUrl) {
        message.error(t("report.chartNotReady"));
        return;
      }
      payload.chartDataUrl = chartDataUrl;
    }
    setExportingFormat(format);
    try {
      const response = await fetch(apiUrl("/reports/export"), {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", ...csrfHeaders() },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new ApiError(await response.text(), response.status);
      }
      const blob = await response.blob();
      const filename = filenameFromContentDisposition(
        response.headers.get("content-disposition"),
        `nmth-climate-report.${format}`,
      );
      downloadBlob(blob, filename);
      message.success(t("report.exportStarted"));
    } catch {
      message.error(t("report.exportFailed"));
    } finally {
      setExportingFormat(null);
    }
  }

  return (
    <AppShell>
      <RequirePermission permission="reports:read">
        <PageHeader
          eyebrow={t("report.eyebrow")}
          title={t("report.title")}
          actions={compactReportFilters ? null : exportActions}
        />
        <Row gutter={[16, 16]}>
          <Col xs={24}>
            <Card className="nmth-panel" size="small">
              <Form
                form={form}
                layout="vertical"
                onValuesChange={(changed, values) => {
                  const nextValues: Partial<ReportFormValues> = { ...values };
                  if (
                    "quickRange" in changed &&
                    changed.quickRange !== "custom"
                  ) {
                    const nextRange = quickRangeValue(changed.quickRange);
                    nextValues.range = nextRange;
                    nextValues.interval =
                      values.interval === "raw"
                        ? DEFAULT_INTERVAL
                        : values.interval;
                    form.setFieldsValue({
                      range: nextRange,
                      interval: nextValues.interval,
                    });
                  }
                  if ("range" in changed) {
                    nextValues.quickRange = "custom";
                    form.setFieldsValue({ quickRange: "custom" });
                  }
                  if ("dataProfile" in changed || "exhibitionId" in changed) {
                    nextValues.zoneId = undefined;
                    nextValues.deviceIds = [];
                    form.setFieldsValue({ zoneId: undefined, deviceIds: [] });
                  }
                  if ("zoneId" in changed) {
                    nextValues.deviceIds = [];
                    form.setFieldsValue({ deviceIds: [] });
                  }
                  const normalized = normalizeValues(nextValues);
                  setDraftValues(normalized);
                  if (!hasSelectedReportDevices(normalized)) {
                    setReportValues(null);
                    chartInstanceRef.current = null;
                  }
                }}
                onFinish={commitQuery}
              >
                <Row
                  gutter={reportFilterGutter}
                  align="bottom"
                  data-nmth-marker={REPORT_NO_AUTO_QUERY_MARKER}
                  data-testid="reports-filter-grid"
                >
                  <Col xs={24} md={24} lg={isTabletLandscape ? 12 : 8} xl={7}>
                    <Form.Item
                      name="deviceIds"
                      label={t("device.deviceName")}
                      rules={[
                        {
                          validator: async (_, value: string[] | undefined) => {
                            if (value?.length) return;
                            throw new Error(t("report.selectDeviceFirst"));
                          },
                        },
                      ]}
                      style={{ marginBottom: 8 }}
                    >
                      <Select
                        allowClear
                        showSearch
                        mode="multiple"
                        maxTagCount={compactReportFilters ? 2 : "responsive"}
                        maxTagTextLength={12}
                        optionFilterProp="label"
                        options={deviceOptions}
                        loading={devices.isLoading}
                        placeholder={t("report.selectDeviceFirst")}
                        size={touchControlSize}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12} lg={isTabletLandscape ? 12 : 6} xl={5}>
                    <Form.Item
                      name="quickRange"
                      label={t("report.quickRange")}
                      style={{ marginBottom: 8 }}
                    >
                      <Segmented
                        block
                        size={touchControlSize}
                        options={[
                          {
                            value: "24h",
                            label: quickRangeLabel(
                              "reports-quick-range-label-24h",
                              t("report.last24Hours"),
                            ),
                          },
                          {
                            value: "7d",
                            label: quickRangeLabel(
                              "reports-quick-range-label-7d",
                              t("report.last7Days"),
                            ),
                          },
                          {
                            value: "custom",
                            label: quickRangeLabel(
                              "reports-quick-range-label-custom",
                              t("report.customRange"),
                            ),
                          },
                        ]}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12} lg={isTabletLandscape ? 12 : 6} xl={6}>
                    <Form.Item
                      name="range"
                      label={t("report.range")}
                      rules={[{ required: true }]}
                      style={{ marginBottom: 8 }}
                    >
                      <DatePicker.RangePicker
                        allowClear={false}
                        showTime
                        style={{ width: "100%" }}
                        inputReadOnly={compactReportFilters}
                        size={touchControlSize}
                      />
                    </Form.Item>
                  </Col>
                  <Col
                    xs={12}
                    md={12}
                    lg={isTabletLandscape ? 6 : 2}
                    xl={2}
                    data-testid="reports-interval-field"
                  >
                    <Form.Item
                      name="interval"
                      label={t("report.sampling")}
                      style={{ marginBottom: 8 }}
                    >
                      <Select
                        size={touchControlSize}
                        options={[
                          { value: "raw", label: t("report.raw") },
                          { value: "5m", label: t("report.fiveMinutes") },
                          { value: "10m", label: t("report.tenMinutes") },
                          { value: "30m", label: t("report.thirtyMinutes") },
                          { value: "1h", label: t("report.hourly") },
                          { value: "1d", label: t("report.daily") },
                        ]}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={12} md={12} lg={isTabletLandscape ? 6 : 2} xl={2}>
                    <Form.Item
                      label=" "
                      colon={false}
                      style={{ marginBottom: 8 }}
                    >
                      <Tooltip
                        title={
                          !hasSelectedDevice
                            ? t("report.selectDeviceFirst")
                            : undefined
                        }
                      >
                        <span style={{ display: "block" }}>
                          <Button
                            type="primary"
                            htmlType="submit"
                            block
                            disabled={!hasSelectedDevice}
                            icon={<FileChartColumn size={15} />}
                            loading={reportRows.isFetching}
                            data-testid="reports-search-submit"
                            size={touchControlSize}
                          >
                            {t("app.search")}
                          </Button>
                        </span>
                      </Tooltip>
                    </Form.Item>
                  </Col>
                </Row>
                <Collapse
                  ghost
                  size={isTouchReportWorkflow ? "middle" : "small"}
                  items={[
                    {
                      key: "advanced",
                      label: t("report.advancedFilters"),
                      children: (
                        <Row gutter={reportFilterGutter} align="bottom">
                          <Col
                            xs={24}
                            md={12}
                            lg={isTabletLandscape ? 8 : 8}
                            xl={4}
                          >
                            <Form.Item
                              name="dataProfile"
                              label={t("profile.title")}
                              style={{ marginBottom: 8 }}
                            >
                              <Select
                                options={dataProfileOptions}
                                loading={dataProfile.isLoading}
                                size={touchControlSize}
                              />
                            </Form.Item>
                          </Col>
                          <Col
                            xs={24}
                            md={12}
                            lg={isTabletLandscape ? 8 : 8}
                            xl={5}
                          >
                            <Form.Item
                              name="exhibitionId"
                              label={t("exhibition.name")}
                              style={{ marginBottom: 8 }}
                            >
                              <Select
                                allowClear
                                showSearch
                                optionFilterProp="label"
                                options={exhibitionOptions}
                                loading={exhibitions.isLoading}
                                size={touchControlSize}
                              />
                            </Form.Item>
                          </Col>
                          <Col
                            xs={24}
                            md={12}
                            lg={isTabletLandscape ? 8 : 8}
                            xl={5}
                          >
                            <Form.Item
                              name="zoneId"
                              label={t("device.zone")}
                              style={{ marginBottom: 8 }}
                            >
                              <Select
                                allowClear
                                showSearch
                                optionFilterProp="label"
                                options={zoneOptions}
                                size={touchControlSize}
                              />
                            </Form.Item>
                          </Col>
                          <Col
                            xs={24}
                            md={12}
                            lg={isTabletLandscape ? 8 : 6}
                            xl={4}
                          >
                            <Form.Item
                              name="source"
                              label={t("report.source")}
                              style={{ marginBottom: 8 }}
                            >
                              <Select
                                allowClear
                                options={[
                                  "real",
                                  "imported",
                                  "compensated",
                                  "derived",
                                  "manual",
                                ].map((value) => ({ value, label: value }))}
                                size={touchControlSize}
                              />
                            </Form.Item>
                          </Col>
                          <Col
                            xs={24}
                            sm={12}
                            md={12}
                            lg={isTabletLandscape ? 8 : 5}
                            xl={3}
                          >
                            <Form.Item
                              name="includeCompensated"
                              label={t("report.includeCompensated")}
                              valuePropName="checked"
                              style={{ marginBottom: 8 }}
                            >
                              <Switch />
                            </Form.Item>
                          </Col>
                          <Col
                            xs={24}
                            sm={12}
                            md={12}
                            lg={isTabletLandscape ? 8 : 5}
                            xl={3}
                          >
                            <Form.Item
                              name="includeSynthetic"
                              label={t("report.includeSynthetic")}
                              valuePropName="checked"
                              style={{ marginBottom: 8 }}
                            >
                              <Switch />
                            </Form.Item>
                          </Col>
                        </Row>
                      ),
                    },
                    {
                      key: "query-info",
                      label: t("report.queryInformation"),
                      children: (
                        <Space wrap size={[4, 4]}>
                          {querySummary.map((item) => (
                            <Tag key={item}>{item}</Tag>
                          ))}
                        </Space>
                      ),
                    },
                  ]}
                />
                {compactReportFilters && exportActions ? (
                  <div style={{ marginTop: 12 }}>{exportActions}</div>
                ) : null}
              </Form>
            </Card>
          </Col>
          {largeQuery ? (
            <Col xs={24}>
              <Alert
                type="info"
                showIcon
                message={t("report.largeQueryHint")}
              />
            </Col>
          ) : null}
          {reportRows.isError ? (
            <Col xs={24}>
              <Alert type="error" showIcon message={t("report.queryFailed")} />
            </Col>
          ) : null}
          {reportRows.isSuccess && rows.length === 0 ? (
            <Col xs={24}>
              <Alert
                type="warning"
                showIcon
                message={t("report.noData")}
                description={t("report.noDataHint")}
              />
            </Col>
          ) : null}
          <Col xs={24}>
            <Card
              className="nmth-panel"
              title={t("report.chartTitle")}
              extra={<Sparkles size={16} color="#004EA2" />}
              styles={{ body: { minHeight: reportChartMinHeight } }}
              data-testid="reports-trend-chart-card"
            >
              {rows.length ? (
                <ClimateTrendChart
                  data={chartRows}
                  height={reportChartHeight}
                  compact={usesReportCards}
                  resizeKey={rows.length}
                  axisPreset="reports"
                  seriesMode="device-source"
                  labels={{
                    temperature: t("device.temperature"),
                    humidity: t("device.humidity"),
                    setpoint: t("report.humiditySetpoint"),
                  }}
                  onChartReady={(instance) => {
                    chartInstanceRef.current = instance as ChartInstance;
                  }}
                />
              ) : (
                <div
                  style={{
                    display: "grid",
                    minHeight: Math.max(240, reportChartHeight - 60),
                    placeItems: "center",
                  }}
                >
                  <Empty
                    description={chartEmptyDescription({
                      hasSelectedDevice,
                      hasReportValues: Boolean(reportValues),
                      isFetching: reportRows.isFetching,
                      t,
                    })}
                  />
                </div>
              )}
            </Card>
          </Col>
          {resultSummary &&
          rows.length > 0 &&
          (resultSummary.partialCount ||
            resultSummary.offlineCount ||
            resultSummary.noDataCount) ? (
            <Col xs={24}>
              <Alert
                type="warning"
                showIcon
                icon={<ShieldAlert size={16} />}
                message={t("report.partialData")}
                description={t("report.partialDataHint")}
              />
            </Col>
          ) : null}
          {resultSummary ? (
            <Col xs={24}>
              <Card
                className="nmth-panel"
                size="small"
                title={t("report.resultSummary")}
              >
                <Row gutter={[16, 12]}>
                  <Col xs={12} md={6}>
                    <Statistic
                      title={t("report.rowCount")}
                      value={resultSummary.rowCount}
                    />
                  </Col>
                  <Col xs={12} md={6}>
                    <Statistic
                      title={t("report.deviceCount")}
                      value={resultSummary.deviceCount}
                    />
                  </Col>
                  <Col xs={24} md={6}>
                    <Statistic
                      title={t("report.effectivePeriod")}
                      value={formatPeriod(
                        resultSummary.effectiveStart,
                        resultSummary.effectiveEnd,
                      )}
                    />
                  </Col>
                  <Col xs={24} md={6}>
                    <Space wrap>
                      <Tag
                        color={resultSummary.offlineCount ? "red" : "green"}
                      >{`${t("report.offline")}: ${resultSummary.offlineCount}`}</Tag>
                      <Tag
                        color={resultSummary.noDataCount ? "default" : "green"}
                      >{`${t("report.noDataShort")}: ${resultSummary.noDataCount}`}</Tag>
                      <Tag
                        color={resultSummary.partialCount ? "gold" : "green"}
                      >{`${t("report.partial")}: ${resultSummary.partialCount}`}</Tag>
                    </Space>
                  </Col>
                </Row>
                {usesReportCards ? (
                  <Space
                    direction="vertical"
                    size={10}
                    style={{ marginTop: 12, width: "100%" }}
                  >
                    {resultSummary.perDevice.map((row) => (
                      <Card key={row.key} size="small">
                        <Space
                          direction="vertical"
                          size={8}
                          style={{ width: "100%" }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 8,
                            }}
                          >
                            <Typography.Text
                              strong
                            >{`${row.displayName} (${row.deviceName})`}</Typography.Text>
                            <Tag color={statusColor(row.status)}>
                              {t(`report.status.${row.status}`)}
                            </Tag>
                          </div>
                          <Space wrap size={[6, 6]}>
                            <Tag>{`${t("report.source")}: ${row.source}`}</Tag>
                            <Tag>{`${t("admin.recordCount")}: ${row.count}`}</Tag>
                            <Tag>{`${t("report.coverage")}: ${row.coveragePercent === undefined ? "-" : `${row.coveragePercent}%`}`}</Tag>
                          </Space>
                          <Typography.Text>{`${t("device.temperature")}: ${row.averageTemperature} / ${row.minimumTemperature} / ${row.maximumTemperature}`}</Typography.Text>
                          <Typography.Text>{`${t("device.humidity")}: ${row.averageHumidity} / ${row.minimumHumidity} / ${row.maximumHumidity}`}</Typography.Text>
                        </Space>
                      </Card>
                    ))}
                  </Space>
                ) : (
                  <Table
                    style={{ marginTop: 12 }}
                    rowKey="key"
                    size="small"
                    pagination={{ pageSize: 5 }}
                    dataSource={resultSummary.perDevice}
                    scroll={{ x: isTabletLandscape ? 860 : 980 }}
                    columns={[
                      {
                        title: t("device.deviceName"),
                        render: (_, row) =>
                          `${row.displayName} (${row.deviceName})`,
                        fixed: "left",
                        width: 220,
                      },
                      {
                        title: t("report.source"),
                        dataIndex: "source",
                        width: 100,
                      },
                      {
                        title: t("admin.recordCount"),
                        dataIndex: "count",
                        width: 90,
                      },
                      {
                        title: t("report.coverage"),
                        render: (_, row) =>
                          row.coveragePercent === undefined
                            ? "-"
                            : `${row.coveragePercent}%`,
                        width: 100,
                      },
                      {
                        title: t("device.temperature"),
                        render: (_, row) =>
                          `${row.averageTemperature} / ${row.minimumTemperature} / ${row.maximumTemperature}`,
                        width: 170,
                      },
                      {
                        title: t("device.humidity"),
                        render: (_, row) =>
                          `${row.averageHumidity} / ${row.minimumHumidity} / ${row.maximumHumidity}`,
                        width: 170,
                      },
                      {
                        title: t("app.status"),
                        dataIndex: "status",
                        render: (value) => (
                          <Tag color={statusColor(value)}>
                            {t(`report.status.${value}`)}
                          </Tag>
                        ),
                        width: 120,
                      },
                    ]}
                  />
                )}
              </Card>
            </Col>
          ) : null}
          {reportValues ? (
            <Col xs={24}>
              <Card
                className="nmth-panel"
                title={t("report.crossAnalysisTable")}
              >
                {usesReportCards ? (
                  resultSummary?.perDevice.length ? (
                    <Space
                      direction="vertical"
                      size={10}
                      style={{ width: "100%" }}
                    >
                      {resultSummary.perDevice.map((row) => (
                        <Card key={row.key} size="small">
                          <Space
                            direction="vertical"
                            size={8}
                            style={{ width: "100%" }}
                          >
                            <Typography.Text
                              strong
                            >{`${row.displayName} (${row.deviceName})`}</Typography.Text>
                            <Space wrap size={[6, 6]}>
                              <Tag color={statusColor(row.status)}>
                                {t(`report.status.${row.status}`)}
                              </Tag>
                              <Tag>{`${t("admin.recordCount")}: ${row.count}`}</Tag>
                              <Tag>{`${t("report.coverage")}: ${row.coveragePercent === undefined ? "-" : `${row.coveragePercent}%`}`}</Tag>
                            </Space>
                            <Typography.Text>{`${t("device.temperature")}: ${row.averageTemperature} / ${row.minimumTemperature} / ${row.maximumTemperature}`}</Typography.Text>
                            <Typography.Text>{`${t("device.humidity")}: ${row.averageHumidity} / ${row.minimumHumidity} / ${row.maximumHumidity}`}</Typography.Text>
                          </Space>
                        </Card>
                      ))}
                    </Space>
                  ) : (
                    <Empty description={t("app.empty")} />
                  )
                ) : (
                  <Table
                    rowKey="key"
                    loading={reportRows.isFetching}
                    dataSource={crossAnalysis.rows}
                    pagination={{ pageSize: 8 }}
                    size="small"
                    scroll={{
                      x: Math.max(
                        isTabletLandscape ? 860 : 960,
                        260 + crossAnalysis.devices.length * 330,
                      ),
                    }}
                    columns={crossAnalysisColumns(crossAnalysis.devices, t)}
                  />
                )}
              </Card>
            </Col>
          ) : null}
        </Row>
      </RequirePermission>
    </AppShell>
  );
}

function formValuesToQueryInput(
  values: ReportFormValues,
  timezone: string,
  overrides: Partial<ReportQueryParamsInput> = {},
): ReportQueryParamsInput {
  return {
    start: values.range[0].toISOString(),
    end: values.range[1].toISOString(),
    interval: values.interval,
    dataProfile: values.dataProfile,
    exhibitionId: values.exhibitionId,
    zoneId: values.zoneId,
    deviceIds: values.deviceIds ?? [],
    source: values.source,
    includeCompensated: values.includeCompensated,
    includeSynthetic: values.includeSynthetic,
    timezone,
    ...overrides,
  };
}

function filterDevicesForValues(
  devices: ReportDevice[],
  values: ReportFormValues | null,
): ReportDevice[] {
  if (!values?.deviceIds?.length) return [];
  const selectedIds = new Set(values.deviceIds);
  return devices
    .filter(
      (device) =>
        !values.exhibitionId || device.exhibitionId === values.exhibitionId,
    )
    .filter((device) => !values.zoneId || device.zoneId === values.zoneId)
    .filter((device) => selectedIds.has(device.id));
}

function chartEmptyDescription({
  hasSelectedDevice,
  hasReportValues,
  isFetching,
  t,
}: {
  hasSelectedDevice: boolean;
  hasReportValues: boolean;
  isFetching: boolean;
  t: (key: string) => string;
}): string {
  if (isFetching) return t("report.loading");
  if (!hasSelectedDevice) return t("report.selectDeviceFirst");
  if (!hasReportValues) return t("report.queryReady");
  return t("report.noDataShort");
}

function formatPeriod(start?: string, end?: string): string {
  if (!start || !end) return "-";
  return `${new Date(start).toLocaleString()} - ${new Date(end).toLocaleString()}`;
}

function statusColor(value: string): string {
  const map: Record<string, string> = {
    ok: "green",
    partial: "gold",
    noData: "default",
    offline: "red",
  };
  return map[value] ?? "default";
}

function crossAnalysisColumns(
  devices: Array<{ key: string; label: string }>,
  t: (key: string) => string,
) {
  return [
    {
      title: t("report.start"),
      dataIndex: "measuredAt",
      width: 180,
      fixed: "left" as const,
      render: (value: string) => new Date(String(value)).toLocaleString(),
    },
    {
      title: t("report.source"),
      dataIndex: "source",
      width: 110,
      fixed: "left" as const,
    },
    ...devices.map((device) => ({
      title: device.label,
      children: [
        {
          title: t("device.temperature"),
          width: 110,
          render: (_: unknown, row: CrossAnalysisRow) =>
            renderMetricCell(row.values[device.key], "temperatureC", " C"),
        },
        {
          title: t("device.humidity"),
          width: 110,
          render: (_: unknown, row: CrossAnalysisRow) =>
            renderMetricCell(row.values[device.key], "humidityPercent", " %RH"),
        },
        {
          title: t("report.humiditySetpoint"),
          width: 110,
          render: (_: unknown, row: CrossAnalysisRow) =>
            renderMetricCell(
              row.values[device.key],
              "dehumidifySetpoint",
              " %RH",
            ),
        },
      ],
    })),
  ];
}

function renderMetricCell(
  rows: ReportRow[] | undefined,
  field: "temperatureC" | "humidityPercent" | "dehumidifySetpoint",
  unit: string,
) {
  if (!rows?.length) {
    return <Typography.Text type="secondary">-</Typography.Text>;
  }
  const value = formatReportClimateValue(rows[0]?.[field]);
  return (
    <Space size={4}>
      <span>{value === "-" ? value : `${value}${unit}`}</span>
      {rows.length > 1 ? (
        <Badge count={`x${rows.length}`} size="small" />
      ) : null}
    </Space>
  );
}

function filenameFromContentDisposition(
  value: string | null,
  fallback: string,
): string {
  const match = value?.match(/filename="?([^";]+)"?/);
  return match?.[1] ?? fallback;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.dataset.nmthPdfExport = PDF_UI_DOWNLOAD_FIX_MARKER;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

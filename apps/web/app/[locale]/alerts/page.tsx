"use client";

import {
  App,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ActionType, ProColumns } from "@ant-design/pro-components";
import { useQuery } from "@tanstack/react-query";
import { BellOff, CheckCircle2, RefreshCcw, RefreshCw } from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import type {
  CSSProperties,
  HTMLAttributes,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "../../../components/AppShell";
import { AutoRefreshStatus } from "../../../components/AutoRefreshStatus";
import { PageHeader } from "../../../components/PageHeader";
import {
  ResponsiveActionGroup,
  type ResponsiveAction,
} from "../../../components/actions";
import { apiFetch } from "../../../lib/api";
import {
  newestTimestamp,
  useAutoRefreshControl,
  useAutoRefreshTrigger,
} from "../../../lib/autoRefresh";
import { RequirePermission, usePermissions } from "../../../lib/permissions";
import { useResponsiveMode } from "../../../lib/responsive";
import { buildAlertsListPath } from "./alertsQuery";

const ProTable = dynamic(
  () => import("@ant-design/pro-components").then((module) => module.ProTable),
  { ssr: false },
) as typeof import("@ant-design/pro-components").ProTable;
const ALERT_TABLE_PREFERENCE_KEY = "table.alerts.list.v1";
const ALERT_TABLE_PREFERENCE_STORAGE_KEY =
  "nmth.userPreferences.table.alerts.list.v1";
const ALERT_TABLE_COLUMN_WIDTH_STORAGE_KEY =
  "nmth.alerts.table.columnWidths.v1";
const ALERT_TABLE_COLUMN_WIDTH_MIN = 80;
const ALERT_TABLE_COLUMN_WIDTH_MAX = 720;
const ALERT_TABLE_SCROLL_X_MIN = 960;
const ALERT_ACTIVE_REFRESH_MS = 30_000;
const ALERT_STALE_WARNING_MS = 2 * 60_000;

const ALERT_TABLE_COLUMN_DEFAULT_WIDTHS = {
  level: 80,
  device: 93,
  exhibition: 91,
  bound: 139,
  exceededDuration: 130,
  notificationCount: 87,
  nextReminder: 99,
  triggeredAt: 162,
  status: 80,
  detail: 278,
  actions: 96,
} satisfies Record<string, number>;
type AlertTableColumnKey = keyof typeof ALERT_TABLE_COLUMN_DEFAULT_WIDTHS;
type AlertTableColumnWidths = Record<AlertTableColumnKey, number>;
type AlertColumn = ProColumns<any> & { key: AlertTableColumnKey };
type AlertColumnsStateEntry = {
  show?: boolean;
  fixed?: "left" | "right";
  order?: number;
  disable?: boolean | { checkbox: boolean };
};
type AlertColumnsState = Record<string, AlertColumnsStateEntry>;
type AlertTableSortState = Record<string, "ascend" | "descend" | null>;
type AlertTablePreference = {
  columnWidths: AlertTableColumnWidths;
  columnsState: AlertColumnsState;
  sort: AlertTableSortState;
};

const ALERT_TABLET_LANDSCAPE_COLUMN_KEYS: AlertTableColumnKey[] = [
  "level",
  "device",
  "exhibition",
  "bound",
  "exceededDuration",
  "triggeredAt",
  "status",
  "actions",
];

type ResizableHeaderCellInjectedProps = {
  columnKey?: AlertTableColumnKey;
  resizable?: boolean;
  resizeLabel?: string;
  width?: number;
  onResizeByKeyboard?: (key: AlertTableColumnKey, delta: number) => void;
  onResizeStart?: (key: AlertTableColumnKey, clientX: number) => void;
};

type ResizableHeaderCellProps = HTMLAttributes<HTMLTableCellElement> &
  ResizableHeaderCellInjectedProps & {
    children?: ReactNode;
  };

const RESIZE_HANDLE_STYLE: CSSProperties = {
  alignItems: "center",
  cursor: "col-resize",
  display: "flex",
  height: "100%",
  justifyContent: "center",
  position: "absolute",
  right: -4,
  top: 0,
  touchAction: "none",
  userSelect: "none",
  width: 8,
  zIndex: 2,
};

const RESIZE_HANDLE_MARK_STYLE: CSSProperties = {
  backgroundColor: "currentColor",
  height: "40%",
  opacity: 0.18,
  pointerEvents: "none",
  width: 1,
};

function cloneDefaultColumnWidths(): AlertTableColumnWidths {
  return Object.fromEntries(
    (
      Object.keys(ALERT_TABLE_COLUMN_DEFAULT_WIDTHS) as AlertTableColumnKey[]
    ).map((key) => [key, ALERT_TABLE_COLUMN_DEFAULT_WIDTHS[key]]),
  ) as AlertTableColumnWidths;
}

function createDefaultAlertTablePreference(): AlertTablePreference {
  return {
    columnWidths: cloneDefaultColumnWidths(),
    columnsState: {},
    sort: {},
  };
}

function clampColumnWidth(value: unknown, fallback: number) {
  const width = Number(value);
  if (!Number.isFinite(width)) {
    return fallback;
  }
  return Math.min(
    ALERT_TABLE_COLUMN_WIDTH_MAX,
    Math.max(ALERT_TABLE_COLUMN_WIDTH_MIN, Math.round(width)),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeColumnWidths(value: unknown): AlertTableColumnWidths {
  const widths = cloneDefaultColumnWidths();
  const source =
    value && typeof value === "object"
      ? (value as Partial<Record<AlertTableColumnKey, unknown>>)
      : {};

  for (const key of Object.keys(
    ALERT_TABLE_COLUMN_DEFAULT_WIDTHS,
  ) as AlertTableColumnKey[]) {
    const stored = source[key];
    const storedWidth = isRecord(stored) ? stored.width : stored;
    widths[key] = clampColumnWidth(
      storedWidth,
      ALERT_TABLE_COLUMN_DEFAULT_WIDTHS[key],
    );
  }
  widths.actions = ALERT_TABLE_COLUMN_DEFAULT_WIDTHS.actions;
  return widths;
}

function normalizeColumnsState(value: unknown): AlertColumnsState {
  if (!isRecord(value)) {
    return {};
  }
  const next: AlertColumnsState = {};
  const validColumnKeys = new Set(
    Object.keys(ALERT_TABLE_COLUMN_DEFAULT_WIDTHS),
  );
  for (const [key, state] of Object.entries(value)) {
    if (!validColumnKeys.has(key) || !isRecord(state)) {
      continue;
    }
    const entry: AlertColumnsStateEntry = {};
    if (typeof state.show === "boolean") {
      entry.show = state.show;
    }
    if (state.fixed === "left" || state.fixed === "right") {
      entry.fixed = state.fixed;
    }
    if (Number.isFinite(Number(state.order))) {
      entry.order = Number(state.order);
    }
    if (
      typeof state.disable === "boolean" ||
      (isRecord(state.disable) && typeof state.disable.checkbox === "boolean")
    ) {
      entry.disable = state.disable as AlertColumnsStateEntry["disable"];
    }
    if (Object.keys(entry).length) {
      next[key] = entry;
    }
  }
  return next;
}

function normalizeSortState(value: unknown): AlertTableSortState {
  if (!isRecord(value)) {
    return {};
  }
  const next: AlertTableSortState = {};
  const validColumnKeys = new Set(
    Object.keys(ALERT_TABLE_COLUMN_DEFAULT_WIDTHS),
  );
  for (const [key, order] of Object.entries(value)) {
    if (!validColumnKeys.has(key)) {
      continue;
    }
    if (order === "ascend" || order === "descend" || order === null) {
      next[key] = order;
    }
  }
  return next;
}

function mergeAlertTablePreference(value: unknown): AlertTablePreference {
  const defaults = createDefaultAlertTablePreference();
  if (!isRecord(value)) {
    return defaults;
  }
  return {
    columnWidths: mergeColumnWidths(
      value.columnWidths ?? value.widths ?? value,
    ),
    columnsState: normalizeColumnsState(value.columnsState),
    sort: normalizeSortState(value.sort),
  };
}

function readStoredAlertTablePreference(): AlertTablePreference {
  if (typeof window === "undefined") {
    return createDefaultAlertTablePreference();
  }
  try {
    const raw = window.localStorage.getItem(ALERT_TABLE_PREFERENCE_STORAGE_KEY);
    if (raw) {
      return mergeAlertTablePreference(JSON.parse(raw));
    }
    const legacyWidths = window.localStorage.getItem(
      ALERT_TABLE_COLUMN_WIDTH_STORAGE_KEY,
    );
    if (legacyWidths) {
      return mergeAlertTablePreference({
        columnWidths: JSON.parse(legacyWidths),
      });
    }
    return createDefaultAlertTablePreference();
  } catch {
    return createDefaultAlertTablePreference();
  }
}

function writeStoredAlertTablePreference(preference: AlertTablePreference) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const normalized = mergeAlertTablePreference(preference);
    window.localStorage.setItem(
      ALERT_TABLE_PREFERENCE_STORAGE_KEY,
      JSON.stringify(normalized),
    );
    window.localStorage.setItem(
      ALERT_TABLE_COLUMN_WIDTH_STORAGE_KEY,
      JSON.stringify(normalized.columnWidths),
    );
  } catch {
    // localStorage may be unavailable in private or restricted browser contexts.
  }
}

function clearStoredAlertTablePreference() {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(ALERT_TABLE_PREFERENCE_STORAGE_KEY);
    window.localStorage.removeItem(ALERT_TABLE_COLUMN_WIDTH_STORAGE_KEY);
  } catch {
    // localStorage may be unavailable in private or restricted browser contexts.
  }
}

function ResizableHeaderCell({
  children,
  columnKey,
  resizable,
  resizeLabel,
  style,
  width,
  onResizeByKeyboard,
  onResizeStart,
  ...rest
}: ResizableHeaderCellProps) {
  const numericWidth = typeof width === "number" ? width : undefined;
  const mergedStyle: CSSProperties = {
    ...style,
    minWidth: numericWidth ?? style?.minWidth,
    position: "relative",
    width: numericWidth ?? style?.width,
  };

  function stopHeaderEvent(
    event: KeyboardEvent<HTMLSpanElement> | ReactPointerEvent<HTMLSpanElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLSpanElement>) {
    if (!columnKey || !onResizeStart) {
      return;
    }
    stopHeaderEvent(event);
    onResizeStart(columnKey, event.clientX);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLSpanElement>) {
    if (!columnKey || !onResizeByKeyboard) {
      return;
    }
    const step = event.shiftKey ? 40 : 10;
    if (event.key === "ArrowLeft") {
      stopHeaderEvent(event);
      onResizeByKeyboard(columnKey, -step);
    }
    if (event.key === "ArrowRight") {
      stopHeaderEvent(event);
      onResizeByKeyboard(columnKey, step);
    }
  }

  return (
    <th {...rest} style={mergedStyle}>
      {children}
      {resizable && columnKey ? (
        <span
          aria-label={resizeLabel}
          aria-orientation="vertical"
          aria-valuemax={ALERT_TABLE_COLUMN_WIDTH_MAX}
          aria-valuemin={ALERT_TABLE_COLUMN_WIDTH_MIN}
          aria-valuenow={numericWidth}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onKeyDown={handleKeyDown}
          onPointerDown={handlePointerDown}
          role="separator"
          style={RESIZE_HANDLE_STYLE}
          tabIndex={0}
        >
          <span aria-hidden="true" style={RESIZE_HANDLE_MARK_STYLE} />
        </span>
      ) : null}
    </th>
  );
}

export default function AlertsPage() {
  const t = useTranslations();
  const { message } = App.useApp();
  const actionRef = useRef<ActionType | undefined>(undefined);
  const initialTablePreferenceRef = useRef<AlertTablePreference | null>(null);
  if (!initialTablePreferenceRef.current) {
    initialTablePreferenceRef.current = readStoredAlertTablePreference();
  }
  const [columnWidths, setColumnWidths] = useState<AlertTableColumnWidths>(
    () => initialTablePreferenceRef.current!.columnWidths,
  );
  const [columnsState, setColumnsState] = useState<AlertColumnsState>(
    () => initialTablePreferenceRef.current!.columnsState,
  );
  const [selectedAlert, setSelectedAlert] = useState<any | null>(null);
  const [tableLastUpdatedAt, setTableLastUpdatedAt] = useState<number | null>(
    null,
  );
  const [tableRefreshError, setTableRefreshError] = useState(false);
  const columnWidthsRef = useRef<AlertTableColumnWidths>(
    initialTablePreferenceRef.current!.columnWidths,
  );
  const tablePreferenceRef = useRef<AlertTablePreference>(
    initialTablePreferenceRef.current!,
  );
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const preferenceSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const permissions = usePermissions();
  const { mode, isMobile, isTabletPortrait, isTabletLandscape } =
    useResponsiveMode();
  const isCompactOperationsView = isMobile || isTabletPortrait;
  const canAcknowledgeAlerts = permissions.hasPermission("alerts:ack");
  const canDetectOffline = permissions.hasPermission("devices:manage");
  const autoRefresh = useAutoRefreshControl({
    storageKey: "nmth.alerts.autoRefresh",
  });
  const compactAlerts = useQuery({
    queryKey: ["alerts", "compact"],
    queryFn: () =>
      apiFetch<any>(buildAlertsListPath({ current: 1, pageSize: 20 })),
    retry: 1,
    enabled: isCompactOperationsView,
  });
  const alertsLastUpdatedAt = newestTimestamp([
    compactAlerts.dataUpdatedAt,
    tableLastUpdatedAt,
  ]);
  const alertsHasRefreshError = compactAlerts.isError || tableRefreshError;
  const alertsIsFetching = compactAlerts.isFetching;
  const alertLevelMessageKeys: Record<string, string> = {
    info: "alert.info",
    warning: "alert.warning",
    critical: "alert.critical",
  };
  const alertStatusMessageKeys: Record<string, string> = {
    active: "alert.statusActive",
    acknowledged: "alert.statusAcknowledged",
    resolved: "alert.statusResolved",
    offline: "alert.statusOffline",
    silenced: "alert.statusSilenced",
  };
  const thresholdMetricMessageKeys: Record<string, string> = {
    temperature: "alert.metricTemperature",
    humidity: "alert.metricHumidity",
  };
  const thresholdDirectionMessageKeys: Record<string, string> = {
    above: "alert.directionAbove",
    below: "alert.directionBelow",
  };

  const persistTablePreference = useCallback(
    (preference: AlertTablePreference, debounce = true) => {
      if (preferenceSaveTimerRef.current) {
        clearTimeout(preferenceSaveTimerRef.current);
        preferenceSaveTimerRef.current = null;
      }
      const normalized = mergeAlertTablePreference(preference);
      const persist = () => {
        void apiFetch(
          `/system/user-preferences/${encodeURIComponent(ALERT_TABLE_PREFERENCE_KEY)}`,
          {
            method: "PUT",
            body: JSON.stringify({ value: normalized }),
          },
        ).catch(() => undefined);
      };
      if (debounce) {
        preferenceSaveTimerRef.current = setTimeout(persist, 500);
        return;
      }
      persist();
    },
    [],
  );

  const commitTablePreference = useCallback(
    (
      patch: Partial<AlertTablePreference>,
      options: { remote?: boolean; debounce?: boolean } = {},
    ) => {
      const next = mergeAlertTablePreference({
        ...tablePreferenceRef.current,
        ...patch,
      });
      tablePreferenceRef.current = next;
      columnWidthsRef.current = next.columnWidths;
      setColumnWidths(next.columnWidths);
      setColumnsState(next.columnsState);
      writeStoredAlertTablePreference(next);
      if (options.remote !== false) {
        persistTablePreference(next, options.debounce ?? true);
      }
      return next;
    },
    [persistTablePreference],
  );

  useEffect(() => {
    const localPreference = readStoredAlertTablePreference();
    commitTablePreference(localPreference, { remote: false });
    let cancelled = false;
    void apiFetch<{ key: string; value: unknown | null }>(
      `/system/user-preferences/${encodeURIComponent(ALERT_TABLE_PREFERENCE_KEY)}`,
    )
      .then((preference) => {
        if (cancelled) {
          return;
        }
        if (preference.value) {
          commitTablePreference(mergeAlertTablePreference(preference.value), {
            remote: false,
          });
          return;
        }
        persistTablePreference(localPreference, true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [commitTablePreference, persistTablePreference]);

  useEffect(() => {
    return () => {
      resizeCleanupRef.current?.();
      if (preferenceSaveTimerRef.current) {
        clearTimeout(preferenceSaveTimerRef.current);
      }
    };
  }, []);

  const applyColumnWidth = useCallback(
    (key: AlertTableColumnKey, value: unknown) => {
      if (key === "actions") {
        return columnWidthsRef.current;
      }
      const nextWidth = clampColumnWidth(
        value,
        ALERT_TABLE_COLUMN_DEFAULT_WIDTHS[key],
      );
      const previous = columnWidthsRef.current;
      if (previous[key] === nextWidth) {
        return previous;
      }
      const next = {
        ...previous,
        [key]: nextWidth,
        actions: ALERT_TABLE_COLUMN_DEFAULT_WIDTHS.actions,
      };
      columnWidthsRef.current = next;
      setColumnWidths(next);
      return next;
    },
    [],
  );

  const handleColumnResizeStart = useCallback(
    (key: AlertTableColumnKey, clientX: number) => {
      if (key === "actions" || typeof document === "undefined") {
        return;
      }

      resizeCleanupRef.current?.();

      const startWidth = columnWidthsRef.current[key];
      const startClientX = clientX;
      const originalCursor = document.body.style.cursor;
      const originalUserSelect = document.body.style.userSelect;

      function handlePointerMove(event: PointerEvent) {
        event.preventDefault();
        applyColumnWidth(key, startWidth + event.clientX - startClientX);
      }

      function finishResize() {
        document.removeEventListener("pointermove", handlePointerMove);
        document.removeEventListener("pointerup", finishResize);
        document.removeEventListener("pointercancel", finishResize);
        document.body.style.cursor = originalCursor;
        document.body.style.userSelect = originalUserSelect;
        resizeCleanupRef.current = null;
        commitTablePreference({ columnWidths: columnWidthsRef.current });
      }

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("pointermove", handlePointerMove);
      document.addEventListener("pointerup", finishResize);
      document.addEventListener("pointercancel", finishResize);
      resizeCleanupRef.current = finishResize;
    },
    [applyColumnWidth, commitTablePreference],
  );

  const handleColumnResizeByKeyboard = useCallback(
    (key: AlertTableColumnKey, delta: number) => {
      const next = applyColumnWidth(key, columnWidthsRef.current[key] + delta);
      commitTablePreference({ columnWidths: next });
    },
    [applyColumnWidth, commitTablePreference],
  );

  const handleColumnsStateChange = useCallback(
    (nextColumnsState: AlertColumnsState) => {
      commitTablePreference({
        columnsState: normalizeColumnsState(nextColumnsState),
      });
    },
    [commitTablePreference],
  );

  function restoreAlertTableDefaults() {
    const defaults = createDefaultAlertTablePreference();
    tablePreferenceRef.current = defaults;
    columnWidthsRef.current = defaults.columnWidths;
    setColumnWidths(defaults.columnWidths);
    setColumnsState(defaults.columnsState);
    clearStoredAlertTablePreference();
    if (preferenceSaveTimerRef.current) {
      clearTimeout(preferenceSaveTimerRef.current);
      preferenceSaveTimerRef.current = null;
    }
    void apiFetch(
      `/system/user-preferences/${encodeURIComponent(ALERT_TABLE_PREFERENCE_KEY)}`,
      { method: "DELETE" },
    ).catch(() => undefined);
    message.success(t("alert.tableDefaultsRestored"));
  }

  function metadata(row: any) {
    return row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  }
  function safeBackendLabel(value: unknown) {
    const label = String(value ?? "")
      .replace(/[_-]+/g, " ")
      .trim();
    return label || "-";
  }
  function sanitizedBackendMessage(value: unknown) {
    const label = String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();
    return label || "-";
  }
  function localizedKnownValue(
    value: unknown,
    messageKeys: Record<string, string>,
  ) {
    const key = String(value ?? "");
    const messageKey = messageKeys[key];
    return messageKey ? t(messageKey) : safeBackendLabel(value);
  }
  function alertDeviceName(row: any) {
    const label = String(
      row.device?.displayName ?? row.device?.deviceName ?? row.deviceName ?? "",
    ).trim();
    return label || "-";
  }
  function thresholdMetricFromType(type: unknown) {
    if (type === "temperature_threshold") return "temperature";
    if (type === "humidity_threshold") return "humidity";
    return undefined;
  }
  function formatMetricValue(value: unknown, metric: string) {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return undefined;
    }
    const unit = metric === "temperature" ? "C" : "%RH";
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(numericValue)} ${unit}`;
  }
  function alertLevelColor(level: unknown) {
    if (level === "critical") return "red";
    if (level === "warning") return "orange";
    if (level === "info") return "blue";
    return "default";
  }
  function effectiveAlertStatus(row: any) {
    return Array.isArray(row.activeSilences) && row.activeSilences.length > 0
      ? "silenced"
      : row.status;
  }
  function formatThresholdBound(row: any) {
    const data = metadata(row);
    if (!data.thresholdMetric) {
      return "-";
    }
    const metric = localizedKnownValue(
      data.thresholdMetric,
      thresholdMetricMessageKeys,
    );
    const direction = data.thresholdDirection
      ? localizedKnownValue(
          data.thresholdDirection,
          thresholdDirectionMessageKeys,
        )
      : "";
    const limit = String(data.thresholdLimit ?? "-");
    return direction
      ? t("alert.thresholdSummary", { metric, direction, limit })
      : `${metric} ${limit}`;
  }
  function formatExceededDuration(value: unknown) {
    if (value === undefined || value === null || value === "") {
      return "-";
    }
    const totalMinutes = Math.floor(Number(value));
    if (!Number.isFinite(totalMinutes) || totalMinutes < 0) {
      return "-";
    }
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const parts = [];
    if (hours > 0) {
      parts.push(t("alert.durationHoursShort", { count: hours }));
    }
    if (minutes > 0 || parts.length === 0) {
      parts.push(t("alert.durationMinutesShort", { count: minutes }));
    }
    return parts.join(" ");
  }
  function formatFallbackAlertDetail(row: any) {
    return sanitizedBackendMessage(row.message);
  }
  function formatThresholdAlertDetail(row: any) {
    const data = metadata(row);
    const metricKey = String(
      data.thresholdMetric ?? thresholdMetricFromType(row.type) ?? "",
    );
    const directionKey = String(data.thresholdDirection ?? "");
    const metricMessageKey = thresholdMetricMessageKeys[metricKey];
    const directionMessageKey = thresholdDirectionMessageKeys[directionKey];
    const metric = metricMessageKey ? t(metricMessageKey) : "";
    const direction = directionMessageKey ? t(directionMessageKey) : "";
    const measuredValue = formatMetricValue(data.measuredValue, metricKey);
    const limitValue = formatMetricValue(data.thresholdLimit, metricKey);
    const duration = formatExceededDuration(data.exceededMinutes);
    const device = alertDeviceName(row);

    if (
      !device ||
      device === "-" ||
      !metric ||
      !direction ||
      !measuredValue ||
      !limitValue ||
      duration === "-"
    ) {
      return formatFallbackAlertDetail(row);
    }
    return t("alert.thresholdDetail", {
      device,
      metric,
      direction,
      measuredValueLabel: t("alert.measuredValue"),
      measuredValue,
      limitValueLabel: t("alert.limitValue"),
      limitValue,
      exceededDurationLabel: t("alert.exceededDuration"),
      duration,
    });
  }
  function formatOfflineAlertDetail(row: any) {
    const data = metadata(row);
    const cutoffMinutes = Math.floor(Number(data.cutoffMinutes));
    const device = alertDeviceName(row);
    if (
      !device ||
      device === "-" ||
      !Number.isFinite(cutoffMinutes) ||
      cutoffMinutes <= 0
    ) {
      return formatFallbackAlertDetail(row);
    }
    return t("alert.offlineDetail", { device, cutoffMinutes });
  }
  function formatAlertDetail(row: any) {
    if (
      row.type === "humidity_threshold" ||
      row.type === "temperature_threshold"
    ) {
      return formatThresholdAlertDetail(row);
    }
    if (row.type === "device_offline") {
      return formatOfflineAlertDetail(row);
    }
    return formatFallbackAlertDetail(row);
  }

  function formatTriggeredAt(value: unknown) {
    return value ? new Date(String(value)).toLocaleString() : "-";
  }

  const reloadAlertViews = useCallback(() => {
    actionRef.current?.reload();
    if (isCompactOperationsView) {
      void compactAlerts.refetch();
    }
    setTableLastUpdatedAt(Date.now());
    setTableRefreshError(false);
  }, [compactAlerts, isCompactOperationsView]);

  useAutoRefreshTrigger({
    autoRefreshEnabled: autoRefresh.autoRefreshEnabled,
    enabled: !selectedAlert,
    intervalMs: ALERT_ACTIVE_REFRESH_MS,
    isVisible: autoRefresh.isVisible,
    onRefresh: reloadAlertViews,
  });

  function openAlertDetail(row: any) {
    setSelectedAlert(row);
  }

  function handleAlertCardKeyDown(event: KeyboardEvent<HTMLElement>, row: any) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openAlertDetail(row);
    }
  }

  async function acknowledgeAlert(row: any, reload?: () => void) {
    try {
      await apiFetch(`/alerts/${row.id}/acknowledge`, {
        method: "POST",
        body: JSON.stringify({ note: t("alert.acknowledge") }),
      });
      message.success(t("alert.acknowledge"));
      reload?.();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("app.error"));
    }
  }

  async function silenceAlert(row: any, reload?: () => void) {
    try {
      await apiFetch(`/alerts/${row.id}/silence`, {
        method: "POST",
        body: JSON.stringify({
          durationMinutes: 60,
          reason: t("alert.silence"),
        }),
      });
      message.success(t("alert.silence"));
      reload?.();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("app.error"));
    }
  }

  function buildAlertActions(row: any, reload?: () => void): ResponsiveAction[] {
    return canAcknowledgeAlerts
      ? [
          {
            key: "acknowledge",
            label: t("alert.acknowledge"),
            ariaLabel: t("alert.acknowledge"),
            icon: <CheckCircle2 size={15} />,
            kind: "row-primary",
            frequency: "high",
            risk: "state-change",
            reversible: false,
            permission: "alerts:ack",
            onClick: () => acknowledgeAlert(row, reload),
          },
          {
            key: "silence",
            label: t("alert.silence"),
            ariaLabel: t("alert.silence"),
            icon: <BellOff size={15} />,
            kind: "row-secondary",
            frequency: "high",
            risk: "state-change",
            reversible: false,
            permission: "alerts:ack",
            confirm: {
              title: t("alert.silenceConfirmTitle"),
              description: t("alert.silenceConfirmDescription"),
              okText: t("alert.silenceConfirmOk"),
              cancelText: t("app.cancel"),
            },
            onClick: () => silenceAlert(row, reload),
          },
        ]
      : [];
  }

  function renderAlertActions(row: any, reload?: () => void) {
    if (!canAcknowledgeAlerts) {
      return null;
    }
    return (
      <ResponsiveActionGroup
        actions={buildAlertActions(row, reload)}
        ariaLabel={t("app.actions")}
        maxVisibleTablet={2}
        mode={mode}
        permissions={permissions.permissions}
        surface="row"
      />
    );
  }

  function renderAlertDrawerActions(row: any) {
    if (!canAcknowledgeAlerts) {
      return null;
    }
    return (
      <ResponsiveActionGroup
        actions={buildAlertActions(row, reloadAlertViews)}
        mode={mode}
        permissions={permissions.permissions}
        surface="drawer-footer"
        touch
      />
    );
  }

  const baseColumns: AlertColumn[] = [
    {
      key: "level",
      title: t("alert.level"),
      dataIndex: "level",
      valueEnum: {
        info: { text: t("alert.info"), status: "Processing" },
        warning: { text: t("alert.warning"), status: "Warning" },
        critical: { text: t("alert.critical"), status: "Error" },
      },
      render: (_, row) => (
        <Tag color={alertLevelColor(row.level)}>
          {localizedKnownValue(row.level, alertLevelMessageKeys)}
        </Tag>
      ),
    },
    {
      key: "device",
      title: t("device.deviceName"),
      dataIndex: ["device", "deviceName"],
    },
    {
      key: "exhibition",
      title: t("exhibition.name"),
      dataIndex: ["exhibition", "name"],
      search: false,
    },
    {
      key: "bound",
      title: t("alert.bound"),
      search: false,
      render: (_, row) => formatThresholdBound(row),
    },
    {
      key: "exceededDuration",
      title: t("alert.exceededDuration"),
      search: false,
      render: (_, row) => formatExceededDuration(metadata(row).exceededMinutes),
    },
    {
      key: "notificationCount",
      title: t("alert.notificationCount"),
      search: false,
      render: (_, row) =>
        `${metadata(row).notificationCount ?? 0}/${metadata(row).maxNotifications ?? "-"}`,
    },
    {
      key: "nextReminder",
      title: t("alert.nextReminder"),
      search: false,
      render: (_, row) => {
        const nextReminderAt = metadata(row).nextReminderAt;
        return nextReminderAt
          ? new Date(String(nextReminderAt)).toLocaleString()
          : "-";
      },
    },
    {
      key: "triggeredAt",
      title: t("alert.triggeredAt"),
      dataIndex: "triggeredAt",
      valueType: "dateTime",
      search: false,
    },
    {
      key: "status",
      title: t("app.status"),
      dataIndex: "status",
      valueEnum: {
        active: { text: t("alert.statusActive") },
        acknowledged: { text: t("alert.statusAcknowledged") },
        resolved: { text: t("alert.statusResolved") },
        offline: { text: t("alert.statusOffline") },
        silenced: { text: t("alert.statusSilenced") },
      },
      render: (_, row) => {
        const status = effectiveAlertStatus(row);
        return localizedKnownValue(status, alertStatusMessageKeys);
      },
    },
    {
      key: "detail",
      title: t("alert.detail"),
      search: false,
      ellipsis: true,
      render: (_, row) => {
        const detail = formatAlertDetail(row);
        return detail === "-" ? (
          "-"
        ) : (
          <Tooltip title={detail}>
            <span>{detail}</span>
          </Tooltip>
        );
      },
    },
    ...(canAcknowledgeAlerts
      ? [
          {
            key: "actions",
            title: t("app.actions"),
            valueType: "option",
            render: (_, row, _index, action) => [
              <span key="actions">
                {renderAlertActions(
                  row,
                  () => action?.reload(),
                )}
              </span>,
            ],
          } satisfies AlertColumn,
        ]
      : []),
  ];
  const activeBaseColumns = isTabletLandscape
    ? baseColumns.filter((column) =>
        ALERT_TABLET_LANDSCAPE_COLUMN_KEYS.includes(column.key),
      )
    : baseColumns;
  const columns: ProColumns<any>[] = baseColumns.map((column) => {
    const width =
      column.key === "actions"
        ? ALERT_TABLE_COLUMN_DEFAULT_WIDTHS.actions
        : columnWidths[column.key];
    const titleText = typeof column.title === "string" ? column.title : "";
    return {
      ...column,
      width,
      onHeaderCell: () =>
        ({
          columnKey: column.key,
          resizable: column.key !== "actions",
          resizeLabel: t("alert.resizeColumn", { column: titleText }),
          width,
          onResizeByKeyboard: handleColumnResizeByKeyboard,
          onResizeStart: handleColumnResizeStart,
        }) as HTMLAttributes<HTMLTableCellElement> &
          ResizableHeaderCellInjectedProps,
    };
  });
  const tableScrollX = Math.max(
    isTabletLandscape ? 760 : ALERT_TABLE_SCROLL_X_MIN,
    activeBaseColumns.reduce(
      (total, column) => total + columnWidths[column.key],
      0,
    ),
  );
  const tableColumns = isTabletLandscape
    ? columns.filter((column) =>
        ALERT_TABLET_LANDSCAPE_COLUMN_KEYS.includes(
          column.key as AlertTableColumnKey,
        ),
      )
    : columns;

  return (
    <AppShell>
      <RequirePermission permission="alerts:read">
        <PageHeader
          eyebrow={t("alert.lifecycleEyebrow")}
          title={t("alert.title")}
          actions={
            <>
              <AutoRefreshStatus
                enabled={autoRefresh.autoRefreshEnabled}
                intervalMs={ALERT_ACTIVE_REFRESH_MS}
                isError={alertsHasRefreshError}
                isFetching={alertsIsFetching}
                isPaused={
                  autoRefresh.autoRefreshEnabled &&
                  (!autoRefresh.isVisible || Boolean(selectedAlert))
                }
                isStale={autoRefresh.isTimestampStale(
                  alertsLastUpdatedAt,
                  ALERT_STALE_WARNING_MS,
                )}
                lastUpdatedAt={alertsLastUpdatedAt}
                onEnabledChange={autoRefresh.setAutoRefreshEnabled}
              />
              {canDetectOffline ? (
                <Button
                  icon={<RefreshCw size={15} />}
                  onClick={async () => {
                    try {
                      await apiFetch("/alerts/detect-offline", {
                        method: "POST",
                        body: JSON.stringify({ cutoffMinutes: 3 }),
                      });
                      message.success(t("app.refresh"));
                      reloadAlertViews();
                    } catch (error) {
                      message.error(
                        error instanceof Error ? error.message : t("app.error"),
                      );
                    }
                  }}
                >
                  {t("app.refresh")}
                </Button>
              ) : null}
            </>
          }
        />
        {isCompactOperationsView ? (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            {compactAlerts.data?.items?.length ? (
              compactAlerts.data.items.map((row: any) => {
                const detail = formatAlertDetail(row);
                return (
                  <Card
                    aria-label={`${t("alert.detail")} ${alertDeviceName(row)}`}
                    key={row.id}
                    className="nmth-panel"
                    size="small"
                    onClick={() => openAlertDetail(row)}
                    onKeyDown={(event) => handleAlertCardKeyDown(event, row)}
                    role="button"
                    styles={{ body: { padding: 14 } }}
                    style={{ cursor: "pointer" }}
                    tabIndex={0}
                  >
                    <Space
                      direction="vertical"
                      size={12}
                      style={{ width: "100%" }}
                    >
                      <Space
                        direction="vertical"
                        size={4}
                        style={{ minWidth: 0, width: "100%" }}
                      >
                        <Space wrap size={6}>
                          <Tag color={alertLevelColor(row.level)}>
                            {localizedKnownValue(
                              row.level,
                              alertLevelMessageKeys,
                            )}
                          </Tag>
                          <Tag>
                            {localizedKnownValue(
                              effectiveAlertStatus(row),
                              alertStatusMessageKeys,
                            )}
                          </Tag>
                        </Space>
                        <Typography.Text strong ellipsis>
                          {alertDeviceName(row)}
                        </Typography.Text>
                        <Typography.Text type="secondary" ellipsis>
                          {row.exhibition?.name ?? "-"}
                        </Typography.Text>
                      </Space>
                      <div
                        style={{
                          display: "grid",
                          gap: 8,
                          gridTemplateColumns: isMobile
                            ? "1fr"
                            : "repeat(2, minmax(0, 1fr))",
                        }}
                      >
                        <Typography.Text type="secondary">
                          {t("alert.triggeredAt")}:{" "}
                          {formatTriggeredAt(row.triggeredAt)}
                        </Typography.Text>
                        <Typography.Text type="secondary">
                          {t("alert.exceededDuration")}:{" "}
                          {formatExceededDuration(
                            metadata(row).exceededMinutes,
                          )}
                        </Typography.Text>
                        <Typography.Text type="secondary">
                          {t("alert.bound")}: {formatThresholdBound(row)}
                        </Typography.Text>
                        <Typography.Text type="secondary">
                          {t("alert.notificationCount")}:{" "}
                          {metadata(row).notificationCount ?? 0}/
                          {metadata(row).maxNotifications ?? "-"}
                        </Typography.Text>
                      </div>
                      <Typography.Paragraph
                        ellipsis={{ rows: 2 }}
                        style={{ marginBottom: 0 }}
                      >
                        {detail}
                      </Typography.Paragraph>
                    </Space>
                  </Card>
                );
              })
            ) : (
              <Card className="nmth-panel">
                <Empty
                  description={
                    compactAlerts.isLoading ? t("app.loading") : t("app.empty")
                  }
                />
              </Card>
            )}
          </Space>
        ) : (
          <ProTable
            actionRef={actionRef}
            className="nmth-panel"
            rowKey="id"
            columns={tableColumns}
            request={async (params, sort) => {
              const sortState = normalizeSortState(sort);
              if (Object.keys(sortState).length) {
                commitTablePreference({ sort: sortState });
              }
              try {
                const result = await apiFetch<any>(buildAlertsListPath(params));
                setTableLastUpdatedAt(Date.now());
                setTableRefreshError(false);
                return { data: result.items, success: true, total: result.total };
              } catch (error) {
                setTableRefreshError(true);
                throw error;
              }
            }}
            pagination={{ pageSize: 20 }}
            search={{ labelWidth: "auto" }}
            scroll={{ x: tableScrollX }}
            components={{ header: { cell: ResizableHeaderCell } }}
            columnsState={{
              value: columnsState,
              onChange: handleColumnsStateChange,
            }}
            options={{
              density: true,
              reload: true,
              setting: true,
            }}
            toolBarRender={() => [
              <Button
                key="restore-defaults"
                icon={<RefreshCcw size={15} />}
                onClick={restoreAlertTableDefaults}
              >
                {t("alert.restoreTableDefaults")}
              </Button>,
            ]}
            onRow={(record) =>
              isTabletLandscape
                ? {
                    onClick: () => openAlertDetail(record),
                    style: { cursor: "pointer" },
                  }
                : {}
            }
          />
        )}
        <Drawer
          title={t("alert.detail")}
          open={Boolean(selectedAlert)}
          onClose={() => setSelectedAlert(null)}
          width="min(560px, 100vw)"
          footer={
            selectedAlert ? renderAlertDrawerActions(selectedAlert) : null
          }
        >
          {selectedAlert ? (
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <Space wrap>
                <Tag color={alertLevelColor(selectedAlert.level)}>
                  {localizedKnownValue(
                    selectedAlert.level,
                    alertLevelMessageKeys,
                  )}
                </Tag>
                <Tag>
                  {localizedKnownValue(
                    effectiveAlertStatus(selectedAlert),
                    alertStatusMessageKeys,
                  )}
                </Tag>
              </Space>
              <Descriptions column={1} size="small">
                <Descriptions.Item label={t("device.deviceName")}>
                  {alertDeviceName(selectedAlert)}
                </Descriptions.Item>
                <Descriptions.Item label={t("exhibition.name")}>
                  {selectedAlert.exhibition?.name ?? "-"}
                </Descriptions.Item>
                <Descriptions.Item label={t("alert.bound")}>
                  {formatThresholdBound(selectedAlert)}
                </Descriptions.Item>
                <Descriptions.Item label={t("alert.exceededDuration")}>
                  {formatExceededDuration(
                    metadata(selectedAlert).exceededMinutes,
                  )}
                </Descriptions.Item>
                <Descriptions.Item label={t("alert.triggeredAt")}>
                  {formatTriggeredAt(selectedAlert.triggeredAt)}
                </Descriptions.Item>
                <Descriptions.Item label={t("alert.nextReminder")}>
                  {metadata(selectedAlert).nextReminderAt
                    ? formatTriggeredAt(metadata(selectedAlert).nextReminderAt)
                    : "-"}
                </Descriptions.Item>
                <Descriptions.Item label={t("alert.detail")}>
                  {formatAlertDetail(selectedAlert)}
                </Descriptions.Item>
              </Descriptions>
            </Space>
          ) : null}
        </Drawer>
      </RequirePermission>
    </AppShell>
  );
}

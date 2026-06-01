"use client";

import {
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Empty,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from "antd";
import type { ActionType, ProColumns } from "@ant-design/pro-components";
import { useQuery } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  CalendarClock,
  FileDown,
  Gauge,
  Pencil,
  Plus,
  RefreshCw,
  Replace,
  Wrench,
} from "lucide-react";
import { formatClimateValue } from "@nmth/shared";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import type { KeyboardEvent } from "react";
import { useCallback, useRef, useState } from "react";
import { AppShell } from "../../../components/AppShell";
import { AutoRefreshStatus } from "../../../components/AutoRefreshStatus";
import { PageHeader } from "../../../components/PageHeader";
import {
  ResponsiveActionGroup,
  type ResponsiveAction,
} from "../../../components/actions";
import { apiFetch, formatRelativeDelay } from "../../../lib/api";
import {
  newestTimestamp,
  useAutoRefreshControl,
  useAutoRefreshTrigger,
} from "../../../lib/autoRefresh";
import { RequirePermission, usePermissions } from "../../../lib/permissions";
import { useResponsiveMode } from "../../../lib/responsive";

const ProTable = dynamic(
  () => import("@ant-design/pro-components").then((module) => module.ProTable),
  { ssr: false },
) as typeof import("@ant-design/pro-components").ProTable;

type DeviceModal = { mode: "create" | "edit"; record?: any } | null;
type OperationType = "calibration" | "maintenance" | "replace";
type DeviceOperation = { type: OperationType; record: any } | null;
type ThresholdModal = { record: any } | null;
type DeviceReceiveStatus = "receiving" | "paused" | "archived";
const DEVICE_LIST_REFRESH_MS = 60_000;
const DEVICE_LIST_STALE_WARNING_MS = 3 * 60_000;

function getDeviceReceiveStatus(record: {
  archivedAt?: string | Date | null;
  enabled?: boolean;
}): DeviceReceiveStatus {
  if (record.archivedAt != null) {
    return "archived";
  }
  return record.enabled ? "receiving" : "paused";
}

function getDeviceStatusColor(status: DeviceReceiveStatus) {
  if (status === "receiving") {
    return "green";
  }
  if (status === "paused") {
    return "gold";
  }
  return "default";
}

function getDeviceStatusMessageKey(status: DeviceReceiveStatus) {
  if (status === "receiving") {
    return "device.statusReceiving";
  }
  if (status === "paused") {
    return "device.statusPaused";
  }
  return "device.statusArchived";
}

export default function DevicesPage() {
  const t = useTranslations();
  const { message } = App.useApp();
  const actionRef = useRef<ActionType | undefined>(undefined);
  const [deviceModal, setDeviceModal] = useState<DeviceModal>(null);
  const [operation, setOperation] = useState<DeviceOperation>(null);
  const [thresholdModal, setThresholdModal] = useState<ThresholdModal>(null);
  const [selectedDevice, setSelectedDevice] = useState<any | null>(null);
  const [tableLastUpdatedAt, setTableLastUpdatedAt] = useState<number | null>(
    null,
  );
  const [tableRefreshError, setTableRefreshError] = useState(false);
  const [deviceForm] = Form.useForm();
  const [operationForm] = Form.useForm();
  const [thresholdForm] = Form.useForm();
  const permissions = usePermissions();
  const { mode, isMobile, isTabletPortrait, isTabletLandscape } =
    useResponsiveMode();
  const isCompactOperationsView = isMobile || isTabletPortrait;
  const canManageDevices = permissions.hasPermission("devices:manage");
  const canManageThresholds = permissions.hasPermission("thresholds:manage");
  const canExportReports = permissions.hasPermission("reports:export");
  const autoRefresh = useAutoRefreshControl({
    storageKey: "nmth.devices.autoRefresh",
  });
  const exhibitions = useQuery({
    queryKey: ["exhibitions", "device-form"],
    queryFn: () => apiFetch<any>("/exhibitions?page=1&pageSize=100"),
    retry: 1,
    enabled: canManageDevices,
  });
  const exhibitionOptions = (exhibitions.data?.items ?? []).map(
    (item: any) => ({ value: item.id, label: item.name }),
  );
  const zoneOptions = (exhibitions.data?.items ?? []).flatMap((item: any) =>
    (item.zones ?? []).map((zone: any) => ({
      value: zone.id,
      label: `${item.name} / ${zone.name}`,
    })),
  );
  const compactDevices = useQuery({
    queryKey: ["devices", "compact-list"],
    queryFn: () => apiFetch<any>("/devices?page=1&pageSize=50"),
    retry: 1,
    enabled: isCompactOperationsView,
  });
  const deviceAutoRefreshBlocked = Boolean(
    deviceModal || operation || thresholdModal || selectedDevice,
  );
  const devicesLastUpdatedAt = newestTimestamp([
    compactDevices.dataUpdatedAt,
    tableLastUpdatedAt,
  ]);
  const devicesHasRefreshError = compactDevices.isError || tableRefreshError;
  const devicesIsFetching = compactDevices.isFetching;

  const reload = useCallback(async () => {
    actionRef.current?.reload();
    if (isCompactOperationsView) {
      await compactDevices.refetch();
    }
    setTableLastUpdatedAt(Date.now());
    setTableRefreshError(false);
  }, [compactDevices, isCompactOperationsView]);

  useAutoRefreshTrigger({
    autoRefreshEnabled: autoRefresh.autoRefreshEnabled,
    enabled: !deviceAutoRefreshBlocked,
    intervalMs: DEVICE_LIST_REFRESH_MS,
    isVisible: autoRefresh.isVisible,
    onRefresh: reload,
  });

  async function openDeviceModal(next: DeviceModal) {
    setDeviceModal(next);
    if (next?.record) {
      deviceForm.setFieldsValue({
        deviceName: next.record.deviceName,
        displayName: next.record.displayName,
        ipAddress: next.record.ipAddress,
        macAddress: next.record.macAddress,
        pointType: next.record.pointType,
        enabled: next.record.archivedAt ? false : next.record.enabled,
        exhibitionId: next.record.exhibitionId,
        zoneId: next.record.zoneId,
      });
    } else {
      deviceForm.resetFields();
      deviceForm.setFieldsValue({ enabled: true, pointType: "ambient" });
    }
  }

  async function saveDevice(values: any) {
    const payload = {
      ...values,
      exhibitionId: values.exhibitionId ?? null,
      zoneId: values.zoneId ?? null,
    };
    if (deviceModal?.mode === "edit" && deviceModal.record?.archivedAt) {
      delete payload.enabled;
    }
    const body = JSON.stringify(payload);
    if (deviceModal?.mode === "edit" && deviceModal.record) {
      await apiFetch(`/devices/${deviceModal.record.id}`, {
        method: "PATCH",
        body,
      });
    } else {
      await apiFetch("/devices", { method: "POST", body });
    }
    message.success(t("app.save"));
    setDeviceModal(null);
    await reload();
  }

  function openOperation(type: OperationType, record: any) {
    setOperation({ type, record });
    operationForm.resetFields();
  }

  function splitMinutes(total: number) {
    return { hours: Math.floor(total / 60), minutes: total % 60 };
  }

  function openThreshold(record: any) {
    const profile = record.thresholdAssignments?.[0]?.profile;
    const trigger = splitMinutes(profile?.triggerDurationMinutes ?? 10);
    const repeat = splitMinutes(profile?.repeatIntervalMinutes ?? 60);
    const unresolved = splitMinutes(profile?.unresolvedReminderMinutes ?? 1440);
    setThresholdModal({ record });
    thresholdForm.setFieldsValue({
      name: profile?.name ?? `${record.displayName} threshold`,
      warningTemperatureMin: profile?.warningTemperatureMin ?? 18,
      warningTemperatureMax: profile?.warningTemperatureMax ?? 25,
      warningHumidityMin: profile?.warningHumidityMin ?? 50,
      warningHumidityMax: profile?.warningHumidityMax ?? 60,
      triggerHours: trigger.hours,
      triggerMinutes: trigger.minutes,
      repeatHours: repeat.hours,
      repeatMinutes: repeat.minutes,
      maxNotifications: profile?.maxNotifications ?? 3,
      unresolvedHours: unresolved.hours,
      unresolvedMinutes: unresolved.minutes,
    });
  }

  async function saveThreshold(values: any) {
    if (!thresholdModal) return;
    const toMinutes = (hours?: number, minutes?: number) =>
      Number(hours ?? 0) * 60 + Number(minutes ?? 0);
    await apiFetch(`/devices/${thresholdModal.record.id}/threshold`, {
      method: "POST",
      body: JSON.stringify({
        name: values.name,
        warningTemperatureMin: values.warningTemperatureMin,
        warningTemperatureMax: values.warningTemperatureMax,
        warningHumidityMin: values.warningHumidityMin,
        warningHumidityMax: values.warningHumidityMax,
        triggerDurationMinutes: toMinutes(
          values.triggerHours,
          values.triggerMinutes,
        ),
        repeatIntervalMinutes: Math.max(
          1,
          toMinutes(values.repeatHours, values.repeatMinutes),
        ),
        maxNotifications: values.maxNotifications,
        unresolvedReminderMinutes: Math.max(
          1,
          toMinutes(values.unresolvedHours, values.unresolvedMinutes),
        ),
      }),
    });
    message.success(t("app.save"));
    setThresholdModal(null);
    await reload();
  }

  async function saveOperation(values: any) {
    if (!operation) return;
    if (operation.type === "calibration") {
      await apiFetch(`/devices/${operation.record.id}/calibrations`, {
        method: "POST",
        body: JSON.stringify({
          calibratedAt: values.calibratedAt.toISOString(),
          validUntil: values.validUntil?.toISOString(),
          certificateUrl: values.certificateUrl,
          note: values.note,
        }),
      });
    }
    if (operation.type === "maintenance") {
      await apiFetch(`/devices/${operation.record.id}/maintenance`, {
        method: "POST",
        body: JSON.stringify({
          type: values.type,
          performedAt: values.performedAt.toISOString(),
          performedBy: values.performedBy,
          note: values.note,
        }),
      });
    }
    if (operation.type === "replace") {
      await apiFetch(`/devices/${operation.record.id}/replace`, {
        method: "POST",
        body: JSON.stringify({
          newDeviceName: values.newDeviceName,
          reason: values.reason,
        }),
      });
    }
    message.success(t("app.save"));
    setOperation(null);
    await reload();
  }

  async function toggleArchiveDevice(record: any) {
    const isArchived = Boolean(record.archivedAt);
    await apiFetch(
      `/devices/${record.id}/${isArchived ? "unarchive" : "archive"}`,
      {
        method: "POST",
        body: JSON.stringify({
          reason: isArchived
            ? "Unarchived from device management UI"
            : "Archived from device management UI",
        }),
      },
    );
    message.success(
      isArchived ? t("device.unarchiveDevice") : t("device.archiveDevice"),
    );
    await reload();
  }

  const isEditingArchivedDevice = Boolean(deviceModal?.record?.archivedAt);

  function latestMeasurement(row: any) {
    return row.measurements?.[0] ?? row.latestMeasurement;
  }

  function thresholdProfileName(row: any) {
    return row.thresholdAssignments?.[0]?.profile?.name ?? "-";
  }

  function openDeviceDetail(row: any) {
    setSelectedDevice(row);
  }

  function handleDeviceCardKeyDown(
    event: KeyboardEvent<HTMLElement>,
    row: any,
  ) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDeviceDetail(row);
    }
  }

  function buildDeviceActions(row: any): ResponsiveAction[] {
    const isArchived = Boolean(row.archivedAt);
    const archiveLabel = isArchived
      ? t("device.unarchiveDevice")
      : t("device.archiveDevice");
    return [
      canManageDevices
        ? {
            key: "edit",
            label: t("app.edit"),
            ariaLabel: t("app.edit"),
            icon: <Pencil size={15} />,
            kind: "row-primary",
            frequency: "high",
            risk: "low",
            permission: "devices:manage",
            onClick: () => {
              void openDeviceModal({ mode: "edit", record: row });
            },
          }
        : null,
      canManageThresholds
        ? {
            key: "threshold",
            label: t("device.thresholdSettings"),
            ariaLabel: t("device.thresholdSettings"),
            icon: <Gauge size={15} />,
            kind: "row-secondary",
            frequency: "high",
            risk: "low",
            permission: "thresholds:manage",
            onClick: () => openThreshold(row),
          }
        : null,
      canManageDevices
        ? {
            key: "calibration",
            label: t("device.calibration"),
            ariaLabel: t("device.calibration"),
            icon: <CalendarClock size={15} />,
            kind: "overflow",
            frequency: "low",
            risk: "state-change",
            permission: "devices:manage",
            onClick: () => openOperation("calibration", row),
          }
        : null,
      canManageDevices
        ? {
            key: "maintenance",
            label: t("device.maintenance"),
            ariaLabel: t("device.maintenance"),
            icon: <Wrench size={15} />,
            kind: "overflow",
            frequency: "low",
            risk: "state-change",
            permission: "devices:manage",
            onClick: () => openOperation("maintenance", row),
          }
        : null,
      canManageDevices
        ? {
            key: "replace",
            label: t("device.replacement"),
            ariaLabel: t("device.replacement"),
            icon: <Replace size={15} />,
            kind: "overflow",
            frequency: "low",
            risk: "state-change",
            permission: "devices:manage",
            onClick: () => openOperation("replace", row),
          }
        : null,
      canManageDevices
        ? {
            key: isArchived ? "unarchive" : "archive",
            label: archiveLabel,
            ariaLabel: archiveLabel,
            icon: isArchived ? (
              <ArchiveRestore size={15} />
            ) : (
              <Archive size={15} />
            ),
            kind: "danger",
            frequency: "high",
            risk: isArchived ? "state-change" : "destructive",
            reversible: true,
            permission: "devices:manage",
            danger: !isArchived,
            confirm: {
              title: isArchived
                ? t("device.unarchiveConfirmTitle")
                : t("device.archiveConfirmTitle"),
              description: isArchived
                ? t("device.unarchiveConfirmDescription")
                : t("device.archiveConfirmDescription"),
              okText: isArchived
                ? t("device.unarchiveConfirmOk")
                : t("device.archiveConfirmOk"),
              cancelText: isArchived
                ? t("device.unarchiveConfirmCancel")
                : t("device.archiveConfirmCancel"),
            },
            onClick: () => toggleArchiveDevice(row),
          }
        : null,
    ].filter(Boolean) as ResponsiveAction[];
  }

  function renderDeviceActions(row: any) {
    if (!canManageDevices && !canManageThresholds) {
      return null;
    }
    return (
      <ResponsiveActionGroup
        actions={buildDeviceActions(row)}
        ariaLabel={t("app.actions")}
        mode={mode}
        overflowLabel={t("app.actions")}
        permissions={permissions.permissions}
        surface="row"
      />
    );
  }

  function renderDeviceDrawerActions(row: any) {
    if (!canManageDevices && !canManageThresholds) {
      return null;
    }
    return (
      <ResponsiveActionGroup
        actions={buildDeviceActions(row)}
        mode={mode}
        permissions={permissions.permissions}
        surface="drawer-footer"
        touch
      />
    );
  }

  const columns: ProColumns<any>[] = [
    {
      title: t("device.deviceName"),
      dataIndex: "deviceName",
      sorter: true,
      copyable: true,
    },
    { title: t("device.displayName"), dataIndex: "displayName", sorter: true },
    {
      title: t("device.ipAddress"),
      dataIndex: "ipAddress",
      copyable: true,
      search: false,
    },
    {
      title: t("device.macAddress"),
      dataIndex: "macAddress",
      copyable: true,
      search: false,
    },
    {
      title: t("device.exhibition"),
      dataIndex: ["exhibition", "name"],
      search: false,
    },
    { title: t("device.zone"), dataIndex: ["zone", "name"], search: false },
    {
      title: t("device.temperature"),
      dataIndex: "temperature",
      search: false,
      render: (_, row) => {
        const latest = row.measurements?.[0];
        return latest
          ? `${formatClimateValue(latest.temperatureC, "-")} C`
          : "-";
      },
    },
    {
      title: t("device.humidity"),
      dataIndex: "humidity",
      search: false,
      render: (_, row) => {
        const latest = row.measurements?.[0];
        return latest
          ? `${formatClimateValue(latest.humidityPercent, "-")} %RH`
          : "-";
      },
    },
    {
      title: t("device.setpoint"),
      dataIndex: "setpoint",
      search: false,
      render: (_, row) =>
        formatClimateValue(row.measurements?.[0]?.dehumidifySetpoint, "-"),
    },
    {
      title: t("device.lastOnline"),
      dataIndex: "lastSeenAt",
      search: false,
      render: (_, row) => formatRelativeDelay(row.lastSeenAt),
    },
    {
      title: t("app.status"),
      dataIndex: "status",
      valueEnum: {
        active: { text: t("device.statusActive") },
        receiving: { text: t("device.statusReceiving") },
        paused: { text: t("device.statusPaused") },
        archived: { text: t("device.statusArchived") },
      },
      render: (_, row) => {
        const status = getDeviceReceiveStatus(row);
        return (
          <Tag color={getDeviceStatusColor(status)}>
            {t(getDeviceStatusMessageKey(status))}
          </Tag>
        );
      },
    },
    ...(canManageDevices || canManageThresholds
      ? [
          {
            title: t("app.actions"),
            valueType: "option",
            width: 220,
            render: (_, row) => renderDeviceActions(row),
          } satisfies ProColumns<any>,
        ]
      : []),
  ];
  const tabletLandscapeColumns: ProColumns<any>[] = [
    {
      title: t("device.deviceName"),
      dataIndex: "deviceName",
      sorter: true,
      width: 220,
      render: (_, row) => (
        <Space direction="vertical" size={0} style={{ minWidth: 0 }}>
          <Typography.Text strong ellipsis>
            {row.displayName ?? row.deviceName}
          </Typography.Text>
          <Typography.Text type="secondary" copyable ellipsis>
            {row.deviceName}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: t("device.exhibition"),
      dataIndex: ["exhibition", "name"],
      search: false,
      width: 150,
    },
    {
      title: t("device.zone"),
      dataIndex: ["zone", "name"],
      search: false,
      width: 130,
    },
    {
      title: t("device.temperature"),
      dataIndex: "temperature",
      search: false,
      width: 120,
      render: (_, row) => {
        const latest = latestMeasurement(row);
        return latest
          ? `${formatClimateValue(latest.temperatureC, "-")} C`
          : "-";
      },
    },
    {
      title: t("device.humidity"),
      dataIndex: "humidity",
      search: false,
      width: 120,
      render: (_, row) => {
        const latest = latestMeasurement(row);
        return latest
          ? `${formatClimateValue(latest.humidityPercent, "-")} %RH`
          : "-";
      },
    },
    {
      title: t("floorPlan.threshold"),
      dataIndex: "threshold",
      search: false,
      width: 150,
      render: (_, row) => thresholdProfileName(row),
    },
    {
      title: t("device.lastOnline"),
      dataIndex: "lastSeenAt",
      search: false,
      width: 130,
      render: (_, row) => formatRelativeDelay(row.lastSeenAt),
    },
    {
      title: t("app.status"),
      dataIndex: "status",
      width: 120,
      valueEnum: {
        active: { text: t("device.statusActive") },
        receiving: { text: t("device.statusReceiving") },
        paused: { text: t("device.statusPaused") },
        archived: { text: t("device.statusArchived") },
      },
      render: (_, row) => {
        const status = getDeviceReceiveStatus(row);
        return (
          <Tag color={getDeviceStatusColor(status)}>
            {t(getDeviceStatusMessageKey(status))}
          </Tag>
        );
      },
    },
    ...(canManageDevices || canManageThresholds
      ? [
          {
            title: t("app.actions"),
            valueType: "option",
            width: 168,
            render: (_, row) => renderDeviceActions(row),
          } satisfies ProColumns<any>,
        ]
      : []),
  ];

  return (
    <AppShell>
      <RequirePermission permission="devices:read">
        <PageHeader
          eyebrow="Asset Operations"
          title={t("device.title")}
          actions={
            <>
              <AutoRefreshStatus
                enabled={autoRefresh.autoRefreshEnabled}
                intervalMs={DEVICE_LIST_REFRESH_MS}
                isError={devicesHasRefreshError}
                isFetching={devicesIsFetching}
                isPaused={
                  autoRefresh.autoRefreshEnabled &&
                  (!autoRefresh.isVisible || deviceAutoRefreshBlocked)
                }
                isStale={autoRefresh.isTimestampStale(
                  devicesLastUpdatedAt,
                  DEVICE_LIST_STALE_WARNING_MS,
                )}
                lastUpdatedAt={devicesLastUpdatedAt}
                onEnabledChange={autoRefresh.setAutoRefreshEnabled}
              />
              {canExportReports ? (
                <Button
                  href="/api/devices/export"
                  icon={<FileDown size={15} />}
                >
                  {t("app.export")}
                </Button>
              ) : null}
              {canManageDevices ? (
                <Button
                  type="primary"
                  icon={<Plus size={15} />}
                  onClick={() => void openDeviceModal({ mode: "create" })}
                >
                  {t("app.add")}
                </Button>
              ) : null}
            </>
          }
        />
        {isCompactOperationsView ? (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            {compactDevices.data?.items?.length ? (
              compactDevices.data.items.map((row: any) => {
                const latest = latestMeasurement(row);
                const status = getDeviceReceiveStatus(row);
                return (
                  <Card
                    aria-label={`${t("app.view")} ${row.displayName ?? row.deviceName}`}
                    key={row.id}
                    className="nmth-panel"
                    size="small"
                    onClick={() => openDeviceDetail(row)}
                    onKeyDown={(event) => handleDeviceCardKeyDown(event, row)}
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
                        <Typography.Text strong ellipsis>
                          {row.displayName ?? row.deviceName}
                        </Typography.Text>
                        <Typography.Text type="secondary" ellipsis>
                          {row.deviceName}
                        </Typography.Text>
                        <Space wrap size={6}>
                          <Tag color={getDeviceStatusColor(status)}>
                            {t(getDeviceStatusMessageKey(status))}
                          </Tag>
                          <Tag>{row.exhibition?.name ?? "-"}</Tag>
                          <Tag>{row.zone?.name ?? "-"}</Tag>
                        </Space>
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
                        <Typography.Text>
                          {t("device.temperature")}:{" "}
                          {latest
                            ? `${formatClimateValue(latest.temperatureC, "-")} C`
                            : "-"}
                        </Typography.Text>
                        <Typography.Text>
                          {t("device.humidity")}:{" "}
                          {latest
                            ? `${formatClimateValue(latest.humidityPercent, "-")} %RH`
                            : "-"}
                        </Typography.Text>
                        <Typography.Text type="secondary">
                          {t("floorPlan.threshold")}:{" "}
                          {thresholdProfileName(row)}
                        </Typography.Text>
                        <Typography.Text type="secondary">
                          {t("device.setpoint")}:{" "}
                          {formatClimateValue(latest?.dehumidifySetpoint, "-")}
                        </Typography.Text>
                        <Typography.Text type="secondary">
                          {t("device.lastOnline")}:{" "}
                          {formatRelativeDelay(row.lastSeenAt)}
                        </Typography.Text>
                      </div>
                    </Space>
                  </Card>
                );
              })
            ) : (
              <Card className="nmth-panel">
                <Empty
                  description={
                    compactDevices.isLoading ? t("app.loading") : t("app.empty")
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
            columns={isTabletLandscape ? tabletLandscapeColumns : columns}
            request={async (params) => {
              const query = new URLSearchParams({
                page: String(params.current ?? 1),
                pageSize: String(params.pageSize ?? 20),
                search: String(params.keyword ?? params.deviceName ?? ""),
              });
              const status = Array.isArray(params.status)
                ? params.status[0]
                : params.status;
              if (status) {
                query.set("status", String(status));
              }
              try {
                const result = await apiFetch<any>(
                  `/devices?${query.toString()}`,
                );
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
            scroll={{ x: isTabletLandscape ? 980 : 1320 }}
            onRow={(record) =>
              isTabletLandscape
                ? {
                    onClick: () => openDeviceDetail(record),
                    style: { cursor: "pointer" },
                  }
                : {}
            }
            options={{
              density: true,
              fullScreen: true,
              reload: true,
              setting: true,
            }}
            toolBarRender={() => [
              <Space key="sync">
                <RefreshCw size={15} />
                {t("app.lastRefresh")}
              </Space>,
            ]}
          />
        )}
      </RequirePermission>
      <Drawer
        title={selectedDevice?.displayName ?? selectedDevice?.deviceName}
        open={Boolean(selectedDevice)}
        onClose={() => setSelectedDevice(null)}
        width="min(560px, 100vw)"
        footer={
          selectedDevice ? renderDeviceDrawerActions(selectedDevice) : null
        }
      >
        {selectedDevice ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label={t("device.deviceName")}>
                {selectedDevice.deviceName}
              </Descriptions.Item>
              <Descriptions.Item label={t("device.displayName")}>
                {selectedDevice.displayName ?? "-"}
              </Descriptions.Item>
              <Descriptions.Item label={t("device.exhibition")}>
                {selectedDevice.exhibition?.name ?? "-"}
              </Descriptions.Item>
              <Descriptions.Item label={t("device.zone")}>
                {selectedDevice.zone?.name ?? "-"}
              </Descriptions.Item>
              <Descriptions.Item label={t("device.temperature")}>
                {latestMeasurement(selectedDevice)
                  ? `${formatClimateValue(latestMeasurement(selectedDevice)?.temperatureC, "-")} C`
                  : "-"}
              </Descriptions.Item>
              <Descriptions.Item label={t("device.humidity")}>
                {latestMeasurement(selectedDevice)
                  ? `${formatClimateValue(latestMeasurement(selectedDevice)?.humidityPercent, "-")} %RH`
                  : "-"}
              </Descriptions.Item>
              <Descriptions.Item label={t("device.setpoint")}>
                {formatClimateValue(
                  latestMeasurement(selectedDevice)?.dehumidifySetpoint,
                  "-",
                )}
              </Descriptions.Item>
              <Descriptions.Item label={t("device.lastOnline")}>
                {formatRelativeDelay(selectedDevice.lastSeenAt)}
              </Descriptions.Item>
              <Descriptions.Item label={t("app.status")}>
                <Tag
                  color={getDeviceStatusColor(
                    getDeviceReceiveStatus(selectedDevice),
                  )}
                >
                  {t(
                    getDeviceStatusMessageKey(
                      getDeviceReceiveStatus(selectedDevice),
                    ),
                  )}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t("floorPlan.threshold")}>
                {thresholdProfileName(selectedDevice)}
              </Descriptions.Item>
            </Descriptions>
          </Space>
        ) : null}
      </Drawer>
      <Modal
        title={deviceModal?.mode === "edit" ? t("app.edit") : t("app.add")}
        open={Boolean(deviceModal)}
        onCancel={() => setDeviceModal(null)}
        onOk={() => deviceForm.submit()}
        width={isMobile ? "calc(100vw - 32px)" : undefined}
      >
        <Form form={deviceForm} layout="vertical" onFinish={saveDevice}>
          <Form.Item
            name="deviceName"
            label={t("device.deviceName")}
            rules={[{ required: deviceModal?.mode === "create" }]}
          >
            <Input disabled={deviceModal?.mode === "edit"} />
          </Form.Item>
          <Form.Item
            name="displayName"
            label={t("device.displayName")}
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="ipAddress" label={t("device.ipAddress")}>
            <Input />
          </Form.Item>
          <Form.Item name="macAddress" label={t("device.macAddress")}>
            <Input />
          </Form.Item>
          <Form.Item name="pointType" label={t("device.pointType")}>
            <Select
              options={["ambient", "showcase", "storage", "other"].map(
                (value) => ({ value, label: value }),
              )}
            />
          </Form.Item>
          <Form.Item name="exhibitionId" label={t("device.exhibition")}>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              options={exhibitionOptions}
            />
          </Form.Item>
          <Form.Item name="zoneId" label={t("device.zone")}>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              options={zoneOptions}
            />
          </Form.Item>
          <Form.Item
            name="enabled"
            label={t("device.receiveData")}
            valuePropName="checked"
            extra={
              isEditingArchivedDevice
                ? t("device.archivedReceiveHelp")
                : t("device.receiveDataHelp")
            }
          >
            <Switch disabled={isEditingArchivedDevice} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={
          operation?.type === "replace"
            ? t("device.replacement")
            : operation
              ? t(`device.${operation.type}`)
              : t("app.edit")
        }
        open={Boolean(operation)}
        onCancel={() => setOperation(null)}
        onOk={() => operationForm.submit()}
        width={isMobile ? "calc(100vw - 32px)" : undefined}
      >
        <Form form={operationForm} layout="vertical" onFinish={saveOperation}>
          {operation?.type === "calibration" ? (
            <>
              <Form.Item
                name="calibratedAt"
                label={t("device.calibration")}
                rules={[{ required: true }]}
              >
                <DatePicker showTime style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item name="validUntil" label={t("report.end")}>
                <DatePicker showTime style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item name="certificateUrl" label="URL">
                <Input />
              </Form.Item>
              <Form.Item name="note" label={t("alert.ackNote")}>
                <Input.TextArea />
              </Form.Item>
            </>
          ) : null}
          {operation?.type === "maintenance" ? (
            <>
              <Form.Item
                name="type"
                label={t("admin.method")}
                rules={[{ required: true }]}
              >
                <Input />
              </Form.Item>
              <Form.Item
                name="performedAt"
                label={t("admin.createdAt")}
                rules={[{ required: true }]}
              >
                <DatePicker showTime style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item name="performedBy" label={t("admin.operator")}>
                <Input />
              </Form.Item>
              <Form.Item name="note" label={t("alert.ackNote")}>
                <Input.TextArea />
              </Form.Item>
            </>
          ) : null}
          {operation?.type === "replace" ? (
            <>
              <Form.Item
                name="newDeviceName"
                label={t("device.deviceName")}
                rules={[{ required: true }]}
              >
                <Input />
              </Form.Item>
              <Form.Item
                name="reason"
                label={t("admin.reason")}
                rules={[{ required: true }]}
              >
                <Input.TextArea />
              </Form.Item>
            </>
          ) : null}
        </Form>
      </Modal>
      <Modal
        title={t("device.thresholdSettings")}
        open={Boolean(thresholdModal)}
        onCancel={() => setThresholdModal(null)}
        onOk={() => thresholdForm.submit()}
        width={isMobile ? "calc(100vw - 32px)" : 720}
      >
        <Form form={thresholdForm} layout="vertical" onFinish={saveThreshold}>
          <Form.Item
            name="name"
            label={t("floorPlan.threshold")}
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Row gutter={[12, 12]}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="warningTemperatureMin"
                label={t("device.warningTemperatureMin")}
                rules={[{ required: true }]}
              >
                <InputNumber style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="warningTemperatureMax"
                label={t("device.warningTemperatureMax")}
                rules={[{ required: true }]}
              >
                <InputNumber style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="warningHumidityMin"
                label={t("device.warningHumidityMin")}
                rules={[{ required: true }]}
              >
                <InputNumber style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="warningHumidityMax"
                label={t("device.warningHumidityMax")}
                rules={[{ required: true }]}
              >
                <InputNumber style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label={t("device.triggerDuration")}>
                <Space.Compact block>
                  <Form.Item name="triggerHours" noStyle>
                    <InputNumber
                      min={0}
                      addonAfter={t("device.hours")}
                      style={{ width: "50%" }}
                    />
                  </Form.Item>
                  <Form.Item name="triggerMinutes" noStyle>
                    <InputNumber
                      min={0}
                      max={59}
                      addonAfter={t("device.minutes")}
                      style={{ width: "50%" }}
                    />
                  </Form.Item>
                </Space.Compact>
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label={t("device.repeatInterval")}>
                <Space.Compact block>
                  <Form.Item name="repeatHours" noStyle>
                    <InputNumber
                      min={0}
                      addonAfter={t("device.hours")}
                      style={{ width: "50%" }}
                    />
                  </Form.Item>
                  <Form.Item name="repeatMinutes" noStyle>
                    <InputNumber
                      min={0}
                      max={59}
                      addonAfter={t("device.minutes")}
                      style={{ width: "50%" }}
                    />
                  </Form.Item>
                </Space.Compact>
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="maxNotifications"
                label={t("device.maxNotifications")}
                rules={[{ required: true }]}
              >
                <InputNumber min={1} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label={t("device.unresolvedReminder")}>
                <Space.Compact block>
                  <Form.Item name="unresolvedHours" noStyle>
                    <InputNumber
                      min={0}
                      addonAfter={t("device.hours")}
                      style={{ width: "50%" }}
                    />
                  </Form.Item>
                  <Form.Item name="unresolvedMinutes" noStyle>
                    <InputNumber
                      min={0}
                      max={59}
                      addonAfter={t("device.minutes")}
                      style={{ width: "50%" }}
                    />
                  </Form.Item>
                </Space.Compact>
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </AppShell>
  );
}

"use client";

import {
  App,
  Button,
  Card,
  Checkbox,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
} from "antd";
import { useQuery } from "@tanstack/react-query";
import {
  Bot,
  DatabaseBackup,
  HeartPulse,
  Mail,
  MessageCircle,
  Pencil,
  Plus,
  ShieldAlert,
  TestTube2,
  Trash2,
} from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { useState } from "react";
import { AppShell } from "../../../components/AppShell";
import { PageHeader } from "../../../components/PageHeader";
import {
  ResponsiveActionGroup,
  type ResponsiveAction,
} from "../../../components/actions";
import { apiFetch } from "../../../lib/api";
import { useResponsiveMode } from "../../../lib/responsive";
import {
  RequirePermission,
  SETTINGS_PERMISSIONS,
  permissionDescription,
  permissionLabel,
  roleDescription,
  roleLabel,
  usePermissions,
} from "../../../lib/permissions";

export default function SettingsPage() {
  const t = useTranslations();
  const locale = useLocale();
  const { message } = App.useApp();
  const { mode, isMobile, isTabletPortrait } = useResponsiveMode();
  const isCompactSettingsWorkflow = isMobile || isTabletPortrait;
  const settingsControlSize = isCompactSettingsWorkflow ? "large" : "middle";
  const [compensationForm] = Form.useForm();
  const [userForm] = Form.useForm();
  const [roleForm] = Form.useForm();
  const compensationMethod = Form.useWatch("method", compensationForm);
  const [gapRows, setGapRows] = useState<any[]>([]);
  const [aiOutput, setAiOutput] = useState<any>(null);
  const [syntheticResult, setSyntheticResult] = useState<any>(null);
  const [userModal, setUserModal] = useState<{
    mode: "create" | "edit";
    record?: any;
  } | null>(null);
  const [roleModal, setRoleModal] = useState<{
    mode: "create" | "edit";
    record?: any;
  } | null>(null);
  const userPermissions = usePermissions();
  const canManageSystem = userPermissions.hasPermission("system:manage");
  const canManageUsers = userPermissions.hasPermission("users:manage");
  const canDangerousDelete = userPermissions.hasPermission("dangerous:delete");
  const canManageNotifications = userPermissions.hasPermission(
    "notifications:manage",
  );
  const canReadAudit = userPermissions.hasPermission("audit:read");
  const canManageCompensation = userPermissions.hasPermission(
    "compensation:manage",
  );
  const canManageSynthetic = userPermissions.hasPermission("synthetic:manage");
  const canIngest = userPermissions.hasPermission("ingest:write");
  const canGenerateAi = userPermissions.hasPermission("reports:export");
  const pageGutter: [number, number] = isMobile
    ? [8, 8]
    : isTabletPortrait
      ? [12, 12]
      : [16, 16];
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () =>
      fetch("/api/health", { credentials: "include" }).then((r) => r.json()),
    retry: 1,
    enabled: canManageSystem,
  });
  const dataProfile = useQuery({
    queryKey: ["data-profile"],
    queryFn: () =>
      apiFetch<{ profile: "DEMO" | "REAL"; profiles: Array<"DEMO" | "REAL"> }>(
        "/system/data-profile",
      ),
    retry: 1,
    enabled: canManageSystem || canIngest,
  });
  const channels = useQuery({
    queryKey: ["channels"],
    queryFn: () => apiFetch<any[]>("/notifications/channels"),
    retry: 1,
    enabled: canManageNotifications,
  });
  const users = useQuery({
    queryKey: ["system-users"],
    queryFn: () => apiFetch<any>("/system/users?page=1&pageSize=50"),
    retry: 1,
    enabled: canManageUsers,
  });
  const roles = useQuery({
    queryKey: ["system-roles"],
    queryFn: () => apiFetch<any[]>("/system/roles"),
    retry: 1,
    enabled: canManageUsers,
  });
  const permissions = useQuery({
    queryKey: ["system-permissions"],
    queryFn: () => apiFetch<any[]>("/system/permissions"),
    retry: 1,
    enabled: canManageUsers,
  });
  const auditLogs = useQuery({
    queryKey: ["audit-logs"],
    queryFn: () => apiFetch<any[]>("/audit-logs?page=1&pageSize=50"),
    retry: 1,
    enabled: canReadAudit,
  });
  const needsOperationalOptions =
    canManageCompensation || canManageSynthetic || canGenerateAi;
  const exhibitions = useQuery({
    queryKey: ["exhibitions", "settings-select"],
    queryFn: () => apiFetch<any>("/exhibitions?page=1&pageSize=100"),
    retry: 1,
    enabled: needsOperationalOptions || canManageUsers,
  });
  const devices = useQuery({
    queryKey: ["devices", "admin-select"],
    queryFn: () => apiFetch<any>("/devices?page=1&pageSize=100"),
    retry: 1,
    enabled: canManageCompensation || canManageSynthetic,
  });
  const adjustments = useQuery({
    queryKey: ["measurement-adjustments"],
    queryFn: () =>
      apiFetch<any[]>("/system/measurement-adjustments?page=1&pageSize=20"),
    enabled: canManageCompensation || canManageSynthetic,
    retry: 1,
  });
  const deviceOptions = (devices.data?.items ?? []).map((device: any) => ({
    value: device.id,
    label: `${device.deviceName} - ${device.displayName}`,
  }));
  const exhibitionOptions = (exhibitions.data?.items ?? []).map(
    (exhibition: any) => ({
      value: exhibition.id,
      label: exhibition.name,
    }),
  );
  const activeProfile = dataProfile.data?.profile ?? "REAL";
  const zoneOptions = (exhibitions.data?.items ?? []).flatMap(
    (exhibition: any) =>
      (exhibition.zones ?? []).map((zone: any) => ({
        value: zone.id,
        label: `${exhibition.name} / ${zone.name}`,
      })),
  );
  const roleOptions = (roles.data ?? []).map((role: any) => ({
    value: role.id,
    label: roleDescription(t, role.name, role.description),
  }));
  const permissionOptions = (permissions.data ?? []).map((permission: any) => ({
    value: permission.key,
    label: `${permissionLabel(t, permission.key)} - ${permissionDescription(t, permission.key, permission.description)}`,
  }));

  async function switchDataProfile(profile: "DEMO" | "REAL") {
    await apiFetch("/system/data-profile", {
      method: "POST",
      body: JSON.stringify({ profile }),
    });
    await dataProfile.refetch();
    await devices.refetch();
    message.success(t("profile.switched"));
  }

  async function importProfileFile(file: File) {
    const text = await file.text();
    const trimmed = text.trim();
    const parsed = trimmed.startsWith("[")
      ? { rows: JSON.parse(trimmed) as unknown[] }
      : trimmed.startsWith("{")
        ? (JSON.parse(trimmed) as Record<string, unknown>)
        : { csv: text };
    const result = await apiFetch<{ imported: number; duplicates: number }>(
      "/ingest/import/profile-measurements",
      {
        method: "POST",
        body: JSON.stringify({ ...parsed, dataProfile: activeProfile }),
      },
    );
    message.success(
      `${t("profile.imported")}: ${result.imported} / ${result.duplicates}`,
    );
    await devices.refetch();
    return false;
  }

  async function sendTest(type: string) {
    await apiFetch(`/notifications/channels/${type}/test`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    message.success(t("notification.sendTest"));
  }

  async function updateChannel(
    type: string,
    values: { enabled?: boolean; maskedIdentifier?: string },
  ) {
    const current = channels.data?.find((channel) => channel.type === type);
    await apiFetch("/notifications/channels", {
      method: "POST",
      body: JSON.stringify({
        type,
        name: current?.name ?? `${type} default`,
        enabled: values.enabled ?? current?.enabled ?? false,
        maskedIdentifier: values.maskedIdentifier ?? current?.maskedIdentifier,
      }),
    });
    await channels.refetch();
    message.success(t("app.save"));
  }

  function contactIdentifier(
    record: any,
    type: "line" | "discord" | "telegram",
  ) {
    return record?.notificationContacts?.find(
      (contact: any) => contact.type === type,
    )?.identifier;
  }

  function openUserModal(mode: "create" | "edit", record?: any) {
    setUserModal({ mode, record });
    if (record) {
      userForm.setFieldsValue({
        email: record.email,
        name: record.name,
        enabled: record.enabled,
        roleIds: (record.roles ?? []).map((entry: any) => entry.role.id),
        dataProfiles: record.accessScope?.allowedDataProfiles ?? [],
        scopedExhibitionIds: record.accessScope?.exhibitionIds ?? [],
        scopedZoneIds: record.accessScope?.zoneIds ?? [],
        lineUserId: contactIdentifier(record, "line"),
        discordUserId: contactIdentifier(record, "discord"),
        telegramChatId: contactIdentifier(record, "telegram"),
      });
    } else {
      userForm.resetFields();
      userForm.setFieldsValue({ enabled: true, roleIds: [] });
    }
  }

  async function saveUser(values: any) {
    const contacts = [
      { type: "line", identifier: values.lineUserId },
      { type: "discord", identifier: values.discordUserId },
      { type: "telegram", identifier: values.telegramChatId },
    ];
    const body = JSON.stringify({
      email: values.email,
      name: values.name,
      password: values.password || undefined,
      enabled: values.enabled,
      roleIds: values.roleIds ?? [],
      accessScope: {
        dataProfiles: values.dataProfiles ?? [],
        exhibitionIds: values.scopedExhibitionIds ?? [],
        zoneIds: values.scopedZoneIds ?? [],
      },
      contacts,
    });
    if (userModal?.mode === "edit" && userModal.record) {
      await apiFetch(`/system/users/${userModal.record.id}`, {
        method: "PATCH",
        body,
      });
    } else {
      await apiFetch("/system/users", { method: "POST", body });
    }
    message.success(t("app.save"));
    setUserModal(null);
    await users.refetch();
    await roles.refetch();
  }

  async function deleteUser(record: any) {
    await apiFetch(`/system/users/${record.id}`, { method: "DELETE" });
    message.success(t("app.delete"));
    await users.refetch();
    await roles.refetch();
  }

  function openRoleModal(mode: "create" | "edit", record?: any) {
    setRoleModal({ mode, record });
    if (record) {
      roleForm.setFieldsValue({
        name: record.name,
        description: record.description,
        permissionKeys: (record.permissions ?? []).map(
          (entry: any) => entry.permission.key,
        ),
      });
    } else {
      roleForm.resetFields();
      roleForm.setFieldsValue({ permissionKeys: [] });
    }
  }

  async function saveRole(values: any) {
    const body = JSON.stringify({
      name: values.name,
      description: values.description,
      permissionKeys: values.permissionKeys ?? [],
    });
    if (roleModal?.mode === "edit" && roleModal.record) {
      await apiFetch(`/system/roles/${roleModal.record.id}`, {
        method: "PATCH",
        body,
      });
    } else {
      await apiFetch("/system/roles", { method: "POST", body });
    }
    message.success(t("app.save"));
    setRoleModal(null);
    await roles.refetch();
    await users.refetch();
  }

  async function deleteRole(record: any) {
    await apiFetch(`/system/roles/${record.id}`, { method: "DELETE" });
    message.success(t("app.delete"));
    await roles.refetch();
    await users.refetch();
  }

  async function generateAi(values: any) {
    const result = await apiFetch("/ai/monthly-report", {
      method: "POST",
      body: JSON.stringify({ ...values, locale }),
    });
    setAiOutput(result);
    message.success(t("ai.monthlyReport"));
  }

  async function detectGaps() {
    const values = await compensationForm.validateFields(["deviceId", "range"]);
    const [start, end] = values.range;
    const rows = await apiFetch<any[]>("/compensation/detect-gaps", {
      method: "POST",
      body: JSON.stringify({
        deviceId: values.deviceId,
        start: start.toISOString(),
        end: end.toISOString(),
        expectedIntervalSeconds: 60,
      }),
    });
    setGapRows(rows);
    message.success(t("app.search"));
  }

  async function generateCompensation(values: any) {
    const [start, end] = values.range;
    await apiFetch("/compensation/generate", {
      method: "POST",
      body: JSON.stringify({
        ...values,
        start: start.toISOString(),
        end: end.toISOString(),
      }),
    });
    await adjustments.refetch();
    message.success(t("admin.compensation"));
  }

  async function generateSynthetic(values: any) {
    const [start, end] = values.range;
    const result = await apiFetch("/synthetic/target-approach", {
      method: "POST",
      body: JSON.stringify({
        ...values,
        start: start.toISOString(),
        end: end.toISOString(),
      }),
    });
    setSyntheticResult(result);
    await adjustments.refetch();
    message.success(t("admin.synthetic"));
  }

  function buildUserActions(row: any): ResponsiveAction[] {
    return [
      {
        key: "edit",
        label: t("app.edit"),
        ariaLabel: `${t("app.edit")} ${row.email}`,
        icon: <Pencil size={15} />,
        kind: "row-primary",
        permission: "users:manage",
        onClick: () => openUserModal("edit", row),
      },
      canDangerousDelete
        ? {
            key: "delete",
            label: t("app.delete"),
            ariaLabel: `${t("app.delete")} ${row.email}`,
            icon: <Trash2 size={15} />,
            kind: "danger",
            permission: "dangerous:delete",
            confirm: {
              title: t("app.delete"),
              okText: t("app.delete"),
              cancelText: t("app.cancel"),
            },
            onClick: () => deleteUser(row),
          }
        : null,
    ].filter(Boolean) as ResponsiveAction[];
  }

  function renderUserActions(row: any, text = false) {
    return (
      <Space wrap style={{ justifyContent: "flex-end", width: "100%" }}>
        <ResponsiveActionGroup
          actions={buildUserActions(row)}
          ariaLabel={t("app.actions")}
          mode={mode}
          permissions={userPermissions.permissions}
          surface={text ? "compact-list" : "row"}
          touch={text && isCompactSettingsWorkflow}
        />
      </Space>
    );
  }

  function buildRoleActions(row: any): ResponsiveAction[] {
    const label = roleLabel(t, row.name);
    return [
      {
        key: "edit",
        label: t("app.edit"),
        ariaLabel: `${t("app.edit")} ${label}`,
        icon: <Pencil size={15} />,
        kind: "row-primary",
        permission: "users:manage",
        onClick: () => openRoleModal("edit", row),
      },
      canDangerousDelete
        ? {
            key: "delete",
            label: t("app.delete"),
            ariaLabel: `${t("app.delete")} ${label}`,
            icon: <Trash2 size={15} />,
            kind: "danger",
            permission: "dangerous:delete",
            confirm: {
              title: t("app.delete"),
              okText: t("app.delete"),
              cancelText: t("app.cancel"),
            },
            onClick: () => deleteRole(row),
          }
        : null,
    ].filter(Boolean) as ResponsiveAction[];
  }

  function renderRoleActions(row: any, text = false) {
    return (
      <Space wrap style={{ justifyContent: "flex-end", width: "100%" }}>
        <ResponsiveActionGroup
          actions={buildRoleActions(row)}
          ariaLabel={t("app.actions")}
          mode={mode}
          permissions={userPermissions.permissions}
          surface={text ? "compact-list" : "row"}
          touch={text && isCompactSettingsWorkflow}
        />
      </Space>
    );
  }

  function renderCompactUsers() {
    return (
      <List
        data-testid="settings-user-card-list"
        dataSource={users.data?.items ?? []}
        loading={users.isLoading}
        locale={{ emptyText: t("app.empty") }}
        renderItem={(row: any) => (
          <List.Item style={{ paddingInline: 0 }}>
            <Space direction="vertical" size={10} style={{ width: "100%" }}>
              <Space
                direction="vertical"
                size={4}
                style={{ minWidth: 0, width: "100%" }}
              >
                <Typography.Text strong ellipsis>
                  {row.name}
                </Typography.Text>
                <Typography.Text type="secondary" ellipsis>
                  {row.email}
                </Typography.Text>
                <Space wrap size={[6, 6]}>
                  <Tag color={row.enabled ? "green" : "default"}>
                    {row.enabled ? t("device.enabled") : t("device.archived")}
                  </Tag>
                  {(row.roles ?? []).map((entry: any) => (
                    <Tag
                      key={entry.role.id}
                      color={entry.role.name === "SuperAdmin" ? "red" : "blue"}
                    >
                      {roleLabel(t, entry.role.name)}
                    </Tag>
                  ))}
                </Space>
              </Space>
              <Space wrap size={[6, 6]}>
                {["line", "discord", "telegram"].map((type) => {
                  const contact = row.notificationContacts?.find(
                    (item: any) => item.type === type,
                  );
                  return contact ? <Tag key={type}>{type}</Tag> : null;
                })}
              </Space>
              {renderUserActions(row, true)}
            </Space>
          </List.Item>
        )}
      />
    );
  }

  function renderCompactRoles() {
    return (
      <List
        data-testid="settings-role-card-list"
        dataSource={roles.data ?? []}
        loading={roles.isLoading}
        locale={{ emptyText: t("app.empty") }}
        renderItem={(row: any) => (
          <List.Item style={{ paddingInline: 0 }}>
            <Space direction="vertical" size={10} style={{ width: "100%" }}>
              <Space
                direction="vertical"
                size={4}
                style={{ minWidth: 0, width: "100%" }}
              >
                <Typography.Text strong>
                  {roleLabel(t, row.name)}
                </Typography.Text>
                <Typography.Text type="secondary">{`${t("admin.userCount")}: ${row._count?.users ?? 0}`}</Typography.Text>
              </Space>
              <Space wrap size={[6, 6]}>
                {(row.permissions ?? []).map((entry: any) => (
                  <Tag key={entry.permission.key}>
                    {permissionLabel(t, entry.permission.key)}
                  </Tag>
                ))}
              </Space>
              {renderRoleActions(row, true)}
            </Space>
          </List.Item>
        )}
      />
    );
  }

  function renderCompactAuditLogs() {
    return (
      <List
        data-testid="settings-audit-card-list"
        dataSource={auditLogs.data ?? []}
        loading={auditLogs.isLoading}
        locale={{ emptyText: t("app.empty") }}
        renderItem={(row: any) => (
          <List.Item style={{ paddingInline: 0 }}>
            <Space
              direction="vertical"
              size={6}
              style={{ minWidth: 0, width: "100%" }}
            >
              <Typography.Text strong ellipsis>
                {row.action}
              </Typography.Text>
              <Typography.Text type="secondary">
                {new Date(String(row.createdAt)).toLocaleString()}
              </Typography.Text>
              <Typography.Text type="secondary" ellipsis>
                {row.user?.name ?? row.user?.email ?? "-"}
              </Typography.Text>
              <Typography.Text type="secondary" ellipsis>
                {`${row.entityType}${row.entityId ? ` / ${row.entityId}` : ""}`}
              </Typography.Text>
            </Space>
          </List.Item>
        )}
      />
    );
  }

  function renderCompactGapRows() {
    return (
      <List
        data-testid="settings-gap-card-list"
        dataSource={gapRows}
        locale={{ emptyText: t("app.empty") }}
        renderItem={(row: any) => (
          <List.Item style={{ paddingInline: 0 }}>
            <Space
              direction="vertical"
              size={6}
              style={{ minWidth: 0, width: "100%" }}
            >
              <Typography.Text strong ellipsis>
                {row.deviceName}
              </Typography.Text>
              <Typography.Text type="secondary">{`${t("report.start")}: ${new Date(String(row.start)).toLocaleString()}`}</Typography.Text>
              <Typography.Text type="secondary">{`${t("report.end")}: ${new Date(String(row.end)).toLocaleString()}`}</Typography.Text>
              <Tag>{`${t("admin.recordCount")}: ${row.missingCount}`}</Tag>
            </Space>
          </List.Item>
        )}
      />
    );
  }

  function renderCompactAdjustments() {
    return (
      <List
        data-testid="settings-adjustment-card-list"
        dataSource={adjustments.data ?? []}
        loading={adjustments.isLoading}
        locale={{ emptyText: t("app.empty") }}
        renderItem={(row: any) => (
          <List.Item style={{ paddingInline: 0 }}>
            <Space
              direction="vertical"
              size={8}
              style={{ minWidth: 0, width: "100%" }}
            >
              <Space wrap size={[6, 6]}>
                <Tag color={row.type === "derived" ? "blue" : "orange"}>
                  {row.type}
                </Tag>
                <Tag>{row.method}</Tag>
                <Tag>{`${t("admin.recordCount")}: ${row.measurements?.length ?? 0}`}</Tag>
              </Space>
              <Typography.Text ellipsis>{row.reason ?? "-"}</Typography.Text>
              <Typography.Text type="secondary">
                {new Date(String(row.createdAt)).toLocaleString()}
              </Typography.Text>
              <Typography.Text type="secondary" ellipsis>
                {row.measurements?.[0]?.device?.deviceName ?? "-"}
              </Typography.Text>
            </Space>
          </List.Item>
        )}
      />
    );
  }

  return (
    <AppShell>
      <RequirePermission any={SETTINGS_PERMISSIONS}>
        <PageHeader eyebrow="Administration" title={t("nav.settings")} />
        <Tabs
          tabBarGutter={isMobile ? 8 : undefined}
          items={
            [
              canManageSystem || canIngest
                ? {
                    key: "health",
                    label: t("nav.health"),
                    children: (
                      <Row gutter={pageGutter} align="stretch">
                        <Col xs={24} md={12} xl={8}>
                          <Card
                            className="nmth-panel"
                            title={t("profile.title")}
                          >
                            <Space direction="vertical">
                              <Tag
                                color={
                                  activeProfile === "DEMO" ? "blue" : "green"
                                }
                              >
                                {activeProfile}
                              </Tag>
                              {canManageSystem ? (
                                <Select
                                  value={activeProfile}
                                  loading={dataProfile.isLoading}
                                  options={(
                                    dataProfile.data?.profiles ?? [
                                      "DEMO",
                                      "REAL",
                                    ]
                                  ).map((profile) => ({
                                    value: profile,
                                    label: t(`profile.${profile}`),
                                  }))}
                                  onChange={(profile) =>
                                    void switchDataProfile(profile)
                                  }
                                  size={settingsControlSize}
                                />
                              ) : null}
                              {canIngest ? (
                                <Upload
                                  accept=".csv,application/json,.json,text/csv"
                                  showUploadList={false}
                                  beforeUpload={(file) => {
                                    void importProfileFile(file);
                                    return false;
                                  }}
                                >
                                  <Button>{t("profile.importFile")}</Button>
                                </Upload>
                              ) : null}
                            </Space>
                          </Card>
                        </Col>
                        {Object.entries(health.data?.checks ?? {}).map(
                          ([key, value]: any) => (
                            <Col xs={24} md={12} xl={8} key={key}>
                              <Card className="nmth-panel">
                                <Space>
                                  <HeartPulse
                                    size={18}
                                    color={
                                      value.status === "ok"
                                        ? "#14855B"
                                        : "#E8374A"
                                    }
                                  />
                                  <Typography.Text strong>
                                    {key}
                                  </Typography.Text>
                                </Space>
                                <Typography.Paragraph
                                  type="secondary"
                                  style={{ marginBottom: 0, marginTop: 8 }}
                                >
                                  {value.status} · {value.detail ?? "-"}
                                </Typography.Paragraph>
                              </Card>
                            </Col>
                          ),
                        )}
                      </Row>
                    ),
                  }
                : null,
              canManageUsers
                ? {
                    key: "users",
                    label: t("admin.usersRoles"),
                    children: (
                      <Row gutter={pageGutter}>
                        <Col xs={24} xl={14}>
                          <Card
                            className="nmth-panel"
                            title={t("admin.usersRoles")}
                            extra={
                              <Button
                                type="primary"
                                icon={<Plus size={15} />}
                                onClick={() => openUserModal("create")}
                              >
                                {t("admin.addUser")}
                              </Button>
                            }
                          >
                            {isCompactSettingsWorkflow ? (
                              renderCompactUsers()
                            ) : (
                              <Table
                                rowKey="id"
                                loading={users.isLoading}
                                dataSource={users.data?.items ?? []}
                                pagination={{ pageSize: 8 }}
                                size="small"
                                scroll={{ x: 920 }}
                                columns={[
                                  {
                                    title: t("auth.email"),
                                    dataIndex: "email",
                                  },
                                  {
                                    title: t("admin.operator"),
                                    dataIndex: "name",
                                  },
                                  {
                                    title: t("admin.roles"),
                                    render: (_, row: any) => (
                                      <Space wrap>
                                        {(row.roles ?? []).map((entry: any) => (
                                          <Tag
                                            key={entry.role.id}
                                            color={
                                              entry.role.name === "SuperAdmin"
                                                ? "red"
                                                : "blue"
                                            }
                                          >
                                            {roleLabel(t, entry.role.name)}
                                          </Tag>
                                        ))}
                                      </Space>
                                    ),
                                  },
                                  {
                                    title: t("app.status"),
                                    dataIndex: "enabled",
                                    render: (enabled) => (
                                      <Tag
                                        color={enabled ? "green" : "default"}
                                      >
                                        {enabled
                                          ? t("device.enabled")
                                          : t("device.archived")}
                                      </Tag>
                                    ),
                                  },
                                  {
                                    title: t("admin.contacts"),
                                    render: (_, row: any) => (
                                      <Space wrap>
                                        {["line", "discord", "telegram"].map(
                                          (type) => {
                                            const contact =
                                              row.notificationContacts?.find(
                                                (item: any) =>
                                                  item.type === type,
                                              );
                                            return contact ? (
                                              <Tag key={type}>{type}</Tag>
                                            ) : null;
                                          },
                                        )}
                                      </Space>
                                    ),
                                  },
                                  {
                                    title: t("app.actions"),
                                    render: (_, row: any) =>
                                      renderUserActions(row),
                                  },
                                ]}
                              />
                            )}
                          </Card>
                        </Col>
                        <Col xs={24} xl={10}>
                          <Card
                            className="nmth-panel"
                            title={t("admin.roles")}
                            extra={
                              <Button
                                type="primary"
                                icon={<Plus size={15} />}
                                onClick={() => openRoleModal("create")}
                              >
                                {t("admin.addRole")}
                              </Button>
                            }
                          >
                            {isCompactSettingsWorkflow ? (
                              renderCompactRoles()
                            ) : (
                              <Table
                                rowKey="id"
                                loading={roles.isLoading}
                                dataSource={roles.data ?? []}
                                pagination={false}
                                size="small"
                                scroll={{ x: 760 }}
                                columns={[
                                  {
                                    title: t("admin.roles"),
                                    render: (_, row: any) =>
                                      roleLabel(t, row.name),
                                  },
                                  {
                                    title: t("admin.permissions"),
                                    render: (_, row: any) => (
                                      <Space wrap>
                                        {(row.permissions ?? []).map(
                                          (entry: any) => (
                                            <Tag key={entry.permission.key}>
                                              {permissionLabel(
                                                t,
                                                entry.permission.key,
                                              )}
                                            </Tag>
                                          ),
                                        )}
                                      </Space>
                                    ),
                                  },
                                  {
                                    title: t("admin.userCount"),
                                    render: (_, row: any) =>
                                      row._count?.users ?? 0,
                                  },
                                  {
                                    title: t("app.actions"),
                                    render: (_, row: any) =>
                                      renderRoleActions(row),
                                  },
                                ]}
                              />
                            )}
                          </Card>
                        </Col>
                      </Row>
                    ),
                  }
                : null,
              canManageNotifications
                ? {
                    key: "notifications",
                    label: t("notification.title"),
                    children: (
                      <Row gutter={pageGutter}>
                        {["email", "line", "discord", "telegram"].map(
                          (type) => {
                            const channel = channels.data?.find(
                              (item) => item.type === type,
                            );
                            return (
                              <Col xs={24} md={12} xl={6} key={type}>
                                <Card
                                  className="nmth-panel"
                                  title={t(`notification.${type}`)}
                                  extra={
                                    type === "email" ? (
                                      <Mail size={16} />
                                    ) : (
                                      <MessageCircle size={16} />
                                    )
                                  }
                                >
                                  <Space
                                    direction="vertical"
                                    style={{ width: "100%" }}
                                  >
                                    <Typography.Paragraph type="secondary">
                                      {channel?.maskedIdentifier ??
                                        t("notification.maskedIdentifier")}
                                    </Typography.Paragraph>
                                    <Switch
                                      checkedChildren={t(
                                        "notification.enabled",
                                      )}
                                      unCheckedChildren={t("app.status")}
                                      checked={Boolean(channel?.enabled)}
                                      onChange={(enabled) =>
                                        void updateChannel(type, { enabled })
                                      }
                                    />
                                    <Input.Search
                                      defaultValue={channel?.maskedIdentifier}
                                      placeholder={t(
                                        "notification.maskedIdentifier",
                                      )}
                                      enterButton={t("app.save")}
                                      onSearch={(maskedIdentifier) =>
                                        void updateChannel(type, {
                                          maskedIdentifier,
                                        })
                                      }
                                      size={settingsControlSize}
                                    />
                                    <Button
                                      icon={<TestTube2 size={15} />}
                                      onClick={() => sendTest(type)}
                                      size={settingsControlSize}
                                    >
                                      {t("notification.sendTest")}
                                    </Button>
                                  </Space>
                                </Card>
                              </Col>
                            );
                          },
                        )}
                      </Row>
                    ),
                  }
                : null,
              canReadAudit
                ? {
                    key: "audit",
                    label: t("admin.auditLog"),
                    children: (
                      <Card className="nmth-panel" title={t("admin.auditLog")}>
                        {isCompactSettingsWorkflow ? (
                          renderCompactAuditLogs()
                        ) : (
                          <Table
                            rowKey="id"
                            loading={auditLogs.isLoading}
                            dataSource={auditLogs.data ?? []}
                            pagination={{ pageSize: 10 }}
                            size="small"
                            scroll={{ x: 820 }}
                            columns={[
                              {
                                title: t("admin.createdAt"),
                                dataIndex: "createdAt",
                                render: (value) =>
                                  new Date(String(value)).toLocaleString(),
                              },
                              {
                                title: t("admin.operator"),
                                render: (_, row: any) =>
                                  row.user?.name ?? row.user?.email ?? "-",
                              },
                              { title: t("app.actions"), dataIndex: "action" },
                              {
                                title: t("floorPlan.detail"),
                                render: (_, row: any) =>
                                  `${row.entityType}${row.entityId ? ` / ${row.entityId}` : ""}`,
                              },
                            ]}
                          />
                        )}
                      </Card>
                    ),
                  }
                : null,
              canManageCompensation || canManageSynthetic || canGenerateAi
                ? {
                    key: "super-admin",
                    label: t("admin.highRiskConfirm"),
                    children: (
                      <Row gutter={[16, 16]}>
                        {canManageCompensation ? (
                          <Col xs={24} xl={8}>
                            <Card
                              className="nmth-panel"
                              title={t("admin.compensation")}
                              extra={<ShieldAlert size={16} color="#E8374A" />}
                            >
                              <Form
                                form={compensationForm}
                                layout="vertical"
                                onFinish={generateCompensation}
                              >
                                <Form.Item
                                  name="deviceId"
                                  label={t("device.deviceName")}
                                  rules={[{ required: true }]}
                                >
                                  <Select
                                    showSearch
                                    options={deviceOptions}
                                    optionFilterProp="label"
                                    size={settingsControlSize}
                                  />
                                </Form.Item>
                                <Form.Item
                                  name="method"
                                  label={t("admin.method")}
                                  initialValue="linear_interpolation"
                                >
                                  <Select
                                    options={[
                                      {
                                        value: "linear_interpolation",
                                        label: "linear_interpolation",
                                      },
                                      {
                                        value: "previous_value",
                                        label: "previous_value",
                                      },
                                      { value: "manual", label: "manual" },
                                    ]}
                                    size={settingsControlSize}
                                  />
                                </Form.Item>
                                {compensationMethod === "manual" ? (
                                  <>
                                    <Form.Item
                                      name="manualTemperatureC"
                                      label={t("device.temperature")}
                                      rules={[{ required: true }]}
                                    >
                                      <InputNumber
                                        size={settingsControlSize}
                                        style={{ width: "100%" }}
                                      />
                                    </Form.Item>
                                    <Form.Item
                                      name="manualHumidityPercent"
                                      label={t("device.humidity")}
                                      rules={[{ required: true }]}
                                    >
                                      <InputNumber
                                        size={settingsControlSize}
                                        style={{ width: "100%" }}
                                      />
                                    </Form.Item>
                                  </>
                                ) : null}
                                <Form.Item
                                  name="range"
                                  label={t("report.range")}
                                  rules={[{ required: true }]}
                                >
                                  <DatePicker.RangePicker
                                    inputReadOnly={isCompactSettingsWorkflow}
                                    showTime
                                    style={{ width: "100%" }}
                                    size={settingsControlSize}
                                  />
                                </Form.Item>
                                <Form.Item
                                  name="reason"
                                  label={t("admin.reason")}
                                  rules={[{ required: true }]}
                                >
                                  <Input size={settingsControlSize} />
                                </Form.Item>
                                <Form.Item
                                  name="confirmationText"
                                  label={t("admin.highRiskConfirm")}
                                  rules={[{ required: true }]}
                                >
                                  <Input size={settingsControlSize} />
                                </Form.Item>
                                <Space>
                                  <Button
                                    onClick={() => void detectGaps()}
                                    size={settingsControlSize}
                                  >
                                    {t("app.search")}
                                  </Button>
                                  <Button
                                    type="primary"
                                    htmlType="submit"
                                    size={settingsControlSize}
                                  >
                                    {t("app.confirm")}
                                  </Button>
                                </Space>
                              </Form>
                              {isCompactSettingsWorkflow ? (
                                renderCompactGapRows()
                              ) : (
                                <Table
                                  rowKey={(row) =>
                                    `${row.deviceId}-${row.start}-${row.end}`
                                  }
                                  dataSource={gapRows}
                                  pagination={{ pageSize: 4 }}
                                  size="small"
                                  scroll={{ x: 680 }}
                                  columns={[
                                    {
                                      title: t("device.deviceName"),
                                      dataIndex: "deviceName",
                                    },
                                    {
                                      title: t("report.start"),
                                      dataIndex: "start",
                                      render: (value) =>
                                        new Date(
                                          String(value),
                                        ).toLocaleString(),
                                    },
                                    {
                                      title: t("report.end"),
                                      dataIndex: "end",
                                      render: (value) =>
                                        new Date(
                                          String(value),
                                        ).toLocaleString(),
                                    },
                                    {
                                      title: t("admin.recordCount"),
                                      dataIndex: "missingCount",
                                    },
                                  ]}
                                />
                              )}
                            </Card>
                          </Col>
                        ) : null}
                        {canManageSynthetic ? (
                          <Col xs={24} xl={8}>
                            <Card
                              className="nmth-panel"
                              title={t("admin.synthetic")}
                              extra={<Bot size={16} color="#004EA2" />}
                            >
                              <Form
                                layout="vertical"
                                onFinish={generateSynthetic}
                              >
                                <Form.Item
                                  name="deviceId"
                                  label={t("device.deviceName")}
                                  rules={[{ required: true }]}
                                >
                                  <Select
                                    showSearch
                                    options={deviceOptions}
                                    optionFilterProp="label"
                                    size={settingsControlSize}
                                  />
                                </Form.Item>
                                <Form.Item
                                  name="approachFactor"
                                  label={t("admin.method")}
                                  initialValue={0.65}
                                >
                                  <InputNumber
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    size={settingsControlSize}
                                    style={{ width: "100%" }}
                                  />
                                </Form.Item>
                                <Form.Item
                                  name="range"
                                  label={t("report.range")}
                                  rules={[{ required: true }]}
                                >
                                  <DatePicker.RangePicker
                                    inputReadOnly={isCompactSettingsWorkflow}
                                    showTime
                                    style={{ width: "100%" }}
                                    size={settingsControlSize}
                                  />
                                </Form.Item>
                                <Form.Item
                                  name="reason"
                                  label={t("admin.reason")}
                                  rules={[{ required: true }]}
                                >
                                  <Input size={settingsControlSize} />
                                </Form.Item>
                                <Form.Item
                                  name="confirmationText"
                                  label={t("admin.highRiskConfirm")}
                                  rules={[{ required: true }]}
                                >
                                  <Input size={settingsControlSize} />
                                </Form.Item>
                                <Button
                                  type="primary"
                                  htmlType="submit"
                                  size={settingsControlSize}
                                >
                                  {t("app.confirm")}
                                </Button>
                              </Form>
                              {syntheticResult ? (
                                <Typography.Paragraph type="secondary">
                                  {t("admin.recordCount")}:{" "}
                                  {syntheticResult.created ?? 0}
                                </Typography.Paragraph>
                              ) : null}
                            </Card>
                          </Col>
                        ) : null}
                        {canGenerateAi ? (
                          <Col xs={24} xl={8}>
                            <Card
                              className="nmth-panel"
                              title={t("ai.monthlyReport")}
                              extra={
                                <DatabaseBackup size={16} color="#004EA2" />
                              }
                            >
                              <Form layout="vertical" onFinish={generateAi}>
                                <Form.Item
                                  name="exhibitionId"
                                  label={t("exhibition.name")}
                                  rules={[{ required: true }]}
                                >
                                  <Select
                                    showSearch
                                    optionFilterProp="label"
                                    options={exhibitionOptions}
                                    size={settingsControlSize}
                                  />
                                </Form.Item>
                                <Form.Item
                                  name="month"
                                  label={t("ai.monthlyReport")}
                                  rules={[{ required: true }]}
                                >
                                  <Input
                                    placeholder="2026-05"
                                    size={settingsControlSize}
                                  />
                                </Form.Item>
                                <Button
                                  type="primary"
                                  htmlType="submit"
                                  size={settingsControlSize}
                                >
                                  {t("ai.deterministicFallback")}
                                </Button>
                              </Form>
                              {aiOutput ? (
                                <Space direction="vertical">
                                  <Tag>{aiOutput.provider}</Tag>
                                  <Typography.Paragraph>
                                    {aiOutput.summary}
                                  </Typography.Paragraph>
                                  <pre
                                    style={{
                                      maxWidth: "100%",
                                      overflowX: "auto",
                                      whiteSpace: "pre-wrap",
                                    }}
                                  >
                                    {JSON.stringify(
                                      aiOutput.content ?? {},
                                      null,
                                      2,
                                    )}
                                  </pre>
                                </Space>
                              ) : null}
                            </Card>
                          </Col>
                        ) : null}
                        {canManageCompensation || canManageSynthetic ? (
                          <Col xs={24}>
                            <Card
                              className="nmth-panel"
                              title={t("admin.adjustmentRecords")}
                            >
                              {isCompactSettingsWorkflow ? (
                                renderCompactAdjustments()
                              ) : (
                                <Table
                                  rowKey="id"
                                  loading={adjustments.isLoading}
                                  dataSource={adjustments.data ?? []}
                                  pagination={{ pageSize: 8 }}
                                  size="small"
                                  scroll={{ x: 920 }}
                                  columns={[
                                    {
                                      title: t("app.status"),
                                      dataIndex: "type",
                                      render: (type) => (
                                        <Tag
                                          color={
                                            type === "derived"
                                              ? "blue"
                                              : "orange"
                                          }
                                        >
                                          {type}
                                        </Tag>
                                      ),
                                    },
                                    {
                                      title: t("admin.method"),
                                      dataIndex: "method",
                                    },
                                    {
                                      title: t("admin.reason"),
                                      dataIndex: "reason",
                                      ellipsis: true,
                                    },
                                    {
                                      title: t("admin.createdAt"),
                                      dataIndex: "createdAt",
                                      render: (value) =>
                                        new Date(
                                          String(value),
                                        ).toLocaleString(),
                                    },
                                    {
                                      title: t("device.deviceName"),
                                      render: (_, row: any) =>
                                        row.measurements?.[0]?.device
                                          ?.deviceName ?? "-",
                                    },
                                    {
                                      title: t("admin.recordCount"),
                                      render: (_, row: any) =>
                                        row.measurements?.length ?? 0,
                                    },
                                  ]}
                                />
                              )}
                            </Card>
                          </Col>
                        ) : null}
                      </Row>
                    ),
                  }
                : null,
            ].filter(Boolean) as any
          }
        />
      </RequirePermission>
      <Modal
        title={
          userModal?.mode === "edit" ? t("admin.editUser") : t("admin.addUser")
        }
        open={Boolean(userModal)}
        onCancel={() => setUserModal(null)}
        onOk={() => userForm.submit()}
        width={isCompactSettingsWorkflow ? "calc(100vw - 32px)" : undefined}
      >
        <Form form={userForm} layout="vertical" onFinish={saveUser}>
          <Form.Item
            name="email"
            label={t("auth.email")}
            rules={[{ required: true, type: "email" }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="name"
            label={t("admin.operator")}
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="password"
            label={t("admin.password")}
            rules={[{ required: userModal?.mode === "create", min: 8 }]}
          >
            <Input.Password />
          </Form.Item>
          <Form.Item name="roleIds" label={t("admin.roles")}>
            <Select
              mode="multiple"
              options={roleOptions}
              optionFilterProp="label"
            />
          </Form.Item>
          <Form.Item name="dataProfiles" label={t("admin.allowedDataProfiles")}>
            <Checkbox.Group
              options={["DEMO", "REAL"].map((profile) => ({
                value: profile,
                label: t(`profile.${profile}`),
              }))}
            />
          </Form.Item>
          <Form.Item
            name="scopedExhibitionIds"
            label={t("admin.exhibitionScope")}
          >
            <Select
              mode="multiple"
              allowClear
              showSearch
              optionFilterProp="label"
              options={exhibitionOptions}
            />
          </Form.Item>
          <Form.Item name="scopedZoneIds" label={t("admin.zoneScope")}>
            <Select
              mode="multiple"
              allowClear
              showSearch
              optionFilterProp="label"
              options={zoneOptions}
            />
          </Form.Item>
          <Form.Item
            name="enabled"
            label={t("device.enabled")}
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
          <Typography.Title level={5}>{t("admin.contacts")}</Typography.Title>
          <Form.Item name="lineUserId" label={t("admin.lineUserId")}>
            <Input />
          </Form.Item>
          <Form.Item name="discordUserId" label={t("admin.discordUserId")}>
            <Input />
          </Form.Item>
          <Form.Item name="telegramChatId" label={t("admin.telegramChatId")}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={
          roleModal?.mode === "edit" ? t("admin.editRole") : t("admin.addRole")
        }
        open={Boolean(roleModal)}
        onCancel={() => setRoleModal(null)}
        onOk={() => roleForm.submit()}
        width={isCompactSettingsWorkflow ? "calc(100vw - 32px)" : undefined}
      >
        <Form form={roleForm} layout="vertical" onFinish={saveRole}>
          <Form.Item
            name="name"
            label={t("admin.roles")}
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="description" label={t("floorPlan.detail")}>
            <Input />
          </Form.Item>
          <Form.Item name="permissionKeys" label={t("admin.permissions")}>
            <Checkbox.Group options={permissionOptions} />
          </Form.Item>
        </Form>
      </Modal>
    </AppShell>
  );
}

"use client";

import {
  App,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import type { ActionType, ProColumns } from "@ant-design/pro-components";
import { useQuery } from "@tanstack/react-query";
import {
  BadgeCheck,
  Eye,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppShell } from "../../../components/AppShell";
import { FloorPlanDashboard } from "../../../components/FloorPlanDashboard";
import { PageHeader } from "../../../components/PageHeader";
import { PdfFloorPlanUploader } from "../../../components/PdfFloorPlanUploader";
import {
  ResponsiveActionGroup,
  type ResponsiveAction,
} from "../../../components/actions";
import { apiFetch } from "../../../lib/api";
import { RequirePermission, usePermissions } from "../../../lib/permissions";
import { useResponsiveMode } from "../../../lib/responsive";

const ProTable = dynamic(
  () => import("@ant-design/pro-components").then((module) => module.ProTable),
  { ssr: false },
) as typeof import("@ant-design/pro-components").ProTable;

type ExhibitionModal = { mode: "create" | "edit"; record?: any } | null;
type ZoneModal = { exhibition: any } | null;
type PointModal = { point?: any } | null;
type VersionModal = { floorPlan: any; version: any } | null;

export default function ExhibitionsPage() {
  const t = useTranslations();
  const { message } = App.useApp();
  const actionRef = useRef<ActionType | undefined>(undefined);
  const [exhibitionForm] = Form.useForm();
  const [zoneForm] = Form.useForm();
  const [pointForm] = Form.useForm();
  const [versionForm] = Form.useForm();
  const [exhibitionModal, setExhibitionModal] = useState<ExhibitionModal>(null);
  const [zoneModal, setZoneModal] = useState<ZoneModal>(null);
  const [pointModal, setPointModal] = useState<PointModal>(null);
  const [versionModal, setVersionModal] = useState<VersionModal>(null);
  const [selectedExhibitionId, setSelectedExhibitionId] = useState<string>();
  const [listedExhibitions, setListedExhibitions] = useState<any[]>([]);
  const [selectedFloorPlanId, setSelectedFloorPlanId] = useState<string>();
  const [selectedVersionId, setSelectedVersionId] = useState<string>();
  const permissions = usePermissions();
  const { mode, isMobile, isTabletPortrait } = useResponsiveMode();
  const isCompactFloorPlanWorkflow = isMobile || isTabletPortrait;
  const canManageExhibitions = permissions.hasPermission("exhibitions:manage");
  const canManageFloorPlans = permissions.hasPermission("floorplans:manage");
  const canManageThresholds = permissions.hasPermission("thresholds:manage");

  const exhibitions = useQuery({
    queryKey: ["exhibitions", "management-options"],
    queryFn: () => apiFetch<any>("/exhibitions?page=1&pageSize=100"),
    retry: 1,
  });
  const selectedExhibition = useMemo(
    () =>
      (exhibitions.data?.items ?? listedExhibitions).find(
        (item: any) => item.id === selectedExhibitionId,
      ),
    [exhibitions.data?.items, listedExhibitions, selectedExhibitionId],
  );
  const exhibitionItems = (exhibitions.data?.items ??
    listedExhibitions) as any[];
  const floorPlans = useQuery({
    queryKey: ["floor-plans", "exhibition-management", selectedExhibitionId],
    queryFn: () =>
      apiFetch<any[]>(`/floor-plans?exhibitionId=${selectedExhibitionId}`),
    retry: 1,
    enabled: Boolean(selectedExhibitionId),
  });
  const devices = useQuery({
    queryKey: ["devices", "point-options", selectedExhibitionId],
    queryFn: () =>
      apiFetch<any>(
        `/devices?page=1&pageSize=200&exhibitionId=${selectedExhibitionId}`,
      ),
    retry: 1,
    enabled: Boolean(selectedExhibitionId && canManageFloorPlans),
  });
  const thresholdProfiles = useQuery({
    queryKey: ["threshold-profiles"],
    queryFn: () => apiFetch<any[]>("/exhibitions/threshold-profiles"),
    retry: 1,
    enabled: canManageThresholds,
  });

  const floorPlanOptions = (floorPlans.data ?? []).map((floorPlan: any) => ({
    value: floorPlan.id,
    label: floorPlan.name,
  }));
  const selectedFloorPlan =
    (floorPlans.data ?? []).find(
      (floorPlan: any) => floorPlan.id === selectedFloorPlanId,
    ) ?? floorPlans.data?.[0];
  const selectedVersion =
    selectedFloorPlan?.versions?.find(
      (version: any) => version.id === selectedVersionId,
    ) ??
    selectedFloorPlan?.activeVersion ??
    selectedFloorPlan?.versions?.find(
      (version: any) => version.id === selectedFloorPlan?.activeVersionId,
    ) ??
    selectedFloorPlan?.versions?.[0];
  const selectedVersionPoints = (selectedFloorPlan?.points ?? []).filter(
    (point: any) => !point.versionId || point.versionId === selectedVersion?.id,
  );
  const zoneOptions = (selectedExhibition?.zones ?? []).map((zone: any) => ({
    value: zone.id,
    label: zone.name,
  }));
  const deviceOptions = (devices.data?.items ?? []).map((device: any) => ({
    value: device.id,
    label: `${device.deviceName} - ${device.displayName}`,
  }));
  const thresholdOptions = (thresholdProfiles.data ?? []).map(
    (profile: any) => ({ value: profile.id, label: profile.name }),
  );
  const statusOptions = ["planned", "active", "closed"].map((value) => ({
    value,
    label: t(`exhibition.${value}`),
  }));

  useEffect(() => {
    const candidates = exhibitions.data?.items ?? listedExhibitions;
    if (!candidates.length) {
      setSelectedExhibitionId(undefined);
      setSelectedFloorPlanId(undefined);
      setSelectedVersionId(undefined);
      return;
    }
    if (
      !selectedExhibitionId ||
      !candidates.some((item: any) => item.id === selectedExhibitionId)
    ) {
      setSelectedExhibitionId(candidates[0]?.id);
      setSelectedFloorPlanId(undefined);
      setSelectedVersionId(undefined);
    }
  }, [exhibitions.data?.items, listedExhibitions, selectedExhibitionId]);

  useEffect(() => {
    if (!floorPlans.data?.length) {
      setSelectedFloorPlanId(undefined);
      setSelectedVersionId(undefined);
      return;
    }
    const nextFloorPlan =
      floorPlans.data.find(
        (floorPlan: any) => floorPlan.id === selectedFloorPlanId,
      ) ?? floorPlans.data[0];
    if (nextFloorPlan?.id !== selectedFloorPlanId) {
      setSelectedFloorPlanId(nextFloorPlan?.id);
    }
    const nextVersion =
      nextFloorPlan?.activeVersion ??
      nextFloorPlan?.versions?.find(
        (version: any) => version.id === nextFloorPlan?.activeVersionId,
      ) ??
      nextFloorPlan?.versions?.[0];
    if (
      !selectedVersionId ||
      !nextFloorPlan?.versions?.some(
        (version: any) => version.id === selectedVersionId,
      )
    ) {
      setSelectedVersionId(nextVersion?.id);
    }
  }, [floorPlans.data, selectedFloorPlanId, selectedVersionId]);

  function reloadExhibitions() {
    actionRef.current?.reload();
    void exhibitions.refetch();
  }

  async function reloadFloorPlans() {
    await floorPlans.refetch();
  }

  function openExhibitionModal(next: ExhibitionModal) {
    setExhibitionModal(next);
    if (next?.record) {
      exhibitionForm.setFieldsValue(next.record);
    } else {
      exhibitionForm.resetFields();
      exhibitionForm.setFieldsValue({ status: "planned" });
    }
  }

  async function saveExhibition(values: any) {
    if (exhibitionModal?.mode === "edit" && exhibitionModal.record) {
      await apiFetch(`/exhibitions/${exhibitionModal.record.id}`, {
        method: "PATCH",
        body: JSON.stringify(values),
      });
    } else {
      await apiFetch("/exhibitions", {
        method: "POST",
        body: JSON.stringify(values),
      });
    }
    message.success(t("app.save"));
    setExhibitionModal(null);
    reloadExhibitions();
  }

  async function archiveExhibition(record: any) {
    await apiFetch(`/exhibitions/${record.id}/archive`, {
      method: "POST",
      body: JSON.stringify({
        reason: "Archived from exhibition management UI",
      }),
    });
    message.success(t("app.archive"));
    reloadExhibitions();
  }

  async function saveZone(values: any) {
    if (!zoneModal) return;
    await apiFetch(`/exhibitions/${zoneModal.exhibition.id}/zones`, {
      method: "POST",
      body: JSON.stringify(values),
    });
    message.success(t("app.save"));
    setZoneModal(null);
    zoneForm.resetFields();
    reloadExhibitions();
  }

  function openPoint(point: any) {
    setPointModal({ point });
    pointForm.setFieldsValue({
      floorPlanId: point.floorPlanId,
      name: point.name,
      xRatio: point.xRatio,
      yRatio: point.yRatio,
      deviceId: point.deviceId,
      zoneId: point.zoneId,
      thresholdProfileId: point.thresholdProfileId,
    });
  }

  function openNewPoint() {
    if (!selectedFloorPlan) return;
    setPointModal({});
    pointForm.resetFields();
    pointForm.setFieldsValue({
      floorPlanId: selectedFloorPlan.id,
      xRatio: 0.5,
      yRatio: 0.5,
    });
  }

  async function savePoint(values: any) {
    if (!pointModal || (!pointModal.point && !selectedFloorPlan)) return;
    const floorPlanId = pointModal.point
      ? pointModal.point.floorPlanId
      : selectedFloorPlan?.id;
    if (!floorPlanId) return;
    const body = JSON.stringify({
      ...values,
      floorPlanId,
      versionId: pointModal.point
        ? pointModal.point.versionId
        : selectedVersion?.id,
      deviceId: values.deviceId ?? null,
      zoneId: values.zoneId ?? null,
      thresholdProfileId: values.thresholdProfileId ?? null,
    });
    await apiFetch(
      pointModal.point
        ? `/floor-plans/points/${pointModal.point.id}`
        : "/floor-plans/points",
      {
        method: pointModal.point ? "PATCH" : "POST",
        body,
      },
    );
    message.success(t("app.save"));
    setPointModal(null);
    await reloadFloorPlans();
  }

  async function archivePoint(point: any) {
    await apiFetch(`/floor-plans/points/${point.id}/archive`, {
      method: "POST",
      body: JSON.stringify({ reason: "Archived from point management UI" }),
    });
    message.success(t("app.archive"));
    await reloadFloorPlans();
  }

  function openVersionSettings(floorPlan: any, version: any) {
    setVersionModal({ floorPlan, version });
    versionForm.setFieldsValue({
      pageNumber: version.pageNumber ?? 1,
      width: version.width,
      height: version.height,
      renderScale: version.renderScale ?? 1,
    });
  }

  async function saveVersionSettings(values: any) {
    if (!versionModal) return;
    await apiFetch(
      `/floor-plans/${versionModal.floorPlan.id}/versions/${versionModal.version.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          pageNumber: values.pageNumber,
          width: values.width ?? null,
          height: values.height ?? null,
          renderScale: values.renderScale,
        }),
      },
    );
    message.success(t("app.save"));
    setVersionModal(null);
    await reloadFloorPlans();
  }

  async function setActiveVersion(floorPlan: any, version: any) {
    await apiFetch(
      `/floor-plans/${floorPlan.id}/versions/${version.id}/active`,
      { method: "POST" },
    );
    message.success(t("floorPlan.setActiveVersion"));
    setSelectedFloorPlanId(floorPlan.id);
    setSelectedVersionId(version.id);
    await reloadFloorPlans();
  }

  async function archiveVersion(floorPlan: any, version: any) {
    await apiFetch(
      `/floor-plans/${floorPlan.id}/versions/${version.id}/archive`,
      {
        method: "POST",
        body: JSON.stringify({
          reason: "Archived from floor plan version management UI",
        }),
      },
    );
    message.success(t("app.archive"));
    await reloadFloorPlans();
  }

  async function archiveFloorPlan(floorPlan: any) {
    await apiFetch(`/floor-plans/${floorPlan.id}/archive`, {
      method: "POST",
      body: JSON.stringify({
        reason: "Archived from floor plan management UI",
      }),
    });
    message.success(t("app.archive"));
    setSelectedFloorPlanId(undefined);
    setSelectedVersionId(undefined);
    await reloadFloorPlans();
  }

  function buildExhibitionActions(row: any): ResponsiveAction[] {
    return canManageExhibitions
      ? [
          {
            key: "edit",
            label: t("app.edit"),
            ariaLabel: t("app.edit"),
            icon: <Pencil size={15} />,
            kind: "row-primary",
            frequency: "high",
            risk: "low",
            permission: "exhibitions:manage",
            onClick: () => {
              openExhibitionModal({ mode: "edit", record: row });
            },
          },
          {
            key: "add-unit",
            label: t("exhibition.addUnit"),
            ariaLabel: t("exhibition.addUnit"),
            icon: <Plus size={15} />,
            kind: "row-secondary",
            frequency: "high",
            risk: "low",
            permission: "exhibitions:manage",
            onClick: () => {
              setZoneModal({ exhibition: row });
              zoneForm.resetFields();
            },
          },
          {
            key: "archive",
            label: t("app.archive"),
            ariaLabel: t("app.archive"),
            icon: <Trash2 size={15} />,
            kind: "danger",
            frequency: "high",
            risk: "destructive",
            reversible: false,
            permission: "exhibitions:manage",
            confirm: {
              title: t("app.archive"),
              okText: t("app.archive"),
              cancelText: t("app.cancel"),
            },
            onClick: async () => {
              await archiveExhibition(row);
            },
          },
        ]
      : [];
  }

  function renderExhibitionActions(row: any) {
    return canManageExhibitions ? (
      <ResponsiveActionGroup
        actions={buildExhibitionActions(row)}
        ariaLabel={t("app.actions")}
        mode={mode}
        overflowLabel={t("app.actions")}
        permissions={permissions.permissions}
        surface="row"
      />
    ) : null;
  }

  function buildVersionActions(floorPlan: any, version: any): ResponsiveAction[] {
    const isActiveVersion = version.id === floorPlan?.activeVersionId;
    return [
      {
        key: "view",
        label: t("app.view"),
        ariaLabel: t("app.view"),
        icon: <Eye size={15} />,
        kind: "row-primary",
        frequency: "high",
        risk: "low",
        onClick: () => {
          setSelectedVersionId(version.id);
        },
      },
      canManageFloorPlans
        ? {
            key: "set-active",
            label: t("floorPlan.setActiveVersion"),
            ariaLabel: t("floorPlan.setActiveVersion"),
            disabled: isActiveVersion,
            disabledReason: t("floorPlan.activeVersionAlreadyActive"),
            icon: <BadgeCheck size={15} />,
            kind: "state-change",
            frequency: "high",
            risk: "state-change",
            reversible: true,
            permission: "floorplans:manage",
            confirm: {
              title: t("floorPlan.setActiveVersionConfirmTitle"),
              description: t("floorPlan.setActiveVersionConfirmDescription"),
              okText: t("floorPlan.setActiveVersionConfirmOk"),
              cancelText: t("app.cancel"),
            },
            onClick: async () => {
              await setActiveVersion(floorPlan, version);
            },
          }
        : null,
      canManageFloorPlans
        ? {
            key: "edit",
            label: t("app.edit"),
            ariaLabel: t("app.edit"),
            icon: <Pencil size={15} />,
            kind: "row-secondary",
            frequency: "high",
            risk: "low",
            permission: "floorplans:manage",
            onClick: () => {
              openVersionSettings(floorPlan, version);
            },
          }
        : null,
      canManageFloorPlans
        ? {
            key: "archive",
            label: t("app.archive"),
            ariaLabel: t("app.archive"),
            icon: <Trash2 size={15} />,
            kind: "danger",
            frequency: "high",
            risk: "destructive",
            reversible: false,
            permission: "floorplans:manage",
            confirm: {
              title: t("app.archive"),
              okText: t("app.archive"),
              cancelText: t("app.cancel"),
            },
            onClick: async () => {
              await archiveVersion(floorPlan, version);
            },
          }
        : null,
    ].filter(Boolean) as ResponsiveAction[];
  }

  function renderVersionActions(floorPlan: any, version: any) {
    return (
      <ResponsiveActionGroup
        actions={buildVersionActions(floorPlan, version)}
        ariaLabel={t("app.actions")}
        mode={mode}
        overflowLabel={t("app.actions")}
        permissions={permissions.permissions}
        surface="row"
      />
    );
  }

  function buildPointActions(row: any): ResponsiveAction[] {
    return canManageFloorPlans
      ? [
          {
            key: "edit",
            label: t("app.edit"),
            ariaLabel: t("app.edit"),
            icon: <Pencil size={15} />,
            kind: "row-primary",
            frequency: "high",
            risk: "low",
            permission: "floorplans:manage",
            onClick: () => {
              openPoint(row);
            },
          },
          {
            key: "archive",
            label: t("app.archive"),
            ariaLabel: t("app.archive"),
            icon: <Trash2 size={15} />,
            kind: "danger",
            frequency: "high",
            risk: "destructive",
            reversible: false,
            permission: "floorplans:manage",
            confirm: {
              title: t("app.archive"),
              okText: t("app.archive"),
              cancelText: t("app.cancel"),
            },
            onClick: async () => {
              await archivePoint(row);
            },
          },
        ]
      : [];
  }

  function renderPointActions(row: any) {
    return canManageFloorPlans ? (
      <ResponsiveActionGroup
        actions={buildPointActions(row)}
        ariaLabel={t("app.actions")}
        mode={mode}
        permissions={permissions.permissions}
        surface="row"
      />
    ) : null;
  }

  function buildFloorPlanActions(floorPlan: any): ResponsiveAction[] {
    return [
      {
        key: "archive-floor-plan",
        label: t("floorPlan.archiveFloorPlan"),
        ariaLabel: t("floorPlan.archiveFloorPlan"),
        icon: <Trash2 size={15} />,
        kind: "danger",
        frequency: "high",
        risk: "destructive",
        reversible: false,
        permission: "floorplans:manage",
        confirm: {
          title: t("floorPlan.archiveFloorPlan"),
          okText: t("app.archive"),
          cancelText: t("app.cancel"),
        },
        onClick: () => archiveFloorPlan(floorPlan),
      },
    ];
  }

  function renderArchiveFloorPlanAction(
    floorPlan: any,
    text = false,
    touch = false,
  ) {
    return (
      <ResponsiveActionGroup
        actions={buildFloorPlanActions(floorPlan)}
        mode={mode}
        permissions={permissions.permissions}
        surface={text ? "compact-list" : "row"}
        touch={touch}
      />
    );
  }

  function renderCompactExhibitionActions(row: any) {
    if (!canManageExhibitions) {
      return null;
    }
    return (
      <ResponsiveActionGroup
        actions={buildExhibitionActions(row)}
        ariaLabel={t("app.actions")}
        maxVisibleMobile={3}
        mobileCardBehavior="compact-actions"
        mode={mode}
        overflowLabel={t("app.actions")}
        permissions={permissions.permissions}
        surface="mobile-card"
        touch
      />
    );
  }

  function renderCompactVersionActions(floorPlan: any, version: any) {
    return (
      <ResponsiveActionGroup
        actions={buildVersionActions(floorPlan, version)}
        ariaLabel={t("app.actions")}
        maxVisibleMobile={3}
        mobileCardBehavior="compact-actions"
        mode={mode}
        overflowLabel={t("app.actions")}
        permissions={permissions.permissions}
        surface="mobile-card"
        touch
      />
    );
  }

  function renderCompactPointActions(row: any) {
    if (!canManageFloorPlans) {
      return null;
    }
    return (
      <ResponsiveActionGroup
        actions={buildPointActions(row)}
        ariaLabel={t("app.actions")}
        maxVisibleMobile={3}
        mobileCardBehavior="compact-actions"
        mode={mode}
        overflowLabel={t("app.actions")}
        permissions={permissions.permissions}
        surface="mobile-card"
        touch
      />
    );
  }

  const columns: ProColumns<any>[] = [
    { title: t("exhibition.code"), dataIndex: "code", copyable: true },
    { title: t("exhibition.name"), dataIndex: "name" },
    {
      title: t("exhibition.status"),
      dataIndex: "status",
      valueEnum: {
        planned: { text: t("exhibition.planned"), status: "Default" },
        active: { text: t("exhibition.active"), status: "Processing" },
        closed: { text: t("exhibition.closed"), status: "Success" },
        archived: { text: t("app.archive"), status: "Default" },
      },
    },
    { title: t("exhibition.owner"), dataIndex: "owner", search: false },
    {
      title: t("exhibition.units"),
      dataIndex: "zones",
      search: false,
      render: (_, row) =>
        row.zones?.map((zone: any) => <Tag key={zone.id}>{zone.name}</Tag>),
    },
    {
      title: t("floorPlan.availableVersions"),
      dataIndex: "floorPlans",
      search: false,
      render: (_, row) => {
        const versionCount =
          row.floorPlans?.reduce(
            (sum: number, floorPlan: any) =>
              sum + (floorPlan.versions?.length ?? 0),
            0,
          ) ?? 0;
        const activeCount =
          row.floorPlans?.filter(
            (floorPlan: any) =>
              floorPlan.activeVersionId &&
              floorPlan.versions?.some(
                (version: any) => version.id === floorPlan.activeVersionId,
              ),
          ).length ?? 0;
        return (
          <Space size={6} wrap>
            <Typography.Text>
              {versionCount
                ? `${versionCount} ${t("floorPlan.versionUnit")}`
                : "-"}
            </Typography.Text>
            {activeCount ? (
              <Tag color="green">{`${t("floorPlan.activeVersion")} ${activeCount}`}</Tag>
            ) : null}
          </Space>
        );
      },
    },
    ...(canManageExhibitions
      ? [
          {
            title: t("app.actions"),
            valueType: "option",
            render: (_, row) => renderExhibitionActions(row),
          } satisfies ProColumns<any>,
        ]
      : []),
  ];

  const versionColumns: ProColumns<any>[] = [
    {
      title: t("app.version"),
      dataIndex: "version",
      width: 112,
      render: (_, row) => `${t("app.version")} ${row.version}`,
    },
    {
      title: t("app.status"),
      dataIndex: "id",
      search: false,
      width: 150,
      render: (_, row) =>
        row.id === selectedFloorPlan?.activeVersionId ? (
          <Tag color="green">{t("floorPlan.activeVersion")}</Tag>
        ) : (
          <Tag>{t("floorPlan.archivedVersion")}</Tag>
        ),
    },
    {
      title: t("app.createdAt"),
      dataIndex: "createdAt",
      search: false,
      render: (_, row) => new Date(row.createdAt).toLocaleString(),
    },
    {
      title: t("floorPlan.fileName"),
      dataIndex: "pdfOriginalPath",
      search: false,
      ellipsis: true,
      render: (_, row) =>
        String(row.pdfOriginalPath ?? "")
          .split("/")
          .at(-1),
    },
    {
      title: t("floorPlan.page"),
      dataIndex: "pageNumber",
      search: false,
      width: 76,
    },
    {
      title: t("floorPlan.dimensions"),
      dataIndex: "width",
      search: false,
      render: (_, row) =>
        row.width && row.height ? `${row.width} x ${row.height}` : "-",
    },
    {
      title: t("floorPlan.renderScale"),
      dataIndex: "renderScale",
      search: false,
      render: (_, row) =>
        Number(row.renderScale ?? 1) > 1
          ? t("floorPlan.renderScaleHigh")
          : t("floorPlan.renderScaleStandard"),
    },
    {
      title: t("app.actions"),
      valueType: "option",
      render: (_, row) => renderVersionActions(selectedFloorPlan, row),
    },
  ];

  const pointRows = selectedVersionPoints.map((point: any) => ({
    ...point,
    floorPlanId: selectedFloorPlan?.id,
    floorPlanName: selectedFloorPlan?.name,
    exhibitionName: selectedExhibition?.name,
  }));

  const pointColumns: ProColumns<any>[] = [
    { title: t("floorPlan.pointName"), dataIndex: "name", ellipsis: true },
    {
      title: t("exhibition.name"),
      dataIndex: "exhibitionName",
      search: false,
      ellipsis: true,
    },
    {
      title: t("exhibition.floorPlans"),
      dataIndex: "floorPlanName",
      search: false,
      ellipsis: true,
    },
    {
      title: t("device.deviceName"),
      dataIndex: ["device", "deviceName"],
      copyable: true,
    },
    { title: t("exhibition.unit"), dataIndex: ["zone", "name"], search: false },
    {
      title: t("floorPlan.xRatio"),
      dataIndex: "xRatio",
      search: false,
      render: (_, row) => Number(row.xRatio).toFixed(2),
    },
    {
      title: t("floorPlan.yRatio"),
      dataIndex: "yRatio",
      search: false,
      render: (_, row) => Number(row.yRatio).toFixed(2),
    },
    ...(canManageFloorPlans
      ? [
          {
            title: t("app.actions"),
            valueType: "option",
            render: (_, row) => renderPointActions(row),
          } satisfies ProColumns<any>,
        ]
      : []),
  ];

  return (
    <AppShell>
      <RequirePermission any={["exhibitions:read", "floorplans:read"]}>
        <PageHeader
          eyebrow="Collection Context"
          title={t("exhibition.title")}
          actions={
            isMobile && canManageExhibitions ? (
              <Button
                type="primary"
                icon={<Plus size={15} />}
                onClick={() => openExhibitionModal({ mode: "create" })}
              >
                {t("exhibition.addExhibition")}
              </Button>
            ) : null
          }
        />
        <Row gutter={[16, 16]}>
          <Col xs={24}>
            {isMobile ? (
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                {exhibitionItems.length ? (
                  exhibitionItems.map((row: any) => {
                    const versionCount =
                      row.floorPlans?.reduce(
                        (sum: number, floorPlan: any) =>
                          sum + (floorPlan.versions?.length ?? 0),
                        0,
                      ) ?? 0;
                    return (
                      <Card
                        key={row.id}
                        className="nmth-panel"
                        size="small"
                        onClick={() => {
                          setSelectedExhibitionId(row.id);
                          setSelectedFloorPlanId(undefined);
                          setSelectedVersionId(undefined);
                        }}
                        style={{
                          cursor: "pointer",
                          borderColor:
                            row.id === selectedExhibitionId
                              ? "var(--nmth-blue)"
                              : undefined,
                        }}
                      >
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
                            <Typography.Text strong>{row.name}</Typography.Text>
                            <Tag
                              color={
                                row.status === "active"
                                  ? "green"
                                  : row.status === "closed"
                                    ? "default"
                                    : "blue"
                              }
                            >
                              {t(`exhibition.${row.status}`)}
                            </Tag>
                          </div>
                          <Space wrap size={[6, 6]}>
                            <Tag>{row.code}</Tag>
                            {row.owner ? <Tag>{row.owner}</Tag> : null}
                            <Tag>{`${t("floorPlan.availableVersions")}: ${versionCount}`}</Tag>
                          </Space>
                          <Typography.Paragraph
                            ellipsis={{ rows: 2 }}
                            style={{ marginBottom: 0 }}
                          >
                            {row.preservationGoal ||
                              t("exhibition.preservationGoalEmpty")}
                          </Typography.Paragraph>
                          {renderCompactExhibitionActions(row)}
                        </Space>
                      </Card>
                    );
                  })
                ) : (
                  <Card className="nmth-panel">
                    <Empty
                      description={
                        exhibitions.isLoading
                          ? t("app.loading")
                          : t("app.empty")
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
                columns={columns}
                request={async (params) => {
                  const result = await apiFetch<any>(
                    `/exhibitions?page=${params.current ?? 1}&pageSize=${params.pageSize ?? 20}&search=${encodeURIComponent(String(params.keyword ?? ""))}`,
                  );
                  setListedExhibitions(result.items ?? []);
                  return {
                    data: result.items,
                    success: true,
                    total: result.total,
                  };
                }}
                search={{ labelWidth: "auto" }}
                pagination={{ pageSize: 20 }}
                scroll={{ x: 1120 }}
                rowSelection={{
                  type: "radio",
                  selectedRowKeys: selectedExhibitionId
                    ? [selectedExhibitionId]
                    : [],
                  onChange: (keys) => {
                    setSelectedExhibitionId(String(keys[0]));
                    setSelectedFloorPlanId(undefined);
                    setSelectedVersionId(undefined);
                  },
                }}
                onRow={(record) => ({
                  onClick: () => {
                    setSelectedExhibitionId(record.id);
                    setSelectedFloorPlanId(undefined);
                    setSelectedVersionId(undefined);
                  },
                })}
                toolBarRender={() =>
                  canManageExhibitions
                    ? [
                        <Button
                          key="add"
                          type="primary"
                          icon={<Plus size={15} />}
                          onClick={() =>
                            openExhibitionModal({ mode: "create" })
                          }
                        >
                          {t("exhibition.addExhibition")}
                        </Button>,
                      ]
                    : []
                }
              />
            )}
          </Col>

          {selectedExhibition ? (
            <>
              <Col xs={24}>
                <div className="nmth-panel" style={{ padding: 18 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 16,
                      flexWrap: "wrap",
                    }}
                  >
                    <Space direction="vertical" size={4}>
                      <Typography.Text type="secondary">
                        {t("exhibition.managingExhibition")}
                      </Typography.Text>
                      <Typography.Title level={4} style={{ margin: 0 }}>
                        {selectedExhibition.name}
                      </Typography.Title>
                      <Space wrap>
                        <Tag>{selectedExhibition.code}</Tag>
                        <Tag
                          color={
                            selectedExhibition.status === "active"
                              ? "green"
                              : selectedExhibition.status === "closed"
                                ? "default"
                                : "blue"
                          }
                        >
                          {t(`exhibition.${selectedExhibition.status}`)}
                        </Tag>
                        {selectedExhibition.owner ? (
                          <Tag>{selectedExhibition.owner}</Tag>
                        ) : null}
                      </Space>
                    </Space>
                    <Typography.Paragraph
                      style={{ maxWidth: 620, marginBottom: 0 }}
                    >
                      {selectedExhibition.preservationGoal ||
                        t("exhibition.preservationGoalEmpty")}
                    </Typography.Paragraph>
                  </div>
                </div>
              </Col>

              <Col xs={24}>
                {isCompactFloorPlanWorkflow ? (
                  <Card
                    className="nmth-panel"
                    title={t("floorPlan.versionManagement")}
                  >
                    <Space
                      direction="vertical"
                      size={12}
                      style={{ width: "100%" }}
                    >
                      <Select
                        value={selectedFloorPlan?.id}
                        onChange={(value) => {
                          setSelectedFloorPlanId(value);
                          setSelectedVersionId(undefined);
                        }}
                        options={floorPlanOptions}
                        placeholder={t("floorPlan.selectOrCreateFloorPlan")}
                        style={{ width: "100%" }}
                      />
                      {selectedFloorPlan && canManageFloorPlans
                        ? renderArchiveFloorPlanAction(
                            selectedFloorPlan,
                            true,
                            true,
                          )
                        : null}
                      {canManageFloorPlans ? (
                        <PdfFloorPlanUploader
                          exhibitionId={selectedExhibitionId}
                          onUploaded={reloadFloorPlans}
                        />
                      ) : null}
                      {selectedFloorPlan?.versions?.length ? (
                        <Space
                          direction="vertical"
                          size={10}
                          style={{ width: "100%" }}
                        >
                          {selectedFloorPlan.versions.map((version: any) => (
                            <Card key={version.id} size="small">
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
                                  >{`${t("app.version")} ${version.version}`}</Typography.Text>
                                  {version.id ===
                                  selectedFloorPlan?.activeVersionId ? (
                                    <Tag color="green">
                                      {t("floorPlan.activeVersion")}
                                    </Tag>
                                  ) : (
                                    <Tag>{t("floorPlan.archivedVersion")}</Tag>
                                  )}
                                </div>
                                <Space wrap size={[6, 6]}>
                                  <Tag>{`${t("floorPlan.page")}: ${version.pageNumber ?? "-"}`}</Tag>
                                  <Tag>
                                    {version.width && version.height
                                      ? `${version.width} x ${version.height}`
                                      : t("floorPlan.dimensions")}
                                  </Tag>
                                </Space>
                                {renderCompactVersionActions(
                                  selectedFloorPlan,
                                  version,
                                )}
                              </Space>
                            </Card>
                          ))}
                        </Space>
                      ) : (
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description={t("floorPlan.noFloorPlan")}
                        />
                      )}
                    </Space>
                  </Card>
                ) : (
                  <ProTable
                    className="nmth-panel"
                    rowKey="id"
                    columns={versionColumns}
                    dataSource={selectedFloorPlan?.versions ?? []}
                    loading={floorPlans.isLoading}
                    search={false}
                    pagination={{ pageSize: 5 }}
                    options={false}
                    size="small"
                    scroll={{ x: 1020 }}
                    headerTitle={t("floorPlan.versionManagement")}
                    toolBarRender={() => {
                      const tools: ReactNode[] = [];
                      if (floorPlanOptions.length > 1) {
                        tools.push(
                          <Select
                            key="floor-plan"
                            value={selectedFloorPlan?.id}
                            onChange={(value) => {
                              setSelectedFloorPlanId(value);
                              setSelectedVersionId(undefined);
                            }}
                            options={floorPlanOptions}
                            placeholder={t("floorPlan.selectOrCreateFloorPlan")}
                            style={{ minWidth: 160, maxWidth: 320 }}
                          />,
                        );
                      }
                      if (selectedFloorPlan && canManageFloorPlans) {
                        tools.push(
                          <span key="archive-floor-plan">
                            {renderArchiveFloorPlanAction(selectedFloorPlan)}
                          </span>,
                        );
                      }
                      if (canManageFloorPlans) {
                        tools.push(
                          <PdfFloorPlanUploader
                            key="upload"
                            exhibitionId={selectedExhibitionId}
                            onUploaded={reloadFloorPlans}
                          />,
                        );
                      }
                      return tools;
                    }}
                  />
                )}
              </Col>

              <Col xs={24}>
                <FloorPlanDashboard
                  points={selectedVersionPoints}
                  editable={canManageFloorPlans}
                  hasFloorPlan={Boolean(selectedFloorPlan)}
                  pdfUrl={
                    selectedVersion?.pdfUrl ?? selectedVersion?.fileUrl ?? null
                  }
                  renderedImageUrl={selectedVersion?.renderedImageUrl ?? null}
                  pageNumber={selectedVersion?.pageNumber}
                  pageWidth={selectedVersion?.width}
                  pageHeight={selectedVersion?.height}
                  renderScale={selectedVersion?.renderScale}
                  onPointSaved={reloadFloorPlans}
                />
              </Col>

              {canManageFloorPlans ? (
                <Col xs={24}>
                  {isCompactFloorPlanWorkflow ? (
                    <Card
                      className="nmth-panel"
                      title={t("floorPlan.pointManagement")}
                      extra={
                        <Button
                          type="primary"
                          icon={<Plus size={15} />}
                          disabled={!selectedFloorPlan}
                          onClick={openNewPoint}
                        >
                          {t("floorPlan.addPoint")}
                        </Button>
                      }
                    >
                      {pointRows.length ? (
                        <Space
                          direction="vertical"
                          size={10}
                          style={{ width: "100%" }}
                        >
                          {pointRows.map((row: any) => (
                            <Card key={row.id} size="small">
                              <Space
                                direction="vertical"
                                size={8}
                                style={{ width: "100%" }}
                              >
                                <Typography.Text strong>
                                  {row.name}
                                </Typography.Text>
                                <Space wrap size={[6, 6]}>
                                  <Tag>{row.device?.deviceName ?? "-"}</Tag>
                                  <Tag>{row.zone?.name ?? "-"}</Tag>
                                  <Tag>{`X ${Number(row.xRatio).toFixed(2)} / Y ${Number(row.yRatio).toFixed(2)}`}</Tag>
                                </Space>
                                {renderCompactPointActions(row)}
                              </Space>
                            </Card>
                          ))}
                        </Space>
                      ) : (
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description={t("floorPlan.noPoints")}
                        />
                      )}
                    </Card>
                  ) : (
                    <ProTable
                      className="nmth-panel"
                      rowKey="id"
                      columns={pointColumns}
                      dataSource={pointRows}
                      loading={floorPlans.isLoading}
                      search={false}
                      pagination={{ pageSize: 6 }}
                      options={false}
                      size="small"
                      scroll={{ x: 980 }}
                      headerTitle={t("floorPlan.pointManagement")}
                      toolBarRender={() => [
                        <Button
                          key="add"
                          type="primary"
                          icon={<Plus size={15} />}
                          disabled={!selectedFloorPlan}
                          onClick={openNewPoint}
                        >
                          {t("floorPlan.addPoint")}
                        </Button>,
                      ]}
                    />
                  )}
                </Col>
              ) : null}
            </>
          ) : (
            <Col xs={24}>
              <div className="nmth-panel" style={{ padding: 24 }}>
                <Empty description={t("exhibition.selectExhibition")} />
              </div>
            </Col>
          )}
        </Row>
      </RequirePermission>

      <Modal
        title={
          exhibitionModal?.mode === "edit"
            ? t("app.edit")
            : t("exhibition.addExhibition")
        }
        open={Boolean(exhibitionModal)}
        onCancel={() => setExhibitionModal(null)}
        onOk={() => exhibitionForm.submit()}
      >
        <Form form={exhibitionForm} layout="vertical" onFinish={saveExhibition}>
          {exhibitionModal?.mode === "edit" ? (
            <Form.Item name="code" label={t("exhibition.code")}>
              <Input disabled />
            </Form.Item>
          ) : null}
          <Form.Item
            name="name"
            label={t("exhibition.name")}
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="status" label={t("exhibition.status")}>
            <Select options={statusOptions} />
          </Form.Item>
          <Form.Item name="owner" label={t("exhibition.owner")}>
            <Input />
          </Form.Item>
          <Form.Item
            name="preservationGoal"
            label={t("exhibition.preservationGoal")}
            help={t("exhibition.preservationGoalHelp")}
          >
            <Input.TextArea
              rows={5}
              placeholder={t("exhibition.preservationGoalPlaceholder")}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("exhibition.addUnit")}
        open={Boolean(zoneModal)}
        onCancel={() => setZoneModal(null)}
        onOk={() => zoneForm.submit()}
      >
        <Form form={zoneForm} layout="vertical" onFinish={saveZone}>
          <Form.Item
            name="name"
            label={t("exhibition.unitName")}
            rules={[{ required: true }]}
          >
            <Input placeholder={t("exhibition.unitNamePlaceholder")} />
          </Form.Item>
          <Form.Item
            name="description"
            label={t("exhibition.unitDescription")}
            help={t("exhibition.unitDescriptionHelp")}
          >
            <Input.TextArea
              rows={4}
              placeholder={t("exhibition.unitDescriptionPlaceholder")}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("floorPlan.versionSettings")}
        open={Boolean(versionModal)}
        onCancel={() => setVersionModal(null)}
        onOk={() => versionForm.submit()}
      >
        <Form
          form={versionForm}
          layout="vertical"
          onFinish={saveVersionSettings}
        >
          <Form.Item
            name="pageNumber"
            label={t("floorPlan.page")}
            rules={[{ required: true }]}
          >
            <InputNumber min={1} precision={0} style={{ width: 88 }} />
          </Form.Item>
          <Form.Item name="width" label={t("floorPlan.width")}>
            <InputNumber min={1} precision={0} />
          </Form.Item>
          <Form.Item name="height" label={t("floorPlan.height")}>
            <InputNumber min={1} precision={0} />
          </Form.Item>
          <Form.Item
            name="renderScale"
            label={t("floorPlan.renderScale")}
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { value: 1, label: t("floorPlan.renderScaleStandard") },
                { value: 2, label: t("floorPlan.renderScaleHigh") },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("floorPlan.pointManagement")}
        open={Boolean(pointModal)}
        onCancel={() => setPointModal(null)}
        onOk={() => pointForm.submit()}
      >
        <Form form={pointForm} layout="vertical" onFinish={savePoint}>
          <Form.Item
            name="floorPlanId"
            label={t("exhibition.floorPlans")}
            rules={[{ required: true }]}
          >
            <Select
              disabled
              showSearch
              optionFilterProp="label"
              options={floorPlanOptions}
            />
          </Form.Item>
          <Form.Item
            name="name"
            label={t("floorPlan.pointName")}
            rules={[{ required: true }]}
            help={t("floorPlan.pointHelp")}
          >
            <Input placeholder={t("floorPlan.pointNamePlaceholder")} />
          </Form.Item>
          <Form.Item
            name="xRatio"
            label={t("floorPlan.xRatio")}
            rules={[{ required: true }]}
          >
            <InputNumber min={0} max={1} step={0.01} />
          </Form.Item>
          <Form.Item
            name="yRatio"
            label={t("floorPlan.yRatio")}
            rules={[{ required: true }]}
          >
            <InputNumber min={0} max={1} step={0.01} />
          </Form.Item>
          <Form.Item name="deviceId" label={t("floorPlan.bindDevice")}>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              options={deviceOptions}
            />
          </Form.Item>
          <Form.Item name="zoneId" label={t("exhibition.unit")}>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              options={zoneOptions}
            />
          </Form.Item>
          {canManageThresholds ? (
            <Form.Item
              name="thresholdProfileId"
              label={t("floorPlan.threshold")}
            >
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                options={thresholdOptions}
              />
            </Form.Item>
          ) : null}
        </Form>
      </Modal>
    </AppShell>
  );
}

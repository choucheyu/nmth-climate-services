"use client";

import { Space, Switch, Tag, Typography } from "antd";
import { useTranslations } from "next-intl";

type AutoRefreshStatusProps = {
  enabled: boolean;
  intervalMs: number;
  isError?: boolean;
  isFetching?: boolean;
  isPaused?: boolean;
  isStale?: boolean;
  lastUpdatedAt?: number | null;
  onEnabledChange: (enabled: boolean) => void;
};

function formatInterval(intervalMs: number) {
  if (intervalMs >= 60_000 && intervalMs % 60_000 === 0) {
    return `${intervalMs / 60_000}m`;
  }
  return `${Math.round(intervalMs / 1000)}s`;
}

export function AutoRefreshStatus({
  enabled,
  intervalMs,
  isError = false,
  isFetching = false,
  isPaused = false,
  isStale = false,
  lastUpdatedAt,
  onEnabledChange,
}: AutoRefreshStatusProps) {
  const t = useTranslations();
  const lastUpdatedLabel = lastUpdatedAt
    ? new Date(lastUpdatedAt).toLocaleTimeString()
    : "-";
  return (
    <Space size={8} wrap>
      <Typography.Text type="secondary">{t("app.autoRefresh")}</Typography.Text>
      <Switch
        size="small"
        checked={enabled}
        onChange={onEnabledChange}
        aria-label={t("app.autoRefresh")}
      />
      <Tag>{enabled ? t("app.on") : t("app.off")}</Tag>
      {enabled ? <Tag>{formatInterval(intervalMs)}</Tag> : null}
      <Typography.Text type="secondary">
        {t("app.lastRefresh")}: {lastUpdatedLabel}
      </Typography.Text>
      {isFetching ? <Tag color="processing">{t("app.updating")}</Tag> : null}
      {isPaused ? <Tag>{t("app.paused")}</Tag> : null}
      {isError ? <Tag color="orange">{t("app.updateFailedUsingCached")}</Tag> : null}
      {isStale ? <Tag color="gold">{t("app.dataStale")}</Tag> : null}
    </Space>
  );
}

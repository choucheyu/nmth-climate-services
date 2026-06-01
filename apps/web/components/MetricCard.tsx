"use client";

import { Card, Statistic } from "antd";
import type { ReactNode } from "react";

export function MetricCard({
  title,
  value,
  suffix,
  icon,
  status
}: {
  title: string;
  value: string | number;
  suffix?: string;
  icon?: ReactNode;
  status?: "normal" | "warning" | "critical" | "offline";
}) {
  return (
    <Card className="nmth-panel" styles={{ body: { padding: 18 } }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <span style={{ color: "var(--nmth-muted)", fontWeight: 600 }}>{title}</span>
        <span className={`nmth-status-dot ${status ?? ""}`} />
      </div>
      <Statistic value={value} suffix={suffix} prefix={icon} valueStyle={{ color: "var(--nmth-blue)", fontWeight: 700 }} />
    </Card>
  );
}

"use client";

import { Space } from "antd";
import type { ReactNode } from "react";
import { useResponsiveMode } from "../lib/responsive";

export function PageHeader({ eyebrow, title, actions }: { eyebrow: string; title: string; actions?: ReactNode }) {
  const { isMobile } = useResponsiveMode();

  return (
    <div className="nmth-section-title" style={isMobile ? { alignItems: "stretch", gap: 12 } : undefined}>
      <div style={{ minWidth: 0 }}>
        <small>{eyebrow}</small>
        <h1>{title}</h1>
      </div>
      {actions ? (
        <Space wrap style={isMobile ? { width: "100%" } : undefined}>
          {actions}
        </Space>
      ) : null}
    </div>
  );
}

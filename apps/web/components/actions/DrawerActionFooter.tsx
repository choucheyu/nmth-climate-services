"use client";

import { Space } from "antd";
import type { ReactNode } from "react";

function toArray(value?: ReactNode | ReactNode[]) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

export function DrawerActionFooter({
  children,
  danger,
  primary,
  secondary,
}: {
  children?: ReactNode;
  danger?: ReactNode | ReactNode[];
  primary?: ReactNode | ReactNode[];
  secondary?: ReactNode | ReactNode[];
}) {
  const actions = children
    ? [children]
    : [...toArray(secondary), ...toArray(danger), ...toArray(primary)];

  if (!actions.length) {
    return null;
  }

  return (
    <Space wrap style={{ justifyContent: "flex-end", width: "100%" }}>
      {actions}
    </Space>
  );
}

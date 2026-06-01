"use client";

import { Button, Popconfirm, Tooltip } from "antd";
import type { ButtonProps } from "antd";
import type { ReactNode } from "react";

export type DangerActionButtonProps = Pick<
  ButtonProps,
  "block" | "disabled" | "loading" | "size" | "style" | "type"
> & {
  ariaLabel: string;
  cancelText?: ReactNode;
  children?: ReactNode;
  danger?: boolean;
  description?: ReactNode;
  disabledReason?: ReactNode;
  icon?: ReactNode;
  okText?: ReactNode;
  onConfirm: () => void | Promise<void>;
  stopPropagation?: boolean;
  title: ReactNode;
  tooltip?: ReactNode;
  touch?: boolean;
};

export function DangerActionButton({
  ariaLabel,
  block,
  cancelText,
  children,
  danger,
  description,
  disabled,
  disabledReason,
  icon,
  loading,
  okText,
  onConfirm,
  size,
  stopPropagation = false,
  style,
  title,
  tooltip,
  touch = false,
  type,
}: DangerActionButtonProps) {
  const usesTextButton = children !== undefined && children !== null;
  const tooltipTitle = disabled && disabledReason ? disabledReason : tooltip;
  const confirmButton = (
    <Button
      block={block}
      aria-label={ariaLabel}
      danger={danger ?? usesTextButton}
      disabled={disabled}
      icon={icon}
      loading={loading}
      size={size ?? (touch ? "large" : undefined)}
      style={{
        ...(touch
          ? { minHeight: 44, minWidth: usesTextButton ? undefined : 44 }
          : {}),
        ...style,
      }}
      type={type}
    >
      {children}
    </Button>
  );
  const confirmed = (
    <Popconfirm
      cancelText={cancelText}
      description={description}
      disabled={disabled}
      okText={okText}
      onCancel={(event) => event?.stopPropagation()}
      onConfirm={(event) => {
        event?.stopPropagation();
        void onConfirm();
      }}
      title={title}
    >
      {confirmButton}
    </Popconfirm>
  );

  return (
    <span
      onClick={(event) => {
        if (stopPropagation) {
          event.stopPropagation();
        }
      }}
      style={{
        display: block ? "block" : "inline-flex",
        width: block ? "100%" : undefined,
      }}
    >
      {tooltipTitle ? (
        <Tooltip title={tooltipTitle}>
          <span
            style={{
              display: block ? "block" : "inline-flex",
              width: block ? "100%" : undefined,
            }}
          >
            {confirmed}
          </span>
        </Tooltip>
      ) : (
        confirmed
      )}
    </span>
  );
}

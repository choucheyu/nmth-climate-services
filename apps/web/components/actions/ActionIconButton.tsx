"use client";

import { Button, Tooltip } from "antd";
import type { ButtonProps } from "antd";
import type { ReactNode } from "react";

export type ActionIconButtonProps = Pick<
  ButtonProps,
  | "danger"
  | "disabled"
  | "href"
  | "loading"
  | "onClick"
  | "shape"
  | "size"
  | "style"
  | "target"
  | "type"
> & {
  ariaLabel: string;
  disabledReason?: ReactNode;
  icon: ReactNode;
  stopPropagation?: boolean;
  tooltip?: ReactNode;
  touch?: boolean;
};

export function ActionIconButton({
  ariaLabel,
  disabled,
  disabledReason,
  icon,
  onClick,
  size,
  stopPropagation = false,
  style,
  tooltip,
  touch = false,
  ...buttonProps
}: ActionIconButtonProps) {
  const title = disabled && disabledReason ? disabledReason : tooltip;
  const button = (
    <Button
      {...buttonProps}
      aria-label={ariaLabel}
      disabled={disabled}
      icon={icon}
      onClick={(event) => {
        if (stopPropagation) {
          event.stopPropagation();
        }
        onClick?.(event);
      }}
      size={size ?? (touch ? "large" : undefined)}
      style={{
        ...(touch ? { minHeight: 44, minWidth: 44 } : {}),
        ...style,
      }}
    />
  );

  if (!title) {
    return button;
  }

  return (
    <Tooltip title={title}>
      <span style={{ display: "inline-flex" }}>{button}</span>
    </Tooltip>
  );
}

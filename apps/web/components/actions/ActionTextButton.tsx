"use client";

import { Button, Tooltip } from "antd";
import type { ButtonProps } from "antd";
import type { ReactNode } from "react";

export type ActionTextButtonProps = Pick<
  ButtonProps,
  | "block"
  | "danger"
  | "disabled"
  | "htmlType"
  | "href"
  | "loading"
  | "onClick"
  | "size"
  | "style"
  | "target"
  | "type"
> & {
  ariaLabel?: string;
  children: ReactNode;
  disabledReason?: ReactNode;
  icon?: ReactNode;
  stopPropagation?: boolean;
  tooltip?: ReactNode;
  touch?: boolean;
};

export function ActionTextButton({
  ariaLabel,
  block,
  children,
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
}: ActionTextButtonProps) {
  const title = disabled && disabledReason ? disabledReason : tooltip;
  const button = (
    <Button
      {...buttonProps}
      aria-label={ariaLabel}
      block={block}
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
        ...(touch ? { minHeight: 44 } : {}),
        ...style,
      }}
    >
      {children}
    </Button>
  );

  if (!title) {
    return button;
  }

  return (
    <Tooltip title={title}>
      <span
        style={{
          display: block ? "block" : "inline-flex",
          width: block ? "100%" : undefined,
        }}
      >
        {button}
      </span>
    </Tooltip>
  );
}

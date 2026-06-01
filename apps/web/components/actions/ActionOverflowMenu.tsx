"use client";

import { Button, Dropdown, Modal, Tooltip } from "antd";
import type { ButtonProps, MenuProps } from "antd";
import { MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";

export type ActionOverflowConfirm = {
  title: ReactNode;
  description?: ReactNode;
  okText?: ReactNode;
  cancelText?: ReactNode;
};

export type ActionOverflowItem = {
  confirm?: ActionOverflowConfirm;
  danger?: boolean;
  disabled?: boolean;
  disabledReason?: ReactNode;
  icon?: ReactNode;
  key: string;
  label: ReactNode;
  onClick?: () => void | Promise<void>;
};

export type ActionOverflowMenuProps = {
  ariaLabel: string;
  items: ActionOverflowItem[];
  onSelect?: (key: string) => void;
  size?: ButtonProps["size"];
  stopPropagation?: boolean;
  tooltip?: ReactNode;
  touch?: boolean;
};

export function ActionOverflowMenu({
  ariaLabel,
  items,
  onSelect,
  size,
  stopPropagation = false,
  tooltip,
  touch = false,
}: ActionOverflowMenuProps) {
  if (!items.length) {
    return null;
  }

  const menuItems: MenuProps["items"] = items.map((item) => ({
    danger: item.danger,
    disabled: item.disabled,
    icon: item.icon,
    key: item.key,
    label: item.disabledReason ? (
      <Tooltip title={item.disabledReason}>
        <span>{item.label}</span>
      </Tooltip>
    ) : (
      item.label
    ),
  }));

  return (
    <Dropdown
      menu={{
        items: menuItems,
        onClick: (info) => {
          info.domEvent.stopPropagation();
          const item = items.find((candidate) => candidate.key === info.key);
          if (!item || item.disabled) {
            return;
          }
          const selectItem = () => {
            const result = item.onClick?.();
            onSelect?.(String(info.key));
            return result;
          };
          if (item.confirm) {
            Modal.confirm({
              cancelText: item.confirm.cancelText,
              content: item.confirm.description,
              okButtonProps: { danger: item.danger },
              okText: item.confirm.okText,
              onOk: selectItem,
              title: item.confirm.title,
            });
            return;
          }
          void selectItem();
        },
      }}
      trigger={["click"]}
    >
      <span
        onClick={(event) => {
          if (stopPropagation) {
            event.stopPropagation();
          }
        }}
        style={{ display: "inline-flex" }}
      >
        <Tooltip title={tooltip}>
          <Button
            aria-label={ariaLabel}
            icon={<MoreHorizontal size={15} />}
            size={size ?? (touch ? "large" : undefined)}
            style={touch ? { minHeight: 44, minWidth: 44 } : undefined}
          />
        </Tooltip>
      </span>
    </Dropdown>
  );
}

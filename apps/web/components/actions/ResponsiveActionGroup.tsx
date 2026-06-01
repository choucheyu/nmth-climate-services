"use client";

import { Space } from "antd";
import type { ButtonProps } from "antd";
import type { Permission } from "@nmth/shared";
import type { ReactNode } from "react";
import { useResponsiveMode, type ResponsiveMode } from "../../lib/responsive";
import { ActionIconButton } from "./ActionIconButton";
import { ActionOverflowMenu } from "./ActionOverflowMenu";
import { ActionTextButton } from "./ActionTextButton";
import { DangerActionButton } from "./DangerActionButton";
import { DrawerActionFooter } from "./DrawerActionFooter";
import {
  isVisuallyDangerAction,
  partitionResponsiveActions,
  validateResponsiveActions,
  type ResponsiveAction,
  type ResponsiveActionMobileCardBehavior,
  type ResponsiveActionSurface,
} from "./responsiveActionGroupModel";

export type {
  ResponsiveAction,
  ResponsiveActionMobileCardBehavior,
  ResponsiveActionSurface,
};

export type ResponsiveActionGroupProps = {
  actions: ResponsiveAction[];
  surface: ResponsiveActionSurface;
  mode?: ResponsiveMode;
  permissions?: readonly Permission[];
  ariaLabel?: string;
  maxVisibleDesktop?: number;
  maxVisibleTablet?: number;
  maxVisibleCompact?: number;
  maxVisibleMobile?: number;
  maxVisibleDrawer?: number;
  mobileCardBehavior?: ResponsiveActionMobileCardBehavior;
  touch?: boolean;
  stopPropagation?: boolean;
  overflowLabel?: ReactNode;
  overflowAriaLabel?: string;
};

type ResolvedResponsiveActionGroupProps = Omit<
  ResponsiveActionGroupProps,
  "mode"
> & {
  mode: ResponsiveMode;
};

function actionText(action: ResponsiveAction) {
  if (typeof action.label === "string") {
    return action.label;
  }
  return action.ariaLabel ?? action.key;
}

function runAction(action: ResponsiveAction) {
  void action.onClick?.();
}

function isIconPresentation(surface: ResponsiveActionSurface) {
  return surface === "row" || surface === "tool" || surface === "global";
}

function defaultTouch(surface: ResponsiveActionSurface, mode: ResponsiveMode) {
  if (surface === "row") {
    return mode !== "desktop";
  }
  return surface !== "command";
}

function defaultStopPropagation(surface: ResponsiveActionSurface) {
  return (
    surface === "row" ||
    surface === "mobile-card" ||
    surface === "compact-list"
  );
}

function renderAction({
  action,
  defaultButtonType,
  iconOnly,
  stopPropagation,
  touch,
}: {
  action: ResponsiveAction;
  defaultButtonType?: ButtonProps["type"];
  iconOnly: boolean;
  stopPropagation: boolean;
  touch: boolean;
}) {
  const ariaLabel = action.ariaLabel ?? actionText(action);
  const buttonType = action.buttonType ?? defaultButtonType;
  const shouldStopPropagation = action.stopPropagation ?? stopPropagation;
  const tooltip = iconOnly ? action.label : undefined;

  if (action.confirm) {
    return (
      <DangerActionButton
        key={action.key}
        ariaLabel={ariaLabel}
        cancelText={action.confirm.cancelText}
        danger={isVisuallyDangerAction(action)}
        description={action.confirm.description}
        disabled={action.disabled}
        disabledReason={action.disabledReason}
        icon={action.icon}
        okText={action.confirm.okText}
        onConfirm={() => runAction(action)}
        stopPropagation={shouldStopPropagation}
        title={action.confirm.title}
        tooltip={tooltip}
        touch={touch}
        type={buttonType}
      >
        {iconOnly ? undefined : action.label}
      </DangerActionButton>
    );
  }

  if (iconOnly && action.icon) {
    return (
      <ActionIconButton
        key={action.key}
        ariaLabel={ariaLabel}
        disabled={action.disabled}
        disabledReason={action.disabledReason}
        icon={action.icon}
        onClick={() => runAction(action)}
        stopPropagation={shouldStopPropagation}
        tooltip={action.label}
        touch={touch}
        type={buttonType}
      />
    );
  }

  return (
    <ActionTextButton
      key={action.key}
      ariaLabel={ariaLabel}
      danger={isVisuallyDangerAction(action)}
      disabled={action.disabled}
      disabledReason={action.disabledReason}
      icon={action.icon}
      onClick={() => runAction(action)}
      stopPropagation={shouldStopPropagation}
      touch={touch}
      type={buttonType}
    >
      {action.label}
    </ActionTextButton>
  );
}

function overflowMenu({
  actions,
  ariaLabel,
  overflowAriaLabel,
  overflowLabel,
  resolvedStopPropagation,
  resolvedTouch,
}: {
  actions: ResponsiveAction[];
  ariaLabel?: string;
  overflowAriaLabel?: string;
  overflowLabel?: ReactNode;
  resolvedStopPropagation: boolean;
  resolvedTouch: boolean;
}) {
  if (!actions.length) {
    return null;
  }
  return (
    <ActionOverflowMenu
      ariaLabel={
        overflowAriaLabel ??
        (typeof overflowLabel === "string" ? overflowLabel : undefined) ??
        ariaLabel ??
        "Actions"
      }
      items={actions.map((action) => ({
        confirm: action.confirm,
        danger: isVisuallyDangerAction(action),
        disabled: action.disabled,
        disabledReason: action.disabledReason,
        icon: action.icon,
        key: action.key,
        label: action.label,
        onClick: () => runAction(action),
      }))}
      stopPropagation={resolvedStopPropagation}
      tooltip={overflowLabel ?? ariaLabel}
      touch={resolvedTouch}
    />
  );
}

function ResolvedResponsiveActionGroup({
  actions,
  ariaLabel,
  maxVisibleDrawer,
  maxVisibleCompact,
  maxVisibleDesktop,
  maxVisibleMobile,
  maxVisibleTablet,
  mobileCardBehavior,
  mode,
  overflowAriaLabel,
  overflowLabel,
  permissions,
  stopPropagation,
  surface,
  touch,
}: ResolvedResponsiveActionGroupProps) {
  if (process.env.NODE_ENV !== "production") {
    const issues = validateResponsiveActions(actions);
    if (issues.length) {
      throw new Error(issues.map((issue) => issue.message).join("\n"));
    }
  }

  const partition = partitionResponsiveActions(actions, {
    mode,
    surface,
    grantedPermissions: permissions,
    maxVisibleCompact,
    maxVisibleDesktop,
    maxVisibleDrawer,
    maxVisibleMobile,
    maxVisibleTablet,
    mobileCardBehavior,
  });
  const resolvedTouch = touch ?? defaultTouch(surface, mode);
  const resolvedStopPropagation =
    stopPropagation ?? defaultStopPropagation(surface);
  const iconOnly = isIconPresentation(surface);

  if (surface === "drawer-footer") {
    const overflow = overflowMenu({
      actions: partition.overflow,
      ariaLabel,
      overflowAriaLabel,
      overflowLabel,
      resolvedStopPropagation,
      resolvedTouch,
    });
    const drawerSecondary: ReactNode[] = partition.drawerSecondary.map(
      (action) =>
        renderAction({
          action,
          iconOnly: false,
          stopPropagation: resolvedStopPropagation,
          touch: resolvedTouch,
        }),
    );
    if (overflow) {
      drawerSecondary.push(overflow);
    }
    return (
      <DrawerActionFooter
        secondary={drawerSecondary}
        danger={partition.drawerDanger.map((action) =>
          renderAction({
            action,
            iconOnly: false,
            stopPropagation: resolvedStopPropagation,
            touch: resolvedTouch,
          }),
        )}
        primary={partition.drawerPrimary.map((action) =>
          renderAction({
            action,
            defaultButtonType: "primary",
            iconOnly: false,
            stopPropagation: resolvedStopPropagation,
            touch: resolvedTouch,
          }),
        )}
      />
    );
  }

  const visibleNonDanger = partition.visible
    .filter((action) => !isVisuallyDangerAction(action))
    .map((action) =>
      renderAction({
        action,
        iconOnly,
        stopPropagation: resolvedStopPropagation,
        touch: resolvedTouch,
      }),
    );
  const visibleDanger = partition.visible
    .filter(isVisuallyDangerAction)
    .map((action) =>
      renderAction({
        action,
        iconOnly,
        stopPropagation: resolvedStopPropagation,
        touch: resolvedTouch,
      }),
    );
  const overflow = overflowMenu({
    actions: partition.overflow,
    ariaLabel,
    overflowAriaLabel,
    overflowLabel,
    resolvedStopPropagation,
    resolvedTouch,
  });

  if (!visibleNonDanger.length && !visibleDanger.length && !overflow) {
    return null;
  }

  return (
    <Space size={6} wrap>
      {visibleNonDanger}
      {overflow}
      {visibleDanger}
    </Space>
  );
}

function ResponsiveActionGroupWithFallback(
  props: Omit<ResponsiveActionGroupProps, "mode">,
) {
  const { mode } = useResponsiveMode();
  return <ResolvedResponsiveActionGroup {...props} mode={mode} />;
}

export function ResponsiveActionGroup({
  mode,
  ...props
}: ResponsiveActionGroupProps) {
  if (mode) {
    return <ResolvedResponsiveActionGroup {...props} mode={mode} />;
  }
  return <ResponsiveActionGroupWithFallback {...props} />;
}

import type { ButtonProps } from "antd";
import type { Permission } from "@nmth/shared";
import type { ReactNode } from "react";
import type { ResponsiveMode } from "../../lib/responsive";

export type ResponsiveActionKind =
  | "row-primary"
  | "row-secondary"
  | "overflow"
  | "danger"
  | "state-change"
  | "drawer-primary"
  | "drawer-secondary"
  | "drawer-danger"
  | "command"
  | "tool"
  | "global";

export type ResponsiveActionSurface =
  | "row"
  | "mobile-card"
  | "compact-list"
  | "drawer-footer"
  | "command"
  | "tool"
  | "global";

export type ResponsiveActionConfirm = {
  title: ReactNode;
  description?: ReactNode;
  okText?: ReactNode;
  cancelText?: ReactNode;
};

export type ResponsiveActionFrequency = "high" | "normal" | "low";

export type ResponsiveActionRisk =
  | "low"
  | "state-change"
  | "destructive"
  | "high";

export type ResponsiveActionMobileCardBehavior =
  | "detail-heavy"
  | "compact-actions";

export type ResponsiveActionVisibility = {
  desktop?: boolean;
  tablet?: boolean;
  mobile?: boolean;
  drawer?: boolean;
};

export type ResponsiveAction = {
  key: string;
  label: ReactNode;
  ariaLabel?: string;
  icon?: ReactNode;
  kind: ResponsiveActionKind;
  onClick?: () => void | Promise<void>;
  disabled?: boolean;
  disabledReason?: ReactNode;
  confirm?: ResponsiveActionConfirm;
  permission?: Permission | Permission[];
  permissionMode?: "any" | "all";
  frequency?: ResponsiveActionFrequency;
  risk?: ResponsiveActionRisk;
  reversible?: boolean;
  visible?: boolean;
  visibility?: ResponsiveActionVisibility;
  buttonType?: ButtonProps["type"];
  danger?: boolean;
  stopPropagation?: boolean;
};

export type ResponsiveActionPartitionContext = {
  mode: ResponsiveMode;
  surface: ResponsiveActionSurface;
  grantedPermissions?: readonly Permission[];
  maxVisibleDesktop?: number;
  maxVisibleTablet?: number;
  maxVisibleCompact?: number;
  maxVisibleMobile?: number;
  maxVisibleDrawer?: number;
  mobileCardBehavior?: ResponsiveActionMobileCardBehavior;
};

export type ResponsiveActionPartition = {
  visible: ResponsiveAction[];
  overflow: ResponsiveAction[];
  danger: ResponsiveAction[];
  drawerSecondary: ResponsiveAction[];
  drawerDanger: ResponsiveAction[];
  drawerPrimary: ResponsiveAction[];
};

export type ResponsiveActionValidationIssue = {
  actionKey: string;
  message: string;
};

const DANGER_KINDS = new Set<ResponsiveActionKind>([
  "danger",
  "drawer-danger",
]);

const DRAWER_PRIMARY_KINDS = new Set<ResponsiveActionKind>([
  "drawer-primary",
  "row-primary",
]);

const DRAWER_SECONDARY_KINDS = new Set<ResponsiveActionKind>([
  "drawer-secondary",
  "row-secondary",
  "overflow",
  "state-change",
]);

const DIRECT_ACTION_CAP = 3;

const RISK_WEIGHT: Record<ResponsiveActionRisk, number> = {
  low: 0,
  "state-change": 1,
  destructive: 2,
  high: 3,
};

const FREQUENCY_WEIGHT: Record<ResponsiveActionFrequency, number> = {
  high: 0,
  normal: 10,
  low: 30,
};

function modeVisibilityKey(
  mode: ResponsiveMode,
): "desktop" | "tablet" | "mobile" {
  if (mode === "phone") {
    return "mobile";
  }
  if (mode === "tabletPortrait" || mode === "tabletLandscape") {
    return "tablet";
  }
  return "desktop";
}

function permissionList(permission: Permission | Permission[] | undefined) {
  if (!permission) {
    return [];
  }
  return Array.isArray(permission) ? permission : [permission];
}

function hasRequiredPermissions(
  action: ResponsiveAction,
  grantedPermissions: readonly Permission[] | undefined,
) {
  const required = permissionList(action.permission);
  if (!required.length || !grantedPermissions) {
    return true;
  }
  const granted = new Set(grantedPermissions);
  if (action.permissionMode === "all") {
    return required.every((permission) => granted.has(permission));
  }
  return required.some((permission) => granted.has(permission));
}

function isVisibleForMode(
  action: ResponsiveAction,
  context: ResponsiveActionPartitionContext,
) {
  if (action.visible === false) {
    return false;
  }
  if (!hasRequiredPermissions(action, context.grantedPermissions)) {
    return false;
  }
  const visibility = action.visibility;
  if (!visibility) {
    return true;
  }
  if (
    context.surface === "drawer-footer" &&
    visibility.drawer !== undefined
  ) {
    return visibility.drawer;
  }
  const key = modeVisibilityKey(context.mode);
  return visibility[key] ?? true;
}

export function isDangerAction(action: ResponsiveAction) {
  return DANGER_KINDS.has(action.kind);
}

export function responsiveActionRisk(
  action: ResponsiveAction,
): ResponsiveActionRisk {
  if (action.risk) {
    return action.risk;
  }
  if (isDangerAction(action)) {
    return "destructive";
  }
  if (action.kind === "state-change") {
    return "state-change";
  }
  return "low";
}

export function responsiveActionFrequency(
  action: ResponsiveAction,
): ResponsiveActionFrequency {
  if (action.frequency) {
    return action.frequency;
  }
  if (action.kind === "overflow") {
    return "low";
  }
  if (action.kind === "row-primary" || action.kind === "drawer-primary") {
    return "high";
  }
  return "normal";
}

export function requiresActionConfirmation(action: ResponsiveAction) {
  const risk = responsiveActionRisk(action);
  return (
    isDangerAction(action) ||
    action.danger === true ||
    risk === "destructive" ||
    risk === "high"
  );
}

function isDestructiveOrHighRiskAction(action: ResponsiveAction) {
  const risk = responsiveActionRisk(action);
  return isDangerAction(action) || risk === "destructive" || risk === "high";
}

export function isVisuallyDangerAction(action: ResponsiveAction) {
  return action.danger ?? isDestructiveOrHighRiskAction(action);
}

export function filterResponsiveActions(
  actions: ResponsiveAction[],
  context: ResponsiveActionPartitionContext,
) {
  return actions.filter((action) => isVisibleForMode(action, context));
}

export function validateResponsiveActions(
  actions: ResponsiveAction[],
): ResponsiveActionValidationIssue[] {
  return actions
    .filter(
      (action) =>
        action.visible !== false &&
        requiresActionConfirmation(action) &&
        !action.confirm,
    )
    .map((action) => ({
      actionKey: action.key,
      message: `Danger action "${action.key}" must define confirmation copy.`,
    }));
}

function emptyPartition(): ResponsiveActionPartition {
  return {
    visible: [],
    overflow: [],
    danger: [],
    drawerSecondary: [],
    drawerDanger: [],
    drawerPrimary: [],
  };
}

function visibleLimit(context: ResponsiveActionPartitionContext) {
  if (context.mode === "phone") {
    return context.maxVisibleMobile ?? 0;
  }
  if (context.mode === "tabletPortrait" || context.mode === "tabletLandscape") {
    return context.maxVisibleTablet ?? 1;
  }
  return context.maxVisibleDesktop ?? DIRECT_ACTION_CAP;
}

function compactLimit(context: ResponsiveActionPartitionContext) {
  if (context.mode === "phone") {
    return context.maxVisibleMobile ?? context.maxVisibleCompact ?? 2;
  }
  return context.maxVisibleCompact ?? context.maxVisibleTablet ?? 2;
}

function drawerLimit(context: ResponsiveActionPartitionContext) {
  return context.maxVisibleDrawer ?? DIRECT_ACTION_CAP;
}

function cappedVisibleLimit(limit: number) {
  return Math.max(0, Math.min(limit, DIRECT_ACTION_CAP));
}

function isForcedOverflowAction(action: ResponsiveAction) {
  return (
    action.kind === "overflow" || responsiveActionFrequency(action) === "low"
  );
}

function actionPriority(action: ResponsiveAction, index: number) {
  const risk = responsiveActionRisk(action);
  const irreversiblePenalty =
    (risk === "destructive" || risk === "high") && action.reversible === false
      ? 2
      : 0;
  const kindWeight =
    action.kind === "row-primary" || action.kind === "drawer-primary"
      ? -2
      : action.kind === "row-secondary" || action.kind === "drawer-secondary"
        ? 0
        : action.kind === "state-change"
          ? 1
          : isDangerAction(action)
            ? 2
            : 0;

  return (
    FREQUENCY_WEIGHT[responsiveActionFrequency(action)] +
    RISK_WEIGHT[risk] +
    irreversiblePenalty +
    kindWeight +
    index / 1000
  );
}

function assignDirectGroups(partition: ResponsiveActionPartition) {
  partition.danger = partition.visible.filter(isDangerAction);
  partition.drawerSecondary = partition.visible.filter(
    (action) =>
      !isDangerAction(action) && DRAWER_SECONDARY_KINDS.has(action.kind),
  );
  partition.drawerDanger = partition.visible.filter(isDangerAction);
  partition.drawerPrimary = partition.visible.filter(
    (action) =>
      !isDangerAction(action) && DRAWER_PRIMARY_KINDS.has(action.kind),
  );
  return partition;
}

function partitionVisibleOverflowActions(
  actions: ResponsiveAction[],
  visibleCount: number,
): ResponsiveActionPartition {
  const partition = emptyPartition();
  const limit = cappedVisibleLimit(visibleCount);
  if (limit === 0) {
    partition.overflow = actions;
    return assignDirectGroups(partition);
  }

  const candidates = actions
    .map((action, index) => ({ action, index }))
    .filter(({ action }) => !isForcedOverflowAction(action))
    .sort(
      (left, right) =>
        actionPriority(left.action, left.index) -
        actionPriority(right.action, right.index),
    );
  const visible = candidates.slice(0, limit).map(({ action }) => action);
  const destructiveVisible = visible.filter(isDestructiveOrHighRiskAction);
  if (destructiveVisible.length > 1) {
    const [firstDestructive] = destructiveVisible.sort(
      (left, right) =>
        actionPriority(left, actions.indexOf(left)) -
        actionPriority(right, actions.indexOf(right)),
    );
    const nonCompetingVisible = visible.filter(
      (action) =>
        !isDestructiveOrHighRiskAction(action) || action === firstDestructive,
    );
    const replacements = candidates
      .map(({ action }) => action)
      .filter(
        (action) =>
          !nonCompetingVisible.includes(action) &&
          !isDestructiveOrHighRiskAction(action),
      )
      .slice(0, limit - nonCompetingVisible.length);
    visible.splice(0, visible.length, ...nonCompetingVisible, ...replacements);
  }

  const visibleSet = new Set(visible);
  partition.visible = actions.filter((action) => visibleSet.has(action));
  partition.overflow = actions.filter((action) => !visibleSet.has(action));
  return assignDirectGroups(partition);
}

function partitionRowActions(
  actions: ResponsiveAction[],
  context: ResponsiveActionPartitionContext,
): ResponsiveActionPartition {
  return partitionVisibleOverflowActions(actions, visibleLimit(context));
}

function partitionMobileCardActions(
  actions: ResponsiveAction[],
  context: ResponsiveActionPartitionContext,
): ResponsiveActionPartition {
  if (context.mobileCardBehavior !== "compact-actions") {
    const partition = emptyPartition();
    partition.visible = actions
      .filter(
        (action) =>
          !isDangerAction(action) &&
          !action.confirm &&
          action.kind === "row-primary" &&
          action.visibility?.mobile === true,
      )
      .slice(0, 1);
    return assignDirectGroups(partition);
  }
  return partitionVisibleOverflowActions(actions, compactLimit(context));
}

function partitionCompactListActions(
  actions: ResponsiveAction[],
  context: ResponsiveActionPartitionContext,
): ResponsiveActionPartition {
  return partitionVisibleOverflowActions(actions, compactLimit(context));
}

function partitionDrawerActions(
  actions: ResponsiveAction[],
  context: ResponsiveActionPartitionContext,
): ResponsiveActionPartition {
  const partition = partitionVisibleOverflowActions(
    actions,
    drawerLimit(context),
  );
  partition.drawerSecondary = partition.visible.filter(
    (action) =>
      !isDangerAction(action) && DRAWER_SECONDARY_KINDS.has(action.kind),
  );
  partition.drawerDanger = partition.visible.filter(isDangerAction);
  partition.drawerPrimary = actions.filter(
    (action) =>
      !isDangerAction(action) &&
      DRAWER_PRIMARY_KINDS.has(action.kind) &&
      partition.visible.includes(action),
  );
  return partition;
}

function partitionFlatActions(
  actions: ResponsiveAction[],
): ResponsiveActionPartition {
  const partition = emptyPartition();
  partition.visible = actions.filter((action) => !isDangerAction(action));
  partition.danger = actions.filter(isDangerAction);
  partition.visible = [...partition.visible, ...partition.danger];
  return partition;
}

export function partitionResponsiveActions(
  actions: ResponsiveAction[],
  context: ResponsiveActionPartitionContext,
): ResponsiveActionPartition {
  const filteredActions = filterResponsiveActions(actions, context);

  if (context.surface === "row") {
    return partitionRowActions(filteredActions, context);
  }
  if (context.surface === "mobile-card") {
    return partitionMobileCardActions(filteredActions, context);
  }
  if (context.surface === "compact-list") {
    return partitionCompactListActions(filteredActions, context);
  }
  if (context.surface === "drawer-footer") {
    return partitionDrawerActions(filteredActions, context);
  }
  return partitionFlatActions(filteredActions);
}

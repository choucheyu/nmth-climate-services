import { describe, expect, it } from "vitest";
import {
  partitionResponsiveActions,
  validateResponsiveActions,
  type ResponsiveAction,
} from "./responsiveActionGroupModel";

function keys(actions: ResponsiveAction[]) {
  return actions.map((action) => action.key);
}

describe("responsive action group model", () => {
  it("keeps desktop row high-value actions visible while overflowing lower-frequency actions", () => {
    const actions: ResponsiveAction[] = [
      { key: "edit", label: "Edit", kind: "row-primary", frequency: "high" },
      {
        key: "threshold",
        label: "Threshold",
        kind: "row-secondary",
        frequency: "high",
      },
      {
        key: "maintenance",
        label: "Maintenance",
        kind: "overflow",
        frequency: "low",
      },
      {
        key: "archive",
        label: "Archive",
        kind: "danger",
        frequency: "high",
        risk: "destructive",
        confirm: { title: "Archive" },
      },
    ];

    const partition = partitionResponsiveActions(actions, {
      mode: "desktop",
      surface: "row",
    });

    expect(keys(partition.visible)).toEqual(["edit", "threshold", "archive"]);
    expect(keys(partition.overflow)).toEqual(["maintenance"]);
    expect(keys(partition.danger)).toEqual(["archive"]);
  });

  it("reduces tablet row visible actions before overflow", () => {
    const actions: ResponsiveAction[] = [
      { key: "edit", label: "Edit", kind: "row-primary" },
      { key: "threshold", label: "Threshold", kind: "row-secondary" },
      { key: "maintenance", label: "Maintenance", kind: "overflow" },
    ];

    const partition = partitionResponsiveActions(actions, {
      mode: "tabletLandscape",
      surface: "row",
    });

    expect(keys(partition.visible)).toEqual(["edit"]);
    expect(keys(partition.overflow)).toEqual(["threshold", "maintenance"]);
  });

  it("filters actions by permission requirements", () => {
    const actions: ResponsiveAction[] = [
      {
        key: "edit",
        label: "Edit",
        kind: "row-primary",
        permission: "devices:manage",
      },
      {
        key: "threshold",
        label: "Threshold",
        kind: "row-secondary",
        permission: ["thresholds:manage", "devices:manage"],
      },
      {
        key: "delete",
        label: "Delete",
        kind: "danger",
        permission: ["users:manage", "dangerous:delete"],
        permissionMode: "all",
        confirm: { title: "Delete" },
      },
    ];

    const operatorPartition = partitionResponsiveActions(actions, {
      mode: "desktop",
      surface: "row",
      grantedPermissions: ["thresholds:manage"],
    });
    expect(keys(operatorPartition.visible)).toEqual(["threshold"]);
    expect(keys(operatorPartition.danger)).toEqual([]);

    const superAdminPartition = partitionResponsiveActions(actions, {
      mode: "desktop",
      surface: "row",
      grantedPermissions: ["users:manage", "dangerous:delete"],
    });
    expect(keys(superAdminPartition.danger)).toEqual(["delete"]);
  });

  it("keeps mobile cards summary-first by allowing at most one explicit low-risk action", () => {
    const actions: ResponsiveAction[] = [
      {
        key: "view",
        label: "View",
        kind: "row-primary",
        visibility: { mobile: true },
      },
      { key: "edit", label: "Edit", kind: "row-secondary" },
      {
        key: "archive",
        label: "Archive",
        kind: "danger",
        confirm: { title: "Archive" },
      },
    ];

    const partition = partitionResponsiveActions(actions, {
      mode: "phone",
      surface: "mobile-card",
    });

    expect(keys(partition.visible)).toEqual(["view"]);
    expect(partition.overflow).toEqual([]);
    expect(partition.danger).toEqual([]);
  });

  it("partitions drawer footer decisions into visible actions and overflow", () => {
    const actions: ResponsiveAction[] = [
      { key: "edit", label: "Edit", kind: "row-primary", frequency: "high" },
      {
        key: "threshold",
        label: "Threshold",
        kind: "row-secondary",
        frequency: "high",
      },
      { key: "replace", label: "Replace", kind: "overflow", frequency: "low" },
      {
        key: "archive",
        label: "Archive",
        kind: "danger",
        frequency: "high",
        risk: "destructive",
        confirm: { title: "Archive" },
      },
    ];

    const partition = partitionResponsiveActions(actions, {
      mode: "phone",
      surface: "drawer-footer",
    });

    expect(keys(partition.visible)).toEqual(["edit", "threshold", "archive"]);
    expect(keys(partition.overflow)).toEqual(["replace"]);
    expect(keys(partition.drawerSecondary)).toEqual(["threshold"]);
    expect(keys(partition.drawerDanger)).toEqual(["archive"]);
    expect(keys(partition.drawerPrimary)).toEqual(["edit"]);
  });

  it("supports compact-actions mobile cards with three or fewer high-frequency actions", () => {
    const actions: ResponsiveAction[] = [
      { key: "edit", label: "Edit", kind: "row-primary", frequency: "high" },
      {
        key: "add-unit",
        label: "Add unit",
        kind: "row-secondary",
        frequency: "high",
      },
      {
        key: "archive",
        label: "Archive",
        kind: "danger",
        frequency: "high",
        risk: "destructive",
        confirm: { title: "Archive" },
      },
    ];

    const partition = partitionResponsiveActions(actions, {
      mode: "phone",
      surface: "mobile-card",
      mobileCardBehavior: "compact-actions",
      maxVisibleMobile: 3,
    });

    expect(keys(partition.visible)).toEqual(["edit", "add-unit", "archive"]);
    expect(partition.overflow).toEqual([]);
    expect(keys(partition.danger)).toEqual(["archive"]);
  });

  it("moves more than three mobile-card actions into overflow by priority and risk", () => {
    const actions: ResponsiveAction[] = [
      { key: "view", label: "View", kind: "row-primary", frequency: "high" },
      {
        key: "set-active",
        label: "Set active",
        kind: "state-change",
        frequency: "high",
        risk: "state-change",
        confirm: { title: "Set active" },
      },
      { key: "edit", label: "Edit", kind: "row-secondary", frequency: "high" },
      {
        key: "archive",
        label: "Archive",
        kind: "danger",
        frequency: "high",
        risk: "destructive",
        reversible: false,
        confirm: { title: "Archive" },
      },
    ];

    const partition = partitionResponsiveActions(actions, {
      mode: "phone",
      surface: "mobile-card",
      mobileCardBehavior: "compact-actions",
      maxVisibleMobile: 3,
    });

    expect(keys(partition.visible)).toEqual(["view", "set-active", "edit"]);
    expect(keys(partition.overflow)).toEqual(["archive"]);
  });

  it("requires confirmation when a destructive action is directly visible", () => {
    const actions: ResponsiveAction[] = [
      { key: "edit", label: "Edit", kind: "row-primary", frequency: "high" },
      {
        key: "archive",
        label: "Archive",
        kind: "danger",
        frequency: "high",
        risk: "destructive",
        confirm: { title: "Archive" },
      },
    ];

    const partition = partitionResponsiveActions(actions, {
      mode: "phone",
      surface: "mobile-card",
      mobileCardBehavior: "compact-actions",
      maxVisibleMobile: 3,
    });

    expect(validateResponsiveActions(actions)).toEqual([]);
    expect(keys(partition.visible)).toEqual(["edit", "archive"]);
    expect(keys(partition.danger)).toEqual(["archive"]);
    expect(
      validateResponsiveActions([
        {
          key: "archive",
          label: "Archive",
          kind: "danger",
          frequency: "high",
          risk: "destructive",
        },
      ]),
    ).toEqual([
      {
        actionKey: "archive",
        message: 'Danger action "archive" must define confirmation copy.',
      },
    ]);
  });

  it("filters permissions before visible and overflow partitioning", () => {
    const actions: ResponsiveAction[] = [
      {
        key: "edit",
        label: "Edit",
        kind: "row-primary",
        permission: "exhibitions:manage",
        frequency: "high",
      },
      {
        key: "add-unit",
        label: "Add unit",
        kind: "row-secondary",
        permission: "exhibitions:manage",
        frequency: "high",
      },
      {
        key: "archive",
        label: "Archive",
        kind: "danger",
        permission: "exhibitions:manage",
        frequency: "high",
        risk: "destructive",
        confirm: { title: "Archive" },
      },
      { key: "view", label: "View", kind: "row-primary", frequency: "high" },
    ];

    const partition = partitionResponsiveActions(actions, {
      mode: "phone",
      surface: "mobile-card",
      grantedPermissions: [],
      mobileCardBehavior: "compact-actions",
      maxVisibleMobile: 3,
    });

    expect(keys(partition.visible)).toEqual(["view"]);
    expect(partition.overflow).toEqual([]);
    expect(partition.danger).toEqual([]);
  });

  it("reports danger actions without confirmation copy", () => {
    expect(
      validateResponsiveActions([
        { key: "archive", label: "Archive", kind: "danger" },
        {
          key: "delete",
          label: "Delete",
          kind: "drawer-danger",
          confirm: { title: "Delete" },
        },
      ]),
    ).toEqual([
      {
        actionKey: "archive",
        message: 'Danger action "archive" must define confirmation copy.',
      },
    ]);
  });
});

"use client";

import { Result, Spin } from "antd";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { PERMISSIONS, ROLES, type Permission, type RoleName } from "@nmth/shared";
import { apiFetch } from "./api";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  roles?: string[];
  permissions?: string[];
  accessScope?: {
    dataProfiles?: Array<"DEMO" | "REAL"> | null;
    exhibitionIds?: string[];
    zoneIds?: string[];
  };
};

export const SETTINGS_PERMISSIONS: Permission[] = [
  "system:manage",
  "users:manage",
  "notifications:manage",
  "audit:read",
  "compensation:manage",
  "synthetic:manage",
  "ingest:write"
];

export const APP_NAV_PERMISSION_RULES = [
  { key: "dashboard", any: ["dashboard:read"] },
  { key: "devices", any: ["devices:read"] },
  { key: "exhibitions", any: ["exhibitions:read", "floorplans:read"] },
  { key: "alerts", any: ["alerts:read"] },
  { key: "reports", any: ["reports:read"] },
  { key: "settings", any: SETTINGS_PERMISSIONS }
] satisfies Array<{ key: string; any: Permission[] }>;

export const SETTINGS_TAB_PERMISSION_RULES = [
  { key: "health", any: ["system:manage", "ingest:write"] },
  { key: "users", any: ["users:manage"] },
  { key: "notifications", any: ["notifications:manage"] },
  { key: "audit", any: ["audit:read"] },
  { key: "super-admin", any: ["compensation:manage", "synthetic:manage", "reports:export"] }
] satisfies Array<{ key: string; any: Permission[] }>;

function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

function normalizePermissions(values: string[] | undefined): Permission[] {
  return (values ?? []).filter(isPermission);
}

export function permissionSet(values: string[] | undefined): Set<Permission> {
  return new Set(normalizePermissions(values));
}

export function hasPermission(values: string[] | undefined, permission: Permission): boolean {
  return permissionSet(values).has(permission);
}

export function hasAnyPermission(values: string[] | undefined, permissions: Permission[]): boolean {
  const granted = permissionSet(values);
  return permissions.some((permission) => granted.has(permission));
}

export function hasAllPermissions(values: string[] | undefined, permissions: Permission[]): boolean {
  const granted = permissionSet(values);
  return permissions.every((permission) => granted.has(permission));
}

export function visibleNavKeys(values: string[] | undefined): string[] {
  return APP_NAV_PERMISSION_RULES.filter((item) => hasAnyPermission(values, item.any)).map((item) => item.key);
}

export function visibleSettingsTabKeys(values: string[] | undefined): string[] {
  if (!hasAnyPermission(values, SETTINGS_PERMISSIONS)) {
    return [];
  }
  return SETTINGS_TAB_PERMISSION_RULES.filter((item) => hasAnyPermission(values, item.any)).map((item) => item.key);
}

export function usePermissions() {
  const session = useQuery<AuthUser>({
    queryKey: ["auth", "me"],
    queryFn: () => apiFetch<AuthUser>("/auth/me"),
    retry: false
  });
  const permissions = normalizePermissions(session.data?.permissions);
  return {
    session,
    user: session.data,
    permissions,
    isLoading: session.isLoading,
    hasPermission: (permission: Permission) => hasPermission(session.data?.permissions, permission),
    hasAnyPermission: (items: Permission[]) => hasAnyPermission(session.data?.permissions, items),
    hasAllPermissions: (items: Permission[]) => hasAllPermissions(session.data?.permissions, items)
  };
}

export function PermissionGate({
  permission,
  any,
  all,
  children,
  fallback = null
}: {
  permission?: Permission;
  any?: Permission[];
  all?: Permission[];
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const permissions = usePermissions();
  const allowed =
    (permission ? permissions.hasPermission(permission) : true) &&
    (any?.length ? permissions.hasAnyPermission(any) : true) &&
    (all?.length ? permissions.hasAllPermissions(all) : true);
  return allowed ? <>{children}</> : <>{fallback}</>;
}

export function RequirePermission({
  permission,
  any,
  all,
  children
}: {
  permission?: Permission;
  any?: Permission[];
  all?: Permission[];
  children: ReactNode;
}) {
  const t = useTranslations();
  const permissions = usePermissions();
  const allowed =
    (permission ? permissions.hasPermission(permission) : true) &&
    (any?.length ? permissions.hasAnyPermission(any) : true) &&
    (all?.length ? permissions.hasAllPermissions(all) : true);
  if (permissions.isLoading) {
    return <Spin />;
  }
  if (!allowed) {
    return <Result status="403" title={t("authz.forbiddenTitle")} subTitle={t("authz.forbiddenMessage")} />;
  }
  return <>{children}</>;
}

export function roleLabel(t: (key: string) => string, role: string): string {
  return (ROLES as readonly string[]).includes(role) ? t(`rbac.roles.${role as RoleName}.label`) : role;
}

export function roleDescription(t: (key: string) => string, role: string, fallback?: string | null): string {
  return (ROLES as readonly string[]).includes(role) ? t(`rbac.roles.${role as RoleName}.description`) : (fallback ?? role);
}

export function permissionLabel(t: (key: string) => string, permission: string): string {
  return isPermission(permission) ? t(`rbac.permissions.${permission}.label`) : permission;
}

export function permissionDescription(t: (key: string) => string, permission: string, fallback?: string | null): string {
  return isPermission(permission) ? t(`rbac.permissions.${permission}.description`) : (fallback ?? permission);
}

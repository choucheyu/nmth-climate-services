export const ROLES = [
  "Viewer",
  "Operator",
  "Manager",
  "Admin",
  "SuperAdmin"
] as const;

export type RoleName = (typeof ROLES)[number];

export const PERMISSIONS = [
  "dashboard:read",
  "reports:read",
  "reports:export",
  "alerts:read",
  "alerts:ack",
  "devices:read",
  "devices:manage",
  "exhibitions:read",
  "exhibitions:manage",
  "floorplans:read",
  "floorplans:manage",
  "thresholds:manage",
  "notifications:manage",
  "users:manage",
  "system:manage",
  "audit:read",
  "compensation:manage",
  "synthetic:manage",
  "dangerous:delete",
  "ingest:write"
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<RoleName, Permission[]> = {
  Viewer: ["dashboard:read", "reports:read", "devices:read", "exhibitions:read", "floorplans:read", "alerts:read"],
  Operator: [
    "dashboard:read",
    "reports:read",
    "reports:export",
    "devices:read",
    "exhibitions:read",
    "floorplans:read",
    "alerts:read",
    "alerts:ack"
  ],
  Manager: [
    "dashboard:read",
    "reports:read",
    "reports:export",
    "devices:read",
    "exhibitions:read",
    "exhibitions:manage",
    "floorplans:read",
    "floorplans:manage",
    "thresholds:manage",
    "alerts:read",
    "alerts:ack"
  ],
  Admin: [
    "dashboard:read",
    "reports:read",
    "reports:export",
    "devices:read",
    "devices:manage",
    "exhibitions:read",
    "exhibitions:manage",
    "floorplans:read",
    "floorplans:manage",
    "thresholds:manage",
    "notifications:manage",
    "users:manage",
    "system:manage",
    "audit:read",
    "alerts:read",
    "alerts:ack",
    "ingest:write"
  ],
  SuperAdmin: [
    "dashboard:read",
    "reports:read",
    "reports:export",
    "devices:read",
    "devices:manage",
    "exhibitions:read",
    "exhibitions:manage",
    "floorplans:read",
    "floorplans:manage",
    "thresholds:manage",
    "notifications:manage",
    "users:manage",
    "system:manage",
    "audit:read",
    "alerts:read",
    "alerts:ack",
    "compensation:manage",
    "synthetic:manage",
    "dangerous:delete",
    "ingest:write"
  ]
};

export function roleHasPermission(role: RoleName, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

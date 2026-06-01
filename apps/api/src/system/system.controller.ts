import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Prisma } from "@prisma/client";
import { DATA_PROFILES, PERMISSIONS } from "@nmth/shared";
import * as argon2 from "argon2";
import { z } from "zod";
import { normalizeAccessScope, allowedDataProfilesFor, assertDataProfileAllowed, resolveScopedDataProfile } from "../common/access-scope";
import { writeAuditLog } from "../common/audit.util";
import { CurrentUser, type RequestUser } from "../common/current-user.decorator";
import { DATA_PROFILE_SETTING_KEY, getActiveDataProfile, normalizeDataProfile } from "../common/data-profile";
import { RequirePermissions } from "../common/permissions.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { PrismaService } from "../prisma/prisma.service";

const retentionSchema = z.object({
  name: z.string().min(1),
  rawPacketDays: z.number().int().positive(),
  measurementDays: z.number().int().positive(),
  reportExportDays: z.number().int().positive(),
  enabled: z.boolean().default(true)
});

const dataProfileSchema = z.object({
  profile: z.enum(DATA_PROFILES)
});

const contactSchema = z.object({
  type: z.enum(["line", "discord", "telegram"]),
  identifier: z.string().trim().optional().nullable(),
  label: z.string().trim().optional().nullable(),
  enabled: z.boolean().default(true)
});

const accessScopeSchema = z.object({
  dataProfiles: z.array(z.enum(DATA_PROFILES)).default([]),
  exhibitionIds: z.array(z.string().uuid()).default([]),
  zoneIds: z.array(z.string().uuid()).default([])
});

const preferenceKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9._:-]+$/);

const userPreferenceSchema = z.object({
  value: z.record(z.unknown()).default({})
});

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
  locale: z.string().default("zh-TW"),
  enabled: z.boolean().default(true),
  roleIds: z.array(z.string().uuid()).default([]),
  contacts: z.array(contactSchema).default([]),
  accessScope: accessScopeSchema.optional()
});

const updateUserSchema = createUserSchema
  .omit({ password: true })
  .partial()
  .extend({
    password: z.string().min(8).optional(),
    roleIds: z.array(z.string().uuid()).optional(),
    contacts: z.array(contactSchema).optional(),
    accessScope: accessScopeSchema.optional()
  });

const roleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  permissionKeys: z.array(z.enum(PERMISSIONS)).default([])
});

const DEMO_VIEWER_EMAIL = "viewer@example.local";

@ApiTags("system")
@Controller("system")
export class SystemController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("users")
  @RequirePermissions("users:manage")
  async users(@Query() query: { page?: string; pageSize?: string; search?: string }) {
    const page = query.page ? Number(query.page) : 1;
    const pageSize = query.pageSize ? Number(query.pageSize) : 25;
    const where = query.search
      ? {
          OR: [
            { email: { contains: query.search, mode: "insensitive" as const } },
            { name: { contains: query.search, mode: "insensitive" as const } }
          ]
        }
      : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          name: true,
          locale: true,
          enabled: true,
          accessScope: true,
          createdAt: true,
          updatedAt: true,
          roles: { include: { role: true } },
          notificationContacts: { orderBy: { type: "asc" } }
        },
        orderBy: { email: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.user.count({ where })
    ]);
    return { items, total, page, pageSize };
  }

  @Post("users")
  @RequirePermissions("users:manage")
  async createUser(@Body(new ZodValidationPipe(createUserSchema)) body: z.infer<typeof createUserSchema>, @CurrentUser() actor?: RequestUser) {
    await this.assertAssignableRoles(actor, body.roleIds);
    await this.assertDemoViewerBoundary(body.email.toLowerCase(), body.roleIds, body.accessScope);
    const user = await this.prisma.user.create({
      data: {
        email: body.email.toLowerCase(),
        name: body.name,
        passwordHash: await argon2.hash(body.password),
        locale: body.locale,
        enabled: body.enabled,
        roles: {
          create: body.roleIds.map((roleId) => ({ roleId }))
        },
        accessScope: this.scopeCreate(body.accessScope),
        notificationContacts: {
          create: this.contactCreates(body.contacts)
        }
      },
      select: this.userSelect()
    });
    await writeAuditLog(this.prisma, {
      userId: actor?.id,
      action: "user.create",
      entityType: "user",
      entityId: user.id,
      after: this.redactUserForAudit(user)
    });
    return user;
  }

  @Patch("users/:id")
  @RequirePermissions("users:manage")
  async updateUser(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) body: z.infer<typeof updateUserSchema>,
    @CurrentUser() actor?: RequestUser
  ) {
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id }, select: this.userSelect() });
    const nextEmail = body.email ? body.email.toLowerCase() : before.email.toLowerCase();
    const effectiveRoleIds = body.roleIds ?? before.roles.map((entry) => entry.roleId);
    await this.assertAssignableRoles(actor, effectiveRoleIds);
    await this.assertDemoViewerBoundary(nextEmail, body.roleIds, body.accessScope, before.roles);
    await this.assertUserChangeDoesNotLockout(id, { enabled: body.enabled, roleIds: body.roleIds });
    const after = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          email: body.email ? body.email.toLowerCase() : undefined,
          name: body.name,
          passwordHash: body.password ? await argon2.hash(body.password) : undefined,
          locale: body.locale,
          enabled: body.enabled
        }
      });
      if (body.roleIds) {
        await tx.userRole.deleteMany({ where: { userId: id } });
        if (body.roleIds.length) {
          await tx.userRole.createMany({ data: body.roleIds.map((roleId) => ({ userId: id, roleId })), skipDuplicates: true });
        }
      }
      if (body.contacts) {
        for (const contact of body.contacts) {
          if (!contact.identifier?.trim()) {
            await tx.userNotificationContact.deleteMany({ where: { userId: id, type: contact.type } });
            continue;
          }
          await tx.userNotificationContact.upsert({
            where: { userId_type: { userId: id, type: contact.type } },
            update: {
              identifier: contact.identifier.trim(),
              label: contact.label ?? null,
              enabled: contact.enabled
            },
            create: {
              userId: id,
              type: contact.type,
              identifier: contact.identifier.trim(),
              label: contact.label ?? null,
              enabled: contact.enabled
            }
          });
        }
      }
      if (body.accessScope) {
        await this.replaceUserAccessScope(tx, id, body.accessScope);
      }
      return tx.user.findUniqueOrThrow({ where: { id }, select: this.userSelect() });
    });
    await writeAuditLog(this.prisma, {
      userId: actor?.id,
      action: "user.update",
      entityType: "user",
      entityId: id,
      before: this.redactUserForAudit(before),
      after: this.redactUserForAudit(after)
    });
    return after;
  }

  @Delete("users/:id")
  @RequirePermissions("users:manage", "dangerous:delete")
  async deleteUser(@Param("id") id: string, @CurrentUser() actor?: RequestUser) {
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id }, select: this.userSelect() });
    await this.assertUserChangeDoesNotLockout(id, { deleting: true });
    const deleted = await this.prisma.user.delete({
      where: { id },
      select: { id: true, email: true, name: true }
    });
    await writeAuditLog(this.prisma, {
      userId: actor?.id,
      action: "user.delete",
      entityType: "user",
      entityId: id,
      riskLevel: "high",
      before: this.redactUserForAudit(before),
      after: deleted
    });
    return deleted;
  }

  @Get("roles")
  @RequirePermissions("users:manage")
  roles() {
    return this.prisma.role.findMany({
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { users: true } }
      },
      orderBy: { name: "asc" }
    });
  }

  @Get("permissions")
  @RequirePermissions("users:manage")
  async permissions() {
    const permissions = await this.prisma.permission.findMany({ orderBy: { key: "asc" } });
    const saved = new Map(permissions.map((permission) => [permission.key, permission]));
    return PERMISSIONS.map((key) => saved.get(key) ?? { id: key, key, description: key });
  }

  @Post("roles")
  @RequirePermissions("users:manage")
  async createRole(@Body(new ZodValidationPipe(roleSchema)) body: z.infer<typeof roleSchema>, @CurrentUser() actor?: RequestUser) {
    this.assertRoleDefinitionAllowed(actor, body.name, body.permissionKeys);
    const role = await this.prisma.role.create({
      data: {
        name: body.name,
        description: body.description ?? undefined
      }
    });
    await this.replaceRolePermissions(role.id, body.permissionKeys);
    const created = await this.roleWithPermissions(role.id);
    await writeAuditLog(this.prisma, {
      userId: actor?.id,
      action: "role.create",
      entityType: "role",
      entityId: role.id,
      after: this.roleAuditPayload(created)
    });
    return created;
  }

  @Patch("roles/:id")
  @RequirePermissions("users:manage")
  async updateRole(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(roleSchema.partial())) body: Partial<z.infer<typeof roleSchema>>,
    @CurrentUser() actor?: RequestUser
  ) {
    const before = await this.roleWithPermissions(id);
    this.assertRoleDefinitionAllowed(
      actor,
      body.name ?? before.name,
      body.permissionKeys ?? before.permissions.map((entry) => entry.permission.key)
    );
    await this.assertRoleChangeDoesNotLockout(id, {
      name: body.name,
      permissionKeys: body.permissionKeys,
      deleting: false
    });
    await this.prisma.role.update({
      where: { id },
      data: {
        name: body.name,
        description: body.description
      }
    });
    if (body.permissionKeys) {
      await this.replaceRolePermissions(id, body.permissionKeys);
    }
    const after = await this.roleWithPermissions(id);
    await writeAuditLog(this.prisma, {
      userId: actor?.id,
      action: "role.update",
      entityType: "role",
      entityId: id,
      before: this.roleAuditPayload(before),
      after: this.roleAuditPayload(after)
    });
    return after;
  }

  @Delete("roles/:id")
  @RequirePermissions("users:manage", "dangerous:delete")
  async deleteRole(@Param("id") id: string, @CurrentUser() actor?: RequestUser) {
    const before = await this.roleWithPermissions(id);
    await this.assertRoleChangeDoesNotLockout(id, { deleting: true });
    const deleted = await this.prisma.role.delete({
      where: { id },
      select: { id: true, name: true, description: true }
    });
    await writeAuditLog(this.prisma, {
      userId: actor?.id,
      action: "role.delete",
      entityType: "role",
      entityId: id,
      riskLevel: "high",
      before: this.roleAuditPayload(before),
      after: deleted
    });
    return deleted;
  }

  @Get("measurement-adjustments")
  @RequirePermissions("compensation:manage")
  measurementAdjustments(@Query() query: { type?: string; page?: string; pageSize?: string }) {
    const page = query.page ? Number(query.page) : 1;
    const pageSize = query.pageSize ? Number(query.pageSize) : 25;
    return this.prisma.measurementAdjustment.findMany({
      where: { type: query.type },
      include: {
        measurements: {
          select: { id: true, measuredAt: true, source: true, device: { select: { deviceName: true, displayName: true } } },
          orderBy: { measuredAt: "desc" },
          take: 5
        }
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize
    });
  }

  @Get("settings")
  @RequirePermissions("system:manage")
  settings() {
    return this.prisma.systemSetting.findMany({ orderBy: { key: "asc" } });
  }

  @Get("data-profile")
  @RequirePermissions("dashboard:read")
  async dataProfile(@CurrentUser() user?: RequestUser) {
    const profile = await resolveScopedDataProfile(this.prisma, user);
    return { profile, profiles: allowedDataProfilesFor(user) ?? DATA_PROFILES };
  }

  @Post("data-profile")
  @RequirePermissions("system:manage")
  async setDataProfile(
    @Body(new ZodValidationPipe(dataProfileSchema)) body: z.infer<typeof dataProfileSchema>,
    @CurrentUser() user?: RequestUser
  ) {
    const profile = normalizeDataProfile(body.profile);
    assertDataProfileAllowed(user, profile);
    const before = await getActiveDataProfile(this.prisma);
    const setting = await this.prisma.systemSetting.upsert({
      where: { key: DATA_PROFILE_SETTING_KEY },
      update: { value: { profile }, updatedByUserId: user?.id },
      create: { key: DATA_PROFILE_SETTING_KEY, value: { profile }, updatedByUserId: user?.id }
    });
    await writeAuditLog(this.prisma, {
      userId: user?.id,
      action: "system.data_profile.switch",
      entityType: "system_setting",
      entityId: setting.id,
      riskLevel: "high",
      before: { profile: before },
      after: { profile }
    });
    return { profile, setting };
  }

  @Get("user-preferences/:key")
  async userPreference(@Param("key") key: string, @CurrentUser() user?: RequestUser) {
    this.assertAuthenticatedActor(user);
    const normalizedKey = this.normalizePreferenceKey(key);
    const preference = await this.prisma.userPreference.findUnique({
      where: { userId_key: { userId: user.id, key: normalizedKey } }
    });
    return { key: normalizedKey, value: preference?.value ?? null, updatedAt: preference?.updatedAt ?? null };
  }

  @Put("user-preferences/:key")
  async upsertUserPreference(
    @Param("key") key: string,
    @Body(new ZodValidationPipe(userPreferenceSchema)) body: z.infer<typeof userPreferenceSchema>,
    @CurrentUser() user?: RequestUser
  ) {
    this.assertAuthenticatedActor(user);
    const normalizedKey = this.normalizePreferenceKey(key);
    const preference = await this.prisma.userPreference.upsert({
      where: { userId_key: { userId: user.id, key: normalizedKey } },
      update: { value: body.value as Prisma.InputJsonValue },
      create: { userId: user.id, key: normalizedKey, value: body.value as Prisma.InputJsonValue }
    });
    return { key: preference.key, value: preference.value, updatedAt: preference.updatedAt };
  }

  @Delete("user-preferences/:key")
  async deleteUserPreference(@Param("key") key: string, @CurrentUser() user?: RequestUser) {
    this.assertAuthenticatedActor(user);
    const normalizedKey = this.normalizePreferenceKey(key);
    await this.prisma.userPreference.deleteMany({ where: { userId: user.id, key: normalizedKey } });
    return { key: normalizedKey, ok: true };
  }

  @Post("settings")
  @RequirePermissions("system:manage")
  async upsertSetting(@Body() body: { key: string; value: unknown }, @CurrentUser() user?: RequestUser) {
    const before = await this.prisma.systemSetting.findUnique({ where: { key: body.key } });
    const setting = await this.prisma.systemSetting.upsert({
      where: { key: body.key },
      update: { value: body.value as object, updatedByUserId: user?.id },
      create: { key: body.key, value: body.value as object, updatedByUserId: user?.id }
    });
    await writeAuditLog(this.prisma, {
      userId: user?.id,
      action: "system.setting.upsert",
      entityType: "system_setting",
      entityId: setting.id,
      before,
      after: setting
    });
    return setting;
  }

  @Get("retention-policies")
  @RequirePermissions("system:manage")
  retentionPolicies() {
    return this.prisma.dataRetentionPolicy.findMany({ orderBy: { createdAt: "desc" } });
  }

  @Post("retention-policies")
  @RequirePermissions("system:manage")
  async createRetentionPolicy(@Body(new ZodValidationPipe(retentionSchema)) body: z.infer<typeof retentionSchema>, @CurrentUser() user?: RequestUser) {
    const policy = await this.prisma.dataRetentionPolicy.create({ data: body });
    await writeAuditLog(this.prisma, {
      userId: user?.id,
      action: "retention_policy.create",
      entityType: "data_retention_policy",
      entityId: policy.id,
      after: policy
    });
    return policy;
  }

  @Post("backup-jobs")
  @RequirePermissions("system:manage")
  async createBackupJob(@Body() body: { type?: string; target?: string }, @CurrentUser() user?: RequestUser) {
    const job = await this.prisma.backupJob.create({
      data: {
        type: body.type ?? "db_dump",
        status: "queued",
        target: body.target,
        metadata: {
          note: "Skeleton job. Production deployment should wire this to pg_dump, object storage, and retention automation."
        }
      }
    });
    await writeAuditLog(this.prisma, {
      userId: user?.id,
      action: "backup_job.create",
      entityType: "backup_job",
      entityId: job.id,
      riskLevel: "high",
      after: job
    });
    return job;
  }

  private userSelect() {
    return {
      id: true,
      email: true,
      name: true,
      locale: true,
      enabled: true,
      accessScope: true,
      createdAt: true,
      updatedAt: true,
      roles: { include: { role: true } },
      notificationContacts: { orderBy: { type: "asc" as const } }
    };
  }

  private contactCreates(contacts: Array<z.infer<typeof contactSchema>>) {
    return contacts
      .filter((contact) => Boolean(contact.identifier?.trim()))
      .map((contact) => ({
        type: contact.type,
        identifier: contact.identifier!.trim(),
        label: contact.label ?? null,
        enabled: contact.enabled
      }));
  }

  private scopeCreate(scope: z.infer<typeof accessScopeSchema> | undefined) {
    const data = this.scopeData(scope);
    return data ? { create: data } : undefined;
  }

  private scopeData(scope: z.infer<typeof accessScopeSchema> | undefined) {
    if (!scope) {
      return undefined;
    }
    const normalized = normalizeAccessScope(scope);
    if (!normalized.dataProfiles?.length && !normalized.exhibitionIds.length && !normalized.zoneIds.length) {
      return undefined;
    }
    return {
      allowedDataProfiles: normalized.dataProfiles ?? [],
      exhibitionIds: normalized.exhibitionIds,
      zoneIds: normalized.zoneIds
    };
  }

  private async replaceUserAccessScope(
    tx: Prisma.TransactionClient,
    userId: string,
    scope: z.infer<typeof accessScopeSchema>
  ) {
    const data = this.scopeData(scope);
    if (!data) {
      await tx.userAccessScope.deleteMany({ where: { userId } });
      return;
    }
    await tx.userAccessScope.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data }
    });
  }

  private async assertDemoViewerBoundary(
    email: string,
    roleIds?: string[],
    accessScope?: z.infer<typeof accessScopeSchema>,
    currentRoles?: Array<{ role: { id: string; name: string } }>
  ) {
    if (email !== DEMO_VIEWER_EMAIL) {
      return;
    }

    const viewerRole = await this.prisma.role.findUniqueOrThrow({ where: { name: "Viewer" } });
    const effectiveRoleIds = roleIds ?? currentRoles?.map((entry) => entry.role.id) ?? [];
    if (effectiveRoleIds.length !== 1 || effectiveRoleIds[0] !== viewerRole.id) {
      throw new BadRequestException("Demo Viewer must keep the Viewer role only.");
    }

    if (!accessScope) {
      return;
    }

    const normalized = normalizeAccessScope(accessScope);
    const isDemoOnly =
      normalized.dataProfiles?.length === 1 &&
      normalized.dataProfiles[0] === "DEMO" &&
      normalized.exhibitionIds.length === 0 &&
      normalized.zoneIds.length === 0;
    if (!isDemoOnly) {
      throw new BadRequestException("Demo Viewer must stay limited to DEMO data only.");
    }
  }

  private async assertAssignableRoles(actor: RequestUser | undefined, roleIds: string[] | undefined) {
    this.assertAuthenticatedActor(actor);
    if (!roleIds?.length || this.isSuperAdminActor(actor)) {
      return;
    }

    const uniqueRoleIds = Array.from(new Set(roleIds));
    const roles = await this.prisma.role.findMany({
      where: { id: { in: uniqueRoleIds } },
      include: { permissions: { include: { permission: true } } }
    });
    if (roles.length !== uniqueRoleIds.length) {
      throw new BadRequestException("Unknown role assignment.");
    }

    const actorPermissions = new Set(actor.permissions);
    for (const role of roles) {
      if (role.name === "SuperAdmin") {
        throw new ForbiddenException("Only SuperAdmin can assign the SuperAdmin role.");
      }
      const missingPermission = role.permissions.find((entry) => !actorPermissions.has(entry.permission.key as (typeof PERMISSIONS)[number]));
      if (missingPermission) {
        throw new ForbiddenException("Cannot assign a role with permissions the actor does not have.");
      }
    }
  }

  private assertRoleDefinitionAllowed(actor: RequestUser | undefined, roleName: string, permissionKeys: string[]) {
    this.assertAuthenticatedActor(actor);
    if (this.isSuperAdminActor(actor)) {
      return;
    }
    if (roleName === "SuperAdmin") {
      throw new ForbiddenException("Only SuperAdmin can create or modify the SuperAdmin role.");
    }

    const actorPermissions = new Set(actor.permissions);
    const missingPermission = permissionKeys.find((permission) => !actorPermissions.has(permission as (typeof PERMISSIONS)[number]));
    if (missingPermission) {
      throw new ForbiddenException("Cannot grant permissions the actor does not have.");
    }
  }

  private assertAuthenticatedActor(actor: RequestUser | undefined): asserts actor is RequestUser {
    if (!actor) {
      throw new ForbiddenException("Authenticated actor is required.");
    }
  }

  private normalizePreferenceKey(key: string) {
    const parsed = preferenceKeySchema.safeParse(key);
    if (!parsed.success) {
      throw new BadRequestException("Invalid preference key.");
    }
    return parsed.data;
  }

  private isSuperAdminActor(actor: RequestUser): boolean {
    return actor.roles.includes("SuperAdmin");
  }

  private redactUserForAudit(user: unknown) {
    const value = user && typeof user === "object" ? { ...(user as Record<string, unknown>) } : user;
    if (value && typeof value === "object") {
      delete (value as Record<string, unknown>).passwordHash;
      delete (value as Record<string, unknown>).notificationContacts;
    }
    return value;
  }

  private roleAuditPayload(role: Awaited<ReturnType<SystemController["roleWithPermissions"]>>) {
    return {
      id: role.id,
      name: role.name,
      description: role.description,
      permissionKeys: role.permissions.map((entry) => entry.permission.key),
      userCount: role._count.users
    };
  }

  private async assertUserChangeDoesNotLockout(
    userId: string,
    next: { enabled?: boolean; roleIds?: string[]; deleting?: boolean }
  ) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        roles: {
          include: {
            role: {
              include: { permissions: { include: { permission: true } } }
            }
          }
        }
      }
    });
    const nextEnabled = next.deleting ? false : (next.enabled ?? user.enabled);
    const currentRoleIds = user.roles.map((entry) => entry.roleId);
    const nextRoleIds = next.roleIds ?? currentRoleIds;
    const nextRoles = nextRoleIds.length
      ? await this.prisma.role.findMany({
          where: { id: { in: nextRoleIds } },
          include: { permissions: { include: { permission: true } } }
        })
      : [];
    const targetWillBeSuperAdmin = nextEnabled && nextRoles.some((role) => role.name === "SuperAdmin");
    const targetWillHaveDangerousDelete =
      nextEnabled && nextRoles.some((role) => role.permissions.some((entry) => entry.permission.key === "dangerous:delete"));
    const [otherSuperAdmins, otherDangerousDeleteUsers] = await Promise.all([
      this.prisma.user.count({
        where: { id: { not: userId }, enabled: true, roles: { some: { role: { name: "SuperAdmin" } } } }
      }),
      this.prisma.user.count({
        where: {
          id: { not: userId },
          enabled: true,
          roles: { some: { role: { permissions: { some: { permission: { key: "dangerous:delete" } } } } } }
        }
      })
    ]);
    if (!targetWillBeSuperAdmin && otherSuperAdmins === 0) {
      throw new BadRequestException("At least one enabled SuperAdmin must remain.");
    }
    if (!targetWillHaveDangerousDelete && otherDangerousDeleteUsers === 0) {
      throw new BadRequestException("At least one enabled dangerous-delete operator must remain.");
    }
  }

  private async assertRoleChangeDoesNotLockout(
    roleId: string,
    next: { name?: string; permissionKeys?: string[]; deleting?: boolean }
  ) {
    const role = await this.prisma.role.findUniqueOrThrow({
      where: { id: roleId },
      include: {
        users: { include: { user: { select: { id: true, enabled: true } } } },
        permissions: { include: { permission: true } }
      }
    });
    const affectsEnabledUsers = role.users.some((entry) => entry.user.enabled);
    if (!affectsEnabledUsers) {
      return;
    }
    const nextName = next.deleting ? null : (next.name ?? role.name);
    const nextPermissionKeys = next.deleting
      ? []
      : (next.permissionKeys ?? role.permissions.map((entry) => entry.permission.key));
    const roleWillBeSuperAdmin = nextName === "SuperAdmin";
    const roleWillHaveDangerousDelete = nextPermissionKeys.includes("dangerous:delete");
    const [otherSuperAdmins, otherDangerousDeleteUsers] = await Promise.all([
      this.prisma.user.count({
        where: {
          enabled: true,
          roles: { some: { roleId: { not: roleId }, role: { name: "SuperAdmin" } } }
        }
      }),
      this.prisma.user.count({
        where: {
          enabled: true,
          roles: {
            some: {
              roleId: { not: roleId },
              role: { permissions: { some: { permission: { key: "dangerous:delete" } } } }
            }
          }
        }
      })
    ]);
    if (!roleWillBeSuperAdmin && role.name === "SuperAdmin" && otherSuperAdmins === 0) {
      throw new BadRequestException("At least one enabled SuperAdmin must remain.");
    }
    if (!roleWillHaveDangerousDelete && role.permissions.some((entry) => entry.permission.key === "dangerous:delete") && otherDangerousDeleteUsers === 0) {
      throw new BadRequestException("At least one enabled dangerous-delete operator must remain.");
    }
  }

  private async replaceRolePermissions(roleId: string, permissionKeys: Array<(typeof PERMISSIONS)[number]>) {
    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      for (const key of permissionKeys) {
        const permission = await tx.permission.upsert({
          where: { key },
          update: { description: key },
          create: { key, description: key }
        });
        await tx.rolePermission.create({ data: { roleId, permissionId: permission.id } });
      }
    });
  }

  private roleWithPermissions(id: string) {
    return this.prisma.role.findUniqueOrThrow({
      where: { id },
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { users: true } }
      }
    });
  }
}

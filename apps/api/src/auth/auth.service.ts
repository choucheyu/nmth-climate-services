import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import * as argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";
import { ROLE_PERMISSIONS, type Permission } from "@nmth/shared";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestUser } from "../common/current-user.decorator";
import { writeAuditLog } from "../common/audit.util";
import { normalizeAccessScope } from "../common/access-scope";

const userInclude = Prisma.validator<Prisma.UserInclude>()({
  accessScope: true,
  roles: {
    include: {
      role: {
        include: {
          permissions: {
            include: { permission: true }
          }
        }
      }
    }
  }
});

const userWithRoles = Prisma.validator<Prisma.UserDefaultArgs>()({
  include: userInclude
});

type UserWithRoles = Prisma.UserGetPayload<typeof userWithRoles>;

const DEMO_VIEWER_EMAIL = "viewer@example.local";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {}

  async login(input: {
    email: string;
    password: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{ token: string; expiresAt: Date; user: RequestUser }> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
      ...userWithRoles
    });
    if (!user || !user.enabled) {
      throw new Error("Invalid credentials");
    }

    const ok = await argon2.verify(user.passwordHash, input.password);
    if (!ok) {
      throw new Error("Invalid credentials");
    }

    const token = randomBytes(32).toString("base64url");
    const tokenHash = this.hashToken(token);
    const ttlHours = Number(this.config.get<string>("SESSION_TTL_HOURS") ?? 12);
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    await this.prisma.userSession.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent
      }
    });
    await writeAuditLog(this.prisma, {
      userId: user.id,
      action: "auth.login",
      entityType: "user",
      entityId: user.id,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent
    });

    return { token, expiresAt, user: this.toRequestUser(user) };
  }

  async logout(token: string | undefined, userId?: string): Promise<void> {
    if (!token) {
      return;
    }
    await this.prisma.userSession.updateMany({
      where: { tokenHash: this.hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() }
    });
    if (userId) {
      await writeAuditLog(this.prisma, {
        userId,
        action: "auth.logout",
        entityType: "user",
        entityId: userId
      });
    }
  }

  async resolveSession(token: string): Promise<RequestUser | null> {
    const session = await this.prisma.userSession.findUnique({
      where: { tokenHash: this.hashToken(token) },
      include: { user: { include: userInclude } }
    });
    if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now() || !session.user.enabled) {
      return null;
    }
    return this.toRequestUser(session.user);
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private toRequestUser(user: UserWithRoles): RequestUser {
    if (this.isSeededDemoViewer(user.email)) {
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        roles: ["Viewer"],
        permissions: [...ROLE_PERMISSIONS.Viewer],
        accessScope: { dataProfiles: ["DEMO"], exhibitionIds: [], zoneIds: [] }
      };
    }

    const roleNames = user.roles.map((entry) => entry.role.name);
    const permissionKeys = new Set<Permission>();
    for (const entry of user.roles) {
      for (const permission of entry.role.permissions) {
        permissionKeys.add(permission.permission.key as Permission);
      }
    }
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      roles: roleNames,
      permissions: Array.from(permissionKeys),
      accessScope: normalizeAccessScope(user.accessScope)
    };
  }

  private isSeededDemoViewer(email: string): boolean {
    return email.toLowerCase() === DEMO_VIEWER_EMAIL;
  }
}

import { Prisma } from "@prisma/client";
import type { PrismaService } from "../prisma/prisma.service";

export async function writeAuditLog(
  prisma: PrismaService,
  input: {
    userId?: string;
    action: string;
    entityType: string;
    entityId?: string;
    riskLevel?: string;
    before?: unknown;
    after?: unknown;
    reason?: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
  }
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      riskLevel: input.riskLevel ?? "normal",
      before: input.before as object | undefined,
      after: input.after as object | undefined,
      reason: input.reason,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent
    }
  });
}

import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RequirePermissions } from "../common/permissions.decorator";
import { PrismaService } from "../prisma/prisma.service";

@ApiTags("audit")
@Controller("audit-logs")
@RequirePermissions("audit:read")
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@Query() query: { entityType?: string; userId?: string; page?: string; pageSize?: string }) {
    const page = query.page ? Number(query.page) : 1;
    const pageSize = query.pageSize ? Number(query.pageSize) : 50;
    return this.prisma.auditLog.findMany({
      where: { entityType: query.entityType, userId: query.userId },
      include: { user: { select: { id: true, email: true, name: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize
    });
  }
}

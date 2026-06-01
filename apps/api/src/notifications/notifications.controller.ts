import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { CurrentUser, type RequestUser } from "../common/current-user.decorator";
import { RequirePermissions } from "../common/permissions.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { NotificationsService } from "./notifications.service";

const channelSchema = z.object({
  type: z.enum(["email", "line", "discord", "telegram"]),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  maskedIdentifier: z.string().optional()
});

const testSchema = z.object({
  recipient: z.string().optional(),
  userId: z.string().uuid().optional(),
  roleId: z.string().uuid().optional()
});

@ApiTags("notifications")
@Controller("notifications")
@RequirePermissions("notifications:manage")
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get("channels")
  channels() {
    return this.notificationsService.listChannels();
  }

  @Post("channels")
  upsertChannel(@Body(new ZodValidationPipe(channelSchema)) body: z.infer<typeof channelSchema>, @CurrentUser() user?: RequestUser) {
    return this.notificationsService.upsertChannel(body, user);
  }

  @Post("channels/:type/test")
  sendTest(
    @Param("type") type: "email" | "line" | "discord" | "telegram",
    @Body(new ZodValidationPipe(testSchema)) body: z.infer<typeof testSchema>,
    @CurrentUser() user?: RequestUser
  ) {
    return this.notificationsService.sendTest(type, body, user);
  }
}

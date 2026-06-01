import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import nodemailer from "nodemailer";
import { writeAuditLog } from "../common/audit.util";
import type { RequestUser } from "../common/current-user.decorator";
import { PrismaService } from "../prisma/prisma.service";

type ChannelType = "email" | "line" | "discord" | "telegram";

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {}

  listChannels() {
    return this.prisma.notificationChannel.findMany({
      select: {
        id: true,
        type: true,
        name: true,
        enabled: true,
        maskedIdentifier: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: [{ type: "asc" }, { name: "asc" }]
    });
  }

  async upsertChannel(input: { type: ChannelType; name: string; enabled: boolean; maskedIdentifier?: string }, user?: RequestUser) {
    const before = await this.prisma.notificationChannel.findUnique({ where: { type_name: { type: input.type, name: input.name } } });
    const channel = await this.prisma.notificationChannel.upsert({
      where: { type_name: { type: input.type, name: input.name } },
      update: {
        name: input.name,
        enabled: input.enabled,
        maskedIdentifier: input.maskedIdentifier
      },
      create: {
        type: input.type,
        name: input.name,
        enabled: input.enabled,
        maskedIdentifier: input.maskedIdentifier
      },
      select: {
        id: true,
        type: true,
        name: true,
        enabled: true,
        maskedIdentifier: true
      }
    });
    await writeAuditLog(this.prisma, {
      userId: user?.id,
      action: "notification_channel.upsert",
      entityType: "notification_channel",
      entityId: channel.id,
      before,
      after: channel
    });
    return channel;
  }

  async sendTest(
    type: ChannelType,
    input: { recipient?: string; userId?: string; roleId?: string } = {},
    user?: RequestUser
  ): Promise<{ ok: boolean; deliveries: Array<{ deliveryId: string; recipient?: string | null; ok: boolean; error?: string }> }> {
    const channel = await this.ensureChannel(type);
    const payload = {
      subject: "NMTH Climate Monitor test",
      text: "This is a test notification from NMTH Climate Monitor."
    };
    const recipients = await this.resolveRecipients(type, input);
    const deliveries: Array<{ deliveryId: string; recipient?: string | null; ok: boolean; error?: string }> = [];
    for (const recipient of recipients) {
      const delivery = await this.prisma.notificationDelivery.create({
        data: {
          channelId: channel.id,
          eventType: "test",
          status: "queued",
          recipient,
          payload
        }
      });
      try {
        await this.dispatch(type, payload, recipient ?? undefined);
        await this.prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: { status: "sent", sentAt: new Date() }
        });
        deliveries.push({ deliveryId: delivery.id, recipient, ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown";
        await this.prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: { status: "failed", error: message, retryCount: { increment: 1 } }
        });
        deliveries.push({ deliveryId: delivery.id, recipient, ok: false, error: message });
      }
    }
    const result = { ok: deliveries.every((delivery) => delivery.ok), deliveries };
    await writeAuditLog(this.prisma, {
      userId: user?.id,
      action: "notification_channel.test",
      entityType: "notification_channel",
      entityId: channel.id,
      after: { type, deliveryCount: deliveries.length, ok: result.ok }
    });
    return result;
  }

  async renderTemplate(key: string, locale: string, variables: Record<string, string | number>): Promise<{ subject?: string; body: string }> {
    const template = await this.prisma.notificationTemplate.findUnique({
      where: { key_locale: { key, locale } }
    });
    if (!template) {
      return { subject: key, body: JSON.stringify(variables) };
    }
    const replace = (text: string) =>
      text.replace(/\{\{(\w+)\}\}/g, (_match, token: string) => String(variables[token] ?? ""));
    return {
      subject: template.subject ? replace(template.subject) : undefined,
      body: replace(template.body)
    };
  }

  private async ensureChannel(type: ChannelType) {
    return this.prisma.notificationChannel.upsert({
      where: { type_name: { type, name: "default" } },
      update: {},
      create: {
        type,
        name: "default",
        enabled: true,
        maskedIdentifier: this.maskedIdentifier(type)
      }
    });
  }

  private async dispatch(type: ChannelType, payload: { subject: string; text: string }, recipient?: string): Promise<void> {
    if (type === "email") {
      const transporter = nodemailer.createTransport({
        host: this.config.get<string>("SMTP_HOST") ?? "localhost",
        port: Number(this.config.get<string>("SMTP_PORT") ?? 1025),
        secure: false,
        auth: this.config.get<string>("SMTP_USER")
          ? {
              user: this.config.get<string>("SMTP_USER"),
              pass: this.config.get<string>("SMTP_PASS")
            }
          : undefined
      });
      await transporter.sendMail({
        from: this.config.get<string>("SMTP_FROM") ?? "NMTH Climate Monitor <no-reply@example.local>",
        to: recipient ?? "test@example.local",
        subject: payload.subject,
        text: payload.text
      });
      return;
    }

    if (type === "discord") {
      const botToken = this.config.get<string>("DISCORD_BOT_TOKEN");
      if (botToken && !botToken.startsWith("fake") && recipient) {
        const channelResponse = await fetch("https://discord.com/api/v10/users/@me/channels", {
          method: "POST",
          headers: { authorization: `Bot ${botToken}`, "content-type": "application/json" },
          body: JSON.stringify({ recipient_id: recipient })
        });
        if (!channelResponse.ok) throw new Error(`Discord DM channel status ${channelResponse.status}`);
        const channel = (await channelResponse.json()) as { id?: string };
        const messageResponse = await fetch(`https://discord.com/api/v10/channels/${channel.id}/messages`, {
          method: "POST",
          headers: { authorization: `Bot ${botToken}`, "content-type": "application/json" },
          body: JSON.stringify({ content: payload.text })
        });
        if (!messageResponse.ok) throw new Error(`Discord DM status ${messageResponse.status}`);
        return;
      }
      const url = this.config.get<string>("DISCORD_WEBHOOK_URL");
      if (!url || url.includes("/fake/")) {
        return;
      }
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: payload.text })
      });
      if (!response.ok) throw new Error(`Discord status ${response.status}`);
      return;
    }

    if (type === "line") {
      const token = this.config.get<string>("LINE_CHANNEL_ACCESS_TOKEN");
      const to = recipient ?? this.config.get<string>("LINE_DEFAULT_TO");
      if (!token || token.startsWith("fake") || !to) {
        return;
      }
      const response = await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ to, messages: [{ type: "text", text: payload.text }] })
      });
      if (!response.ok) throw new Error(`LINE status ${response.status}`);
      return;
    }

    if (type === "telegram") {
      const token = this.config.get<string>("TELEGRAM_BOT_TOKEN");
      const chatId = recipient ?? this.config.get<string>("TELEGRAM_DEFAULT_CHAT_ID");
      if (!token || token.startsWith("fake") || !chatId) {
        return;
      }
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: payload.text })
      });
      if (!response.ok) throw new Error(`Telegram status ${response.status}`);
    }
  }

  private maskedIdentifier(type: ChannelType): string {
    if (type === "email") return this.config.get<string>("SMTP_FROM") ?? "configured";
    if (type === "discord") return this.config.get<string>("DISCORD_WEBHOOK_URL") || this.config.get<string>("DISCORD_BOT_TOKEN") ? "discord configured" : "not configured";
    if (type === "line") return this.config.get<string>("LINE_CHANNEL_ACCESS_TOKEN") ? "line token configured" : "not configured";
    return this.config.get<string>("TELEGRAM_BOT_TOKEN") ? "telegram bot configured" : "not configured";
  }

  private async resolveRecipients(type: ChannelType, input: { recipient?: string; userId?: string; roleId?: string }): Promise<Array<string | null>> {
    if (input.recipient) {
      return [input.recipient];
    }
    if (type === "email") {
      if (input.userId) {
        const user = await this.prisma.user.findUnique({ where: { id: input.userId }, select: { email: true } });
        return user?.email ? [user.email] : [null];
      }
      if (input.roleId) {
        const users = await this.prisma.user.findMany({
          where: { enabled: true, roles: { some: { roleId: input.roleId } } },
          select: { email: true }
        });
        return users.map((user) => user.email);
      }
      return [null];
    }
    if (input.userId) {
      const contact = await this.prisma.userNotificationContact.findUnique({
        where: { userId_type: { userId: input.userId, type } }
      });
      return contact?.enabled ? [contact.identifier] : [null];
    }
    if (input.roleId) {
      const users = await this.prisma.user.findMany({
        where: { enabled: true, roles: { some: { roleId: input.roleId } } },
        include: { notificationContacts: { where: { type, enabled: true } } }
      });
      const recipients = users.flatMap((user) => user.notificationContacts.map((contact) => contact.identifier));
      return recipients.length ? recipients : [null];
    }
    return [null];
  }
}

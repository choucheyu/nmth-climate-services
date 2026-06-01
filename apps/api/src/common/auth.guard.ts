import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { AuthService } from "../auth/auth.service";
import { LEGACY_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME } from "./security";

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: unknown }>();
    const token = (request.cookies?.[SESSION_COOKIE_NAME] ?? request.cookies?.[LEGACY_SESSION_COOKIE_NAME]) as string | undefined;
    if (!token) {
      throw new UnauthorizedException("Missing session");
    }

    const user = await this.authService.resolveSession(token);
    if (!user) {
      throw new UnauthorizedException("Invalid session");
    }

    request.user = user;
    return true;
  }
}

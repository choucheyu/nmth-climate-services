import { Body, Controller, Get, Inject, Post, Req, Res, UnauthorizedException } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { z } from "zod";
import { CurrentUser, type RequestUser } from "../common/current-user.decorator";
import { Public } from "../common/public.decorator";
import { LEGACY_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME } from "../common/security";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AuthService } from "./auth.service";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Public()
  @Post("login")
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: z.infer<typeof loginSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ): Promise<{ user: RequestUser; expiresAt: Date }> {
    try {
      const result = await this.authService.login({
        email: body.email,
        password: body.password,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"]
      });
      const cookieName = process.env.NODE_ENV === "production" ? SESSION_COOKIE_NAME : LEGACY_SESSION_COOKIE_NAME;
      response.cookie(cookieName, result.token, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        expires: result.expiresAt,
        path: "/"
      });
      return { user: result.user, expiresAt: result.expiresAt };
    } catch {
      throw new UnauthorizedException("Invalid credentials");
    }
  }

  @Post("logout")
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @CurrentUser() user?: RequestUser
  ): Promise<{ ok: true }> {
    await this.authService.logout(request.cookies?.[SESSION_COOKIE_NAME] ?? request.cookies?.[LEGACY_SESSION_COOKIE_NAME], user?.id);
    response.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    response.clearCookie(LEGACY_SESSION_COOKIE_NAME, { path: "/" });
    return { ok: true };
  }

  @Get("me")
  me(@CurrentUser() user: RequestUser): RequestUser {
    return user;
  }
}

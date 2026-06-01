import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { DataProfile } from "@nmth/shared";
import type { Request } from "express";

export interface RequestAccessScope {
  dataProfiles: DataProfile[] | null;
  exhibitionIds: string[];
  zoneIds: string[];
}

export interface RequestUser {
  id: string;
  email: string;
  name: string;
  roles: string[];
  permissions: string[];
  accessScope?: RequestAccessScope;
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestUser | undefined => {
  const request = ctx.switchToHttp().getRequest<Request & { user?: RequestUser }>();
  return request.user;
});

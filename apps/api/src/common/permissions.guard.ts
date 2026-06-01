import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Permission } from "@nmth/shared";
import { PERMISSIONS_KEY } from "./permissions.decorator";
import type { RequestUser } from "./current-user.decorator";

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const classPermissions = this.reflector.get<Permission[]>(PERMISSIONS_KEY, context.getClass()) ?? [];
    const handlerPermissions = this.reflector.get<Permission[]>(PERMISSIONS_KEY, context.getHandler()) ?? [];
    const required = Array.from(new Set([...classPermissions, ...handlerPermissions]));
    if (!required?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: RequestUser }>();
    const granted = new Set(request.user?.permissions ?? []);
    const ok = required.every((permission) => granted.has(permission));
    if (!ok) {
      throw new ForbiddenException("Insufficient permissions");
    }
    return true;
  }
}

import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";

import { AppError, ERROR_CODES } from "../common/app.error";
import type { AuthenticatedUser } from "../auth/authenticated-user";
import { tenantContextOf } from "./current-tenant.decorator";
import { hasPermission, type Permission } from "./permissions";
import { REQUIRE_PERMISSION_KEY } from "./require-permission.decorator";

/**
 * Single enforcement point for permission keys (ADR-019). Runs after
 * `JwtAuthGuard`. No metadata means pass-through — authentication itself is the
 * JWT guard's job, not this one's.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(
      REQUIRE_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!permission) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) {
      throw AppError.unauthorized(ERROR_CODES.UNAUTHENTICATED, "Authentication required.");
    }

    if (!hasPermission(user.role, permission, tenantContextOf(user))) {
      throw AppError.forbidden(
        ERROR_CODES.PERMISSION_DENIED,
        "You do not have permission to perform this action.",
      );
    }

    return true;
  }
}

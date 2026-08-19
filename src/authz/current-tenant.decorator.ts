import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

import type { AuthenticatedUser } from "../auth/authenticated-user";
import type { TenantContext } from "./permissions";

/**
 * `shopId` is the JWT `owner_id` claim, or the caller's own `id` when they are an
 * `admin` with no `owner_id`. `branchId` is unused in Sprint 1 — the shape exists
 * now so a future branch-scoped role needs no route-signature change (ADR-019).
 */
export function tenantContextOf(user: AuthenticatedUser): TenantContext {
  // `branchId` stays undefined in Sprint 1 — no branch-scoped resource exists yet.
  // The field is present so a future branch-scoped role needs no signature change.
  return { shopId: user.owner_id };
}

export const CurrentTenant = createParamDecorator(
  (_data: unknown, context: ExecutionContext): TenantContext => {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    if (!request.user) {
      throw new Error("@CurrentTenant() used on a route without an authenticated user");
    }
    return tenantContextOf(request.user);
  },
);

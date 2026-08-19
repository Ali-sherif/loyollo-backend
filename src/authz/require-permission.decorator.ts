import { SetMetadata } from "@nestjs/common";

import type { Permission } from "./permissions";

export const REQUIRE_PERMISSION_KEY = "require_permission";

/**
 * Declares the permission key an endpoint needs (ADR-019). Routes without this
 * metadata are self-service: any authenticated, active, non-`customer` session.
 */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, permission);

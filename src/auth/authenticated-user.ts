import type { AccountStatus, Role } from "../generated/prisma/enums";

/**
 * What `JwtAuthGuard` attaches to the request.
 *
 * `role` / `owner_id` come from the verified JWT claim. `account_status` is the
 * value re-read live from `profiles` on this request, never the claim
 * (ADR-005 § Account status vs automatic lockout).
 */
export type AuthenticatedUser = {
  id: string;
  email: string;
  role: Role;
  account_status: AccountStatus;
  /** Shop scope. Resolved to the caller's own id for `admin`. */
  owner_id: string;
};

/** JWT access-token claims (docs/backend/api-contract.md#jwt-claims-access-token). */
export type AccessTokenClaims = {
  sub: string;
  email: string;
  role: Role;
  account_status: AccountStatus;
  owner_id: string;
  iat?: number;
  exp?: number;
};

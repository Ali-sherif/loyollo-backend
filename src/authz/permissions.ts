import { Role } from "../generated/prisma/enums";

/**
 * Permission keys, not roles, are what endpoints declare (ADR-019).
 * Naming convention: `resource:action`.
 *
 * Sprint 1 has exactly two real keys. Every Sprint 2+ module must declare its own
 * key here from day one — reserved examples: `campaign:read`, `campaign:send`,
 * `customer:export`, `points:redeem`, `program:manage`, `screen:<name>:view`.
 */
export const ALL_PERMISSIONS = ["team:invite", "account:status:update"] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

/** The ADR-005 admin-only carve-out, expressed as data rather than a role branch. */
export const ADMIN_ONLY_PERMISSIONS: readonly Permission[] = [
  "team:invite",
  "account:status:update",
];

/**
 * The only place role→permission facts live. Adding a role is one new entry here
 * plus one enum-value migration — no guard, decorator, or controller changes.
 */
export const ROLE_PERMISSIONS: Record<Role, "*" | readonly Permission[]> = {
  [Role.admin]: "*",
  [Role.staff]: ALL_PERMISSIONS.filter((p) => !ADMIN_ONLY_PERMISSIONS.includes(p)),
  [Role.customer]: [],
};

export type TenantContext = {
  shopId: string;
  branchId?: string;
};

/**
 * Pure map lookup — never branches on a role name.
 *
 * `context` is accepted but unused by the MVP logic. The 3-argument shape exists
 * from day one so a later context-aware body (branch scoping, per-user overrides,
 * CASL) is a body change, never a signature or call-site change.
 */
export function hasPermission(
  role: Role,
  permission: Permission,
  context?: TenantContext,
): boolean {
  void context;
  const allowed = ROLE_PERMISSIONS[role];
  if (allowed === "*") return true;
  return allowed.includes(permission);
}

/**
 * The caller's fully expanded permission set for `GET /auth/me` and every session
 * response — never the literal `'*'`, so the frontend gates screens off the same
 * keys the backend enforces.
 */
export function permissionsFor(role: Role): Permission[] {
  const allowed = ROLE_PERMISSIONS[role];
  return allowed === "*" ? [...ALL_PERMISSIONS] : [...allowed];
}

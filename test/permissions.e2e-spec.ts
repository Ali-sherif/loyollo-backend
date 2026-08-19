import { Role } from "../src/generated/prisma/enums";
import {
  ALL_PERMISSIONS,
  ROLE_PERMISSIONS,
  hasPermission,
  permissionsFor,
  type Permission,
} from "../src/authz/permissions";

/** Unit coverage for ADR-019's role→permission table. */
describe("Permission model", () => {
  describe("hasPermission", () => {
    const cases: Array<[Role, Permission, boolean]> = [
      [Role.admin, "team:invite", true],
      [Role.admin, "account:status:update", true],
      [Role.staff, "team:invite", false],
      [Role.staff, "account:status:update", false],
      [Role.customer, "team:invite", false],
      [Role.customer, "account:status:update", false],
    ];

    it.each(cases)("%s / %s -> %s", (role, permission, expected) => {
      expect(hasPermission(role, permission)).toBe(expected);
    });

    it("ignores tenant context in the MVP without changing the answer", () => {
      expect(hasPermission(Role.admin, "team:invite", { shopId: "shop-1" })).toBe(true);
      expect(hasPermission(Role.staff, "team:invite", { shopId: "shop-1" })).toBe(false);
    });
  });

  describe("permissionsFor", () => {
    it("expands the admin wildcard instead of leaking it", () => {
      const permissions = permissionsFor(Role.admin);
      expect(permissions).not.toContain("*");
      expect(permissions.sort()).toEqual([...ALL_PERMISSIONS].sort());
    });

    it("returns an empty set for roles with no permissions", () => {
      expect(permissionsFor(Role.staff)).toEqual([]);
      expect(permissionsFor(Role.customer)).toEqual([]);
    });

    it("returns a copy, so a caller cannot mutate the shared table", () => {
      permissionsFor(Role.admin).push("team:invite");
      expect(permissionsFor(Role.admin)).toHaveLength(ALL_PERMISSIONS.length);
    });
  });

  describe("extensibility", () => {
    it("supports a new role and key by touching only this table", () => {
      const table: Record<string, "*" | readonly string[]> = {
        ...ROLE_PERMISSIONS,
        auditor: ["report:read"],
      };

      const lookup = (role: string, permission: string) => {
        const allowed = table[role];
        return allowed === "*" ? true : (allowed?.includes(permission) ?? false);
      };

      expect(lookup("auditor", "report:read")).toBe(true);
      expect(lookup("auditor", "team:invite")).toBe(false);
      expect(lookup(Role.admin, "report:read")).toBe(true);
    });
  });
});

import { JwtService } from "@nestjs/jwt";

import { createE2EApp, type E2EContext } from "./create-app";
import {
  api,
  authed,
  inviteAndAccept,
  mainBranchId,
  signUpAdmin,
  uniqueEmail,
  type Session,
} from "./auth-helpers";

/** Verifies ADR-019 permissions and the tenant-scoping that closes IDOR. */
describe("Authorization (e2e)", () => {
  let ctx: E2EContext;
  let admin: Session;
  let staff: Session;
  let branchId: string;

  beforeAll(async () => {
    ctx = await createE2EApp();
    admin = (await signUpAdmin(ctx)).session;
    branchId = await mainBranchId(ctx, admin.user.owner_id);
    staff = (await inviteAndAccept(ctx, admin)).session;
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe("admin-only carve-out", () => {
    const adminOnly = [
      { method: "post" as const, path: "/auth/team", body: { role: "staff" } },
      { method: "post" as const, path: "/auth/team/:id/resend" },
      { method: "post" as const, path: "/auth/team/:id/revoke" },
    ];

    it("lets an admin invite, and refuses staff with PERMISSION_DENIED", async () => {
      await authed(ctx, admin)
        .post("/auth/team")
        .send({ email: uniqueEmail("ok"), branch_id: branchId, role: "staff" })
        .expect(201);

      const denied = await authed(ctx, staff)
        .post("/auth/team")
        .send({ email: uniqueEmail("nope"), branch_id: branchId, role: "staff" })
        .expect(403);
      expect(denied.body.code).toBe("PERMISSION_DENIED");
    });

    it("refuses staff on every team route and on account status", async () => {
      const invitationId = "11111111-1111-1111-1111-111111111111";
      for (const route of adminOnly.slice(1)) {
        const response = await authed(ctx, staff)
          [route.method](route.path.replace(":id", invitationId))
          .send({})
          .expect(403);
        expect(response.body.code).toBe("PERMISSION_DENIED");
      }

      const status = await authed(ctx, staff)
        .patch(`/auth/accounts/${staff.user.id}/status`)
        .send({ account_status: "inactive" })
        .expect(403);
      expect(status.body.code).toBe("PERMISSION_DENIED");
    });

    it("leaves routes without a permission requirement open to any signed-in role", async () => {
      await authed(ctx, staff).get("/auth/me").expect(200);
      await authed(ctx, staff)
        .post("/auth/change-password")
        .send({ current_password: "wrong-password-value", new_password: "another-password-1" })
        .expect(401);
    });
  });

  describe("permissions in the session payload", () => {
    it("expands the role's permissions rather than a wildcard", async () => {
      const adminMe = await authed(ctx, admin).get("/auth/me").expect(200);
      expect(adminMe.body.permissions.sort()).toEqual(
        ["account:status:update", "team:invite"].sort(),
      );

      const staffMe = await authed(ctx, staff).get("/auth/me").expect(200);
      expect(staffMe.body.permissions).toEqual([]);
    });
  });

  describe("cross-tenant isolation", () => {
    it("returns 404 when an admin touches another shop's account", async () => {
      const other = await signUpAdmin(ctx);
      const otherStaff = await inviteAndAccept(ctx, other.session);

      const response = await authed(ctx, admin)
        .patch(`/auth/accounts/${otherStaff.session.user.id}/status`)
        .send({ account_status: "inactive" })
        .expect(404);
      // A 403 would confirm the account exists.
      expect(response.body.code).toBe("NOT_FOUND");

      const unchanged = await ctx.prisma.profile.findUniqueOrThrow({
        where: { id: otherStaff.session.user.id },
      });
      expect(unchanged.account_status).toBe("active");
    });

    it("returns 404 for an account id that does not exist at all", async () => {
      await authed(ctx, admin)
        .patch("/auth/accounts/11111111-1111-1111-1111-111111111111/status")
        .send({ account_status: "inactive" })
        .expect(404);
    });

    it("rejects a malformed account id before reaching the handler", async () => {
      await authed(ctx, admin)
        .patch("/auth/accounts/not-a-uuid/status")
        .send({ account_status: "inactive" })
        .expect(400);
    });
  });

  describe("customer role", () => {
    it("is refused at the guard, before any permission check", async () => {
      const email = uniqueEmail("customer");
      await ctx.prisma.profile.create({
        data: {
          email,
          password_hash: "$2b$04$0000000000000000000000000000000000000000000000000000",
          role: "customer",
          account_status: "active",
        },
      });
      const customer = await ctx.prisma.profile.findUniqueOrThrow({ where: { email } });

      // Mint a token the same way the app does, so this tests the guard and not sign-in.
      const token = await ctx.app.get(JwtService).signAsync({
        sub: customer.id,
        email: customer.email,
        role: "customer",
        owner_id: customer.id,
      });

      const response = await api(ctx)
        .get("/auth/me")
        .set("authorization", `Bearer ${token}`)
        .expect(403);
      expect(response.body.code).toBe("FORBIDDEN_ROLE");
    });
  });
});

import { sha256 } from "../src/common/crypto.util";
import { createE2EApp, type E2EContext } from "./create-app";
import {
  PASSWORD,
  api,
  authed,
  inviteAndAccept,
  mainBranchId,
  signUpAdmin,
  uniqueEmail,
  waitForEmail,
  type Session,
} from "./auth-helpers";

/** Verifies ADR-022: single-use invitation tokens replace emailed temp passwords. */
describe("Staff invitations (e2e)", () => {
  let ctx: E2EContext;
  let admin: Session;
  let branchId: string;

  beforeAll(async () => {
    ctx = await createE2EApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    ctx.mailer.reset();
    admin = (await signUpAdmin(ctx)).session;
    branchId = await mainBranchId(ctx, admin.user.owner_id);
  });

  function invite(body: Record<string, unknown>) {
    return authed(ctx, admin).post("/auth/team").send(body);
  }

  describe("creation", () => {
    it("creates a pending invitation and emails the accept link, with no account yet", async () => {
      const email = uniqueEmail("invitee");
      const response = await invite({ email, branch_id: branchId, role: "staff" }).expect(201);

      expect(response.body.invitation).toMatchObject({ email, role: "staff", status: "PENDING" });
      expect(response.body.user).toBeUndefined();
      expect(response.body.password).toBeUndefined();

      expect(await ctx.prisma.profile.findUnique({ where: { email } })).toBeNull();

      await waitForEmail(() => ctx.mailer.lastTo(email));
      const message = ctx.mailer.lastTo(email)!;
      expect(message.templateName).toBe("auth:invite");
      // ADR-022 §N: the email carries context, and never a password.
      expect(message.html).toContain("Main branch");
      expect(message.html?.toLowerCase()).not.toContain("temporary password");
    });

    it("stores only the hash of the token", async () => {
      const email = uniqueEmail("invitee");
      await invite({ email, branch_id: branchId, role: "staff" }).expect(201);
      await waitForEmail(() => ctx.mailer.lastTo(email));

      const rawToken = ctx.mailer.tokenFor(email)!;
      const row = await ctx.prisma.invitation.findFirstOrThrow({ where: { email } });
      expect(row.token_hash).toBe(sha256(rawToken));
      expect(row.token_hash).not.toBe(rawToken);
      // 32 random bytes, base64url — not a UUID.
      expect(rawToken).not.toMatch(/^[0-9a-f-]{36}$/);
      expect(rawToken.length).toBeGreaterThanOrEqual(40);
    });

    it("refuses a role outside admin|staff", async () => {
      await invite({ email: uniqueEmail("x"), branch_id: branchId, role: "customer" }).expect(400);
    });

    it("refuses a branch belonging to another shop, as a 404", async () => {
      const other = await signUpAdmin(ctx);
      const otherBranch = await mainBranchId(ctx, other.session.user.owner_id);

      const response = await invite({
        email: uniqueEmail("x"),
        branch_id: otherBranch,
        role: "staff",
      }).expect(404);
      // A 403 here would confirm the branch exists somewhere.
      expect(response.body.code).toBe("NOT_FOUND");
    });

    it("refuses to invite an address that already has an account", async () => {
      const existing = await signUpAdmin(ctx);
      const response = await invite({
        email: existing.email,
        branch_id: branchId,
        role: "staff",
      }).expect(409);
      expect(response.body.code).toBe("ACCOUNT_ALREADY_EXISTS");
    });

    it("rejects a client-supplied shop_id", async () => {
      await invite({
        email: uniqueEmail("x"),
        branch_id: branchId,
        role: "staff",
        shop_id: "00000000-0000-0000-0000-000000000000",
      }).expect(400);
    });
  });

  describe("validation", () => {
    it("returns display-only fields for a valid token and never echoes the token", async () => {
      const email = uniqueEmail("invitee");
      await invite({ email, branch_id: branchId, role: "staff" }).expect(201);
      await waitForEmail(() => ctx.mailer.lastTo(email));
      const token = ctx.mailer.tokenFor(email)!;

      const response = await api(ctx)
        .get("/auth/invitations/validate")
        .query({ token })
        .expect(200);

      expect(response.body).toEqual({
        valid: true,
        email,
        shop_name: "Test Shop",
        branch_name: "Main branch",
        role: "staff",
        expires_at: expect.any(String),
      });
      expect(response.text).not.toContain(token);
    });

    it("reports a generic state for unknown, revoked, consumed, and expired tokens", async () => {
      const unknown = await api(ctx)
        .get("/auth/invitations/validate")
        .query({ token: "no-such-token" })
        .expect(200);
      expect(unknown.body).toEqual({ valid: false, state: "invalid" });

      const revokedEmail = uniqueEmail("revoked");
      const revoked = await invite({
        email: revokedEmail,
        branch_id: branchId,
        role: "staff",
      }).expect(201);
      await waitForEmail(() => ctx.mailer.lastTo(revokedEmail));
      const revokedToken = ctx.mailer.tokenFor(revokedEmail)!;
      await authed(ctx, admin)
        .post(`/auth/team/${revoked.body.invitation.id}/revoke`)
        .expect(200);
      await expectState(revokedToken, "revoked");

      const consumed = await inviteAndAccept(ctx, admin);
      const consumedToken = ctx.mailer.tokenFor(consumed.email)!;
      await expectState(consumedToken, "consumed");

      const expiredEmail = uniqueEmail("expired");
      await invite({ email: expiredEmail, branch_id: branchId, role: "staff" }).expect(201);
      await waitForEmail(() => ctx.mailer.lastTo(expiredEmail));
      const expiredToken = ctx.mailer.tokenFor(expiredEmail)!;
      await ctx.prisma.invitation.updateMany({
        where: { email: expiredEmail },
        data: { expires_at: new Date(Date.now() - 1_000) },
      });
      await expectState(expiredToken, "expired");
    });

    async function expectState(token: string, state: string) {
      const response = await api(ctx)
        .get("/auth/invitations/validate")
        .query({ token })
        .expect(200);
      expect(response.body).toEqual({ valid: false, state });
    }
  });

  describe("acceptance", () => {
    it("creates an active account and an immediate session, with no first-login gate", async () => {
      const { email, session } = await inviteAndAccept(ctx, admin);

      expect(session.user).toMatchObject({
        email,
        role: "staff",
        account_status: "active",
        owner_id: admin.user.owner_id,
      });
      expect(session.access_token).toEqual(expect.any(String));
      expect(session.refresh_token).toEqual(expect.any(String));
      expect(session).not.toHaveProperty("must_change_password");

      // The new session works straight away.
      await authed(ctx, session).get("/auth/me").expect(200);
    });

    it("takes email, role, owner, and branch from the invitation, not the request", async () => {
      const email = uniqueEmail("invitee");
      await invite({ email, branch_id: branchId, role: "staff" }).expect(201);
      await waitForEmail(() => ctx.mailer.lastTo(email));
      const token = ctx.mailer.tokenFor(email)!;

      // Any attempt to steer these fields is a validation failure, not a silent drop.
      await api(ctx)
        .post("/auth/accept-invite")
        .send({
          token,
          full_name: "Impostor",
          password: PASSWORD,
          email: uniqueEmail("attacker"),
          role: "admin",
        })
        .expect(400);

      await api(ctx)
        .post("/auth/accept-invite")
        .send({ token, full_name: "Real Staff", password: PASSWORD })
        .expect(201);

      const profile = await ctx.prisma.profile.findUniqueOrThrow({ where: { email } });
      expect(profile.role).toBe("staff");
      expect(profile.owner_id).toBe(admin.user.owner_id);
      expect(profile.branch_id).toBe(branchId);
    });

    it("creates exactly one account when the same token is accepted concurrently", async () => {
      const email = uniqueEmail("racer");
      await invite({ email, branch_id: branchId, role: "staff" }).expect(201);
      await waitForEmail(() => ctx.mailer.lastTo(email));
      const token = ctx.mailer.tokenFor(email)!;

      const attempts = await Promise.all(
        Array.from({ length: 4 }, () =>
          api(ctx)
            .post("/auth/accept-invite")
            .send({ token, full_name: "Racer", password: PASSWORD }),
        ),
      );

      const created = attempts.filter((r) => r.status === 201);
      const rejected = attempts.filter((r) => r.status !== 201);
      expect(created).toHaveLength(1);
      // The losers must get the same generic rejection, never a 500.
      for (const response of rejected) {
        expect(response.status).toBe(400);
        expect(response.body.code).toBe("INVALID_INVITATION");
      }

      expect(await ctx.prisma.profile.count({ where: { email } })).toBe(1);
    });

    it("keeps CONSUMED terminal", async () => {
      const { email } = await inviteAndAccept(ctx, admin);
      const token = ctx.mailer.tokenFor(email)!;

      const replay = await api(ctx)
        .post("/auth/accept-invite")
        .send({ token, full_name: "Second", password: PASSWORD })
        .expect(400);
      expect(replay.body.code).toBe("INVALID_INVITATION");

      const row = await ctx.prisma.invitation.findFirstOrThrow({ where: { email } });
      expect(row.status).toBe("CONSUMED");
      expect(row.consumed_by_profile_id).not.toBeNull();
    });

    it("rejects an expired invitation", async () => {
      const email = uniqueEmail("stale");
      await invite({ email, branch_id: branchId, role: "staff" }).expect(201);
      await waitForEmail(() => ctx.mailer.lastTo(email));
      const token = ctx.mailer.tokenFor(email)!;
      await ctx.prisma.invitation.updateMany({
        where: { email },
        data: { expires_at: new Date(Date.now() - 1_000) },
      });

      const response = await api(ctx)
        .post("/auth/accept-invite")
        .send({ token, full_name: "Late", password: PASSWORD })
        .expect(400);
      expect(response.body.code).toBe("INVALID_INVITATION");
      expect(await ctx.prisma.profile.findUnique({ where: { email } })).toBeNull();
    });
  });

  describe("resend and revoke", () => {
    it("resend invalidates the previous link and the new one works", async () => {
      const email = uniqueEmail("resend");
      const created = await invite({ email, branch_id: branchId, role: "staff" }).expect(201);
      await waitForEmail(() => ctx.mailer.lastTo(email));
      const firstToken = ctx.mailer.tokenFor(email)!;

      ctx.mailer.reset();
      await authed(ctx, admin).post(`/auth/team/${created.body.invitation.id}/resend`).expect(200);
      await waitForEmail(() => ctx.mailer.lastTo(email));
      const secondToken = ctx.mailer.tokenFor(email)!;

      expect(secondToken).not.toBe(firstToken);
      const stale = await api(ctx)
        .get("/auth/invitations/validate")
        .query({ token: firstToken })
        .expect(200);
      expect(stale.body).toEqual({ valid: false, state: "revoked" });

      await api(ctx)
        .post("/auth/accept-invite")
        .send({ token: secondToken, full_name: "Resent", password: PASSWORD })
        .expect(201);
    });

    it("revoke immediately kills a pending invitation and is not repeatable", async () => {
      const email = uniqueEmail("revoke");
      const created = await invite({ email, branch_id: branchId, role: "staff" }).expect(201);
      await waitForEmail(() => ctx.mailer.lastTo(email));
      const token = ctx.mailer.tokenFor(email)!;

      await authed(ctx, admin).post(`/auth/team/${created.body.invitation.id}/revoke`).expect(200);

      await api(ctx)
        .post("/auth/accept-invite")
        .send({ token, full_name: "Too Late", password: PASSWORD })
        .expect(400);

      const second = await authed(ctx, admin)
        .post(`/auth/team/${created.body.invitation.id}/revoke`)
        .expect(409);
      expect(second.body.code).toBe("INVALID_INVITATION");
    });

    it("returns 404 when another shop's admin targets the invitation", async () => {
      const email = uniqueEmail("crossshop");
      const created = await invite({ email, branch_id: branchId, role: "staff" }).expect(201);
      const intruder = await signUpAdmin(ctx);
      const id = created.body.invitation.id;

      for (const action of ["resend", "revoke"]) {
        const response = await authed(ctx, intruder.session)
          .post(`/auth/team/${id}/${action}`)
          .expect(404);
        expect(response.body.code).toBe("NOT_FOUND");
      }
    });
  });

  describe("audit trail", () => {
    it("records creation and acceptance without ever storing the token", async () => {
      const { session, invitationId } = await inviteAndAccept(ctx, admin);

      const created = await ctx.prisma.authAuditLog.findFirstOrThrow({
        where: { action: "invitation_created", actor_id: admin.user.id },
      });
      expect(created.metadata).toMatchObject({ invitation_id: invitationId });

      const accepted = await ctx.prisma.authAuditLog.findFirstOrThrow({
        where: { action: "invitation_accepted", actor_id: session.user.id },
      });

      const serialized = JSON.stringify([created, accepted]);
      expect(serialized).not.toContain("token_hash");
      expect(serialized).not.toContain(PASSWORD);
    });
  });
});

import { createE2EApp, type E2EContext } from "./create-app";
import {
  PASSWORD,
  api,
  authed,
  inviteAndAccept,
  signUpAdmin,
  type Session,
} from "./auth-helpers";

/**
 * Verifies ADR-005's split between admin deactivation (`account_status`, no
 * expiry) and automatic lockout (`locked_until`, self-expiring). The two must
 * never read or write each other's field.
 */
describe("Account deactivation (e2e)", () => {
  let ctx: E2EContext;
  let admin: Session;

  beforeAll(async () => {
    ctx = await createE2EApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    ctx.mailer.reset();
    admin = (await signUpAdmin(ctx)).session;
  });

  it("rejects an existing access token on the very next request", async () => {
    const { session } = await inviteAndAccept(ctx, admin);
    await authed(ctx, session).get("/auth/me").expect(200);

    await authed(ctx, admin)
      .patch(`/auth/accounts/${session.user.id}/status`)
      .send({ account_status: "inactive" })
      .expect(200);

    // The token is still well within its 15-minute lifetime.
    const blocked = await authed(ctx, session).get("/auth/me").expect(403);
    expect(blocked.body.code).toBe("ACCOUNT_NOT_ACTIVE");
  });

  it("revokes every refresh token and blocks a fresh sign-in", async () => {
    const { email, session } = await inviteAndAccept(ctx, admin);

    await authed(ctx, admin)
      .patch(`/auth/accounts/${session.user.id}/status`)
      .send({ account_status: "inactive" })
      .expect(200);

    await api(ctx)
      .post("/auth/refresh")
      .send({ refresh_token: session.refresh_token })
      .expect(401);

    const signIn = await api(ctx)
      .post("/auth/sign-in")
      .send({ email, password: PASSWORD })
      .expect(403);
    expect(signIn.body.code).toBe("ACCOUNT_NOT_ACTIVE");
    expect(signIn.body.access_token).toBeUndefined();
  });

  it("leaves locked_until untouched across a deactivate/reactivate cycle", async () => {
    const { session } = await inviteAndAccept(ctx, admin);
    const lockedUntil = new Date(Date.now() + 60 * 60 * 1000);
    await ctx.prisma.profile.update({
      where: { id: session.user.id },
      data: { locked_until: lockedUntil, failed_login_count: 5 },
    });

    for (const status of ["inactive", "active"]) {
      await authed(ctx, admin)
        .patch(`/auth/accounts/${session.user.id}/status`)
        .send({ account_status: status })
        .expect(200);
    }

    const after = await ctx.prisma.profile.findUniqueOrThrow({ where: { id: session.user.id } });
    expect(after.locked_until?.toISOString()).toBe(lockedUntil.toISOString());
    expect(after.failed_login_count).toBe(5);
    expect(after.account_status).toBe("active");
  });

  it("reports a locked-but-active account as ACCOUNT_LOCKED, not ACCOUNT_NOT_ACTIVE", async () => {
    const { email, session } = await inviteAndAccept(ctx, admin);
    await ctx.prisma.profile.update({
      where: { id: session.user.id },
      data: { locked_until: new Date(Date.now() + 60 * 60 * 1000) },
    });

    const response = await api(ctx)
      .post("/auth/sign-in")
      .send({ email, password: PASSWORD })
      .expect(403);
    expect(response.body.code).toBe("ACCOUNT_LOCKED");
  });

  it("reports an inactive-but-unlocked account as ACCOUNT_NOT_ACTIVE", async () => {
    const { email, session } = await inviteAndAccept(ctx, admin);
    await authed(ctx, admin)
      .patch(`/auth/accounts/${session.user.id}/status`)
      .send({ account_status: "inactive" })
      .expect(200);

    const response = await api(ctx)
      .post("/auth/sign-in")
      .send({ email, password: PASSWORD })
      .expect(403);
    expect(response.body.code).toBe("ACCOUNT_NOT_ACTIVE");
  });

  it("does not resurrect old sessions on reactivation", async () => {
    const { email, session } = await inviteAndAccept(ctx, admin);

    for (const status of ["inactive", "active"]) {
      await authed(ctx, admin)
        .patch(`/auth/accounts/${session.user.id}/status`)
        .send({ account_status: status })
        .expect(200);
    }

    await api(ctx)
      .post("/auth/refresh")
      .send({ refresh_token: session.refresh_token })
      .expect(401);
    await api(ctx).post("/auth/sign-in").send({ email, password: PASSWORD }).expect(200);
  });

  it("is idempotent: repeating the same status writes no second audit row", async () => {
    const { session } = await inviteAndAccept(ctx, admin);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await authed(ctx, admin)
        .patch(`/auth/accounts/${session.user.id}/status`)
        .send({ account_status: "inactive" })
        .expect(200);
    }

    const audit = await ctx.prisma.authAuditLog.findMany({
      where: { action: "account_status_changed", target_id: session.user.id },
    });
    expect(audit).toHaveLength(1);
  });

  it("rejects a status value outside active|inactive", async () => {
    const { session } = await inviteAndAccept(ctx, admin);
    await authed(ctx, admin)
      .patch(`/auth/accounts/${session.user.id}/status`)
      .send({ account_status: "pending" })
      .expect(400);
  });
});

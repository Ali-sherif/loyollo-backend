import * as crypto from "../src/common/crypto.util";
import { THROTTLER_POLICIES } from "../src/rate-limit/throttlers";
import { createE2EApp, type E2EContext } from "./create-app";
import { PASSWORD, api, signUpAdmin, uniqueEmail, waitForEmail } from "./auth-helpers";

const STRICT_LIMIT = THROTTLER_POLICIES["auth-strict"].limit;

/**
 * Verifies docs/backend/forgot-password-security.md. The property under test is
 * that an attacker learns nothing from the response, the timing, or the side
 * effects — not merely that the happy path works.
 */
describe("Forgot password anti-enumeration (e2e)", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await createE2EApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(() => ctx.mailer.reset());

  it("returns a byte-identical body for a known and an unknown address", async () => {
    const { email } = await signUpAdmin(ctx);

    const known = await api(ctx).post("/auth/forgot-password").send({ email }).expect(200);
    const unknown = await api(ctx)
      .post("/auth/forgot-password")
      .send({ email: uniqueEmail("ghost") })
      .expect(200);

    expect(known.text).toBe(unknown.text);
  });

  it("mints exactly one reset token for a known address and none for an unknown one", async () => {
    const { email, session } = await signUpAdmin(ctx);
    const before = await ctx.prisma.passwordResetToken.count();

    await api(ctx).post("/auth/forgot-password").send({ email }).expect(200);
    await api(ctx)
      .post("/auth/forgot-password")
      .send({ email: uniqueEmail("ghost") })
      .expect(200);

    const mine = await ctx.prisma.passwordResetToken.count({
      where: { profile_id: session.user.id },
    });
    expect(mine).toBe(1);
    // A token for a non-existent account would be a live, redeemable credential,
    // so the unknown-address request must add nothing at all.
    expect(await ctx.prisma.passwordResetToken.count()).toBe(before + 1);
  });

  it("does the same token-generation work on the unknown-address branch", async () => {
    const generate = jest.spyOn(crypto, "generateRawToken");
    const hash = jest.spyOn(crypto, "sha256");

    try {
      generate.mockClear();
      hash.mockClear();
      await api(ctx).post("/auth/forgot-password").send({ email: uniqueEmail("ghost") }).expect(200);
      const unknownGenerates = generate.mock.calls.length;
      const unknownHashes = hash.mock.calls.length;

      const { email } = await signUpAdmin(ctx);
      generate.mockClear();
      hash.mockClear();
      await api(ctx).post("/auth/forgot-password").send({ email }).expect(200);

      // The known branch additionally persists and emails, so it may hash more —
      // the point is the unknown branch is not skipping the expensive work.
      expect(unknownGenerates).toBeGreaterThanOrEqual(1);
      expect(unknownGenerates).toBe(generate.mock.calls.length);
      expect(unknownHashes).toBeGreaterThanOrEqual(1);
    } finally {
      generate.mockRestore();
      hash.mockRestore();
    }
  });

  it("responds without waiting for the mail provider", async () => {
    const { email } = await signUpAdmin(ctx);
    ctx.mailer.delayMs = 1_500;

    const startedAt = Date.now();
    await api(ctx).post("/auth/forgot-password").send({ email }).expect(200);
    const elapsed = Date.now() - startedAt;

    expect(elapsed).toBeLessThan(1_000);
    await waitForEmail(() => ctx.mailer.lastTo(email), 5_000);
  });

  it("does not write an audit row for a reset request", async () => {
    const { email, session } = await signUpAdmin(ctx);
    await api(ctx).post("/auth/forgot-password").send({ email }).expect(200);

    const audit = await ctx.prisma.authAuditLog.findMany({
      where: { actor_id: session.user.id, action: "password_reset" },
    });
    expect(audit).toHaveLength(0);
  });

  it("emails a link whose token is only ever stored hashed", async () => {
    const { email, session } = await signUpAdmin(ctx);
    await api(ctx).post("/auth/forgot-password").send({ email }).expect(200);
    await waitForEmail(() => ctx.mailer.lastTo(email));

    const rawToken = ctx.mailer.tokenFor(email)!;
    expect(rawToken).toBeTruthy();

    const row = await ctx.prisma.passwordResetToken.findFirstOrThrow({
      where: { profile_id: session.user.id },
    });
    expect(row.token_hash).not.toBe(rawToken);
    expect(row.token_hash).toBe(crypto.sha256(rawToken));
  });

  describe("reset-password", () => {
    it("sets the new password, revokes every old session, and is single-use", async () => {
      const { email, session } = await signUpAdmin(ctx);
      await api(ctx).post("/auth/forgot-password").send({ email }).expect(200);
      await waitForEmail(() => ctx.mailer.lastTo(email));
      const token = ctx.mailer.tokenFor(email)!;
      const newPassword = "a-fresh-reset-password";

      const reset = await api(ctx)
        .post("/auth/reset-password")
        .send({ token, password: newPassword })
        .expect(200);
      expect(reset.body.access_token).toEqual(expect.any(String));

      // The session that existed before the reset must not survive it.
      await api(ctx)
        .post("/auth/refresh")
        .send({ refresh_token: session.refresh_token })
        .expect(401);

      await api(ctx).post("/auth/sign-in").send({ email, password: newPassword }).expect(200);
      await api(ctx).post("/auth/sign-in").send({ email, password: PASSWORD }).expect(401);

      const replay = await api(ctx)
        .post("/auth/reset-password")
        .send({ token, password: "yet-another-password" })
        .expect(400);
      expect(replay.body.code).toBe("INVALID_TOKEN");
    });

    it("clears an active lockout so a locked-out user can recover", async () => {
      const { email, session } = await signUpAdmin(ctx);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await api(ctx).post("/auth/sign-in").send({ email, password: "wrong-password-value" });
      }

      await api(ctx).post("/auth/forgot-password").send({ email }).expect(200);
      await waitForEmail(() => ctx.mailer.lastTo(email));
      await api(ctx)
        .post("/auth/reset-password")
        .send({ token: ctx.mailer.tokenFor(email)!, password: "recovered-password-x" })
        .expect(200);

      const profile = await ctx.prisma.profile.findUniqueOrThrow({
        where: { id: session.user.id },
      });
      expect(profile.locked_until).toBeNull();
      expect(profile.failed_login_count).toBe(0);
    });

    it("rejects an unknown token", async () => {
      const response = await api(ctx)
        .post("/auth/reset-password")
        .send({ token: "not-a-real-token", password: "some-valid-password" })
        .expect(400);
      expect(response.body.code).toBe("INVALID_TOKEN");
    });
  });

  describe("rate limiting", () => {
    it("throttles existing and non-existing emails identically", async () => {
      await ctx.redis.flushdb();
      const { email } = await signUpAdmin(ctx);
      const unknown = uniqueEmail("ghost");

      const burn = async (address: string) => {
        for (let attempt = 0; attempt < STRICT_LIMIT; attempt += 1) {
          await api(ctx).post("/auth/forgot-password").send({ email: address }).expect(200);
        }
        return api(ctx).post("/auth/forgot-password").send({ email: address });
      };

      const knownBlocked = await burn(email);
      const unknownBlocked = await burn(unknown);

      expect(knownBlocked.status).toBe(429);
      expect(unknownBlocked.status).toBe(429);
      expect(knownBlocked.body.code).toBe("RATE_LIMIT_EXCEEDED");
      expect(unknownBlocked.body.code).toBe(knownBlocked.body.code);
      expect(unknownBlocked.body.message).toBe(knownBlocked.body.message);
      expect(typeof unknownBlocked.body.details.retry_after_seconds).toBe("number");
    });

    it("fails closed when Redis is down, same as other auth-strict routes", async () => {
      const isolated = await createE2EApp({ resetRateLimits: false });
      try {
        isolated.redis.disconnect();
        const response = await api(isolated)
          .post("/auth/forgot-password")
          .send({ email: uniqueEmail("down") });
        expect(response.status).toBe(503);
        expect(response.body.code).toBe("RATE_LIMIT_STORE_UNAVAILABLE");
      } finally {
        await isolated.close().catch(() => undefined);
      }
    });
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createE2EApp, type E2EContext } from "./create-app";
import {
  PASSWORD,
  api,
  authed,
  signUpAdmin,
  signUpBody,
  uniqueEmail,
  type Session,
} from "./auth-helpers";
import { THROTTLER_POLICIES } from "../src/rate-limit/throttlers";

const STRICT_LIMIT = THROTTLER_POLICIES["auth-strict"].limit;
const SELF_LIMIT = THROTTLER_POLICIES["authenticated-self"].limit;

/** Verifies ADR-020. */
describe("Rate limiting (e2e)", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await createE2EApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await ctx.redis.flushdb();
  });

  function signIn(email: string) {
    return api(ctx).post("/auth/sign-in").send({ email, password: "wrong-password-value" });
  }

  it("refuses the attempt after the account limit with a 429 envelope", async () => {
    const email = uniqueEmail("throttled");

    for (let attempt = 0; attempt < STRICT_LIMIT; attempt += 1) {
      expect((await signIn(email)).status).toBe(401);
    }

    const blocked = await signIn(email);
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(blocked.body.details.retry_after_seconds).toBeGreaterThan(0);
    expect(Number(blocked.headers["retry-after"])).toBe(
      blocked.body.details.retry_after_seconds,
    );
  });

  it("derives retry_after_seconds from live TTL state, not a constant", async () => {
    const email = uniqueEmail("ttl");
    for (let attempt = 0; attempt <= STRICT_LIMIT; attempt += 1) await signIn(email);

    const first = await signIn(email);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const later = await signIn(email);

    expect(later.body.details.retry_after_seconds).toBeLessThan(
      first.body.details.retry_after_seconds,
    );
  });

  it("keeps counters separate per email on the same address", async () => {
    const victim = uniqueEmail("victim");
    for (let attempt = 0; attempt <= STRICT_LIMIT; attempt += 1) await signIn(victim);
    expect((await signIn(victim)).status).toBe(429);

    // A different account from the same host is unaffected by the account bucket.
    expect((await signIn(uniqueEmail("bystander"))).status).toBe(401);
  });

  it("keeps counters separate per route", async () => {
    const email = uniqueEmail("perroute");
    for (let attempt = 0; attempt <= STRICT_LIMIT; attempt += 1) await signIn(email);
    expect((await signIn(email)).status).toBe(429);

    // sign-up shares the policy but not the bucket.
    const signUp = await api(ctx)
      .post("/auth/sign-up")
      .send(signUpBody(uniqueEmail("perroute-signup")));
    expect(signUp.status).toBe(201);
  });

  it("applies the address layer to a sweep across many different emails", async () => {
    const ipLimit = THROTTLER_POLICIES["auth-strict-ip"].limit;
    let sawRateLimit = false;

    for (let attempt = 0; attempt <= ipLimit; attempt += 1) {
      const response = await signIn(uniqueEmail(`sweep-${attempt}`));
      if (response.status === 429) {
        sawRateLimit = true;
        break;
      }
    }

    // Each request uses a fresh email, so only the address bucket can stop this.
    expect(sawRateLimit).toBe(true);
  });

  it("buckets authenticated self-service by user, not by address", async () => {
    const first = (await signUpAdmin(ctx)).session;
    const second = (await signUpAdmin(ctx)).session;

    const attempt = (session: Session) =>
      authed(ctx, session)
        .post("/auth/change-password")
        .send({ current_password: "wrong-password-value", new_password: "another-password-1" });

    for (let i = 0; i < SELF_LIMIT; i += 1) {
      expect((await attempt(first)).status).toBe(401);
    }
    expect((await attempt(first)).status).toBe(429);
    // Same host, different caller: their own budget is untouched.
    expect((await attempt(second)).status).toBe(401);
  });

  it("throttles before authenticating, so a flood never reaches the database", async () => {
    const attempt = () =>
      api(ctx)
        .post("/auth/change-password")
        .set("authorization", "Bearer not-a-valid-token")
        .send({ current_password: "whatever-value-1", new_password: "whatever-value-2" });

    for (let i = 0; i < SELF_LIMIT; i += 1) {
      // Unauthenticated, so the policy falls back to the address bucket.
      expect((await attempt()).status).toBe(401);
    }
    // A 401 here would mean the auth guard ran first and the limiter never saw it.
    expect((await attempt()).status).toBe(429);
  });

  it("shares counters across application instances through Redis", async () => {
    const email = uniqueEmail("shared");
    for (let attempt = 0; attempt <= STRICT_LIMIT; attempt += 1) await signIn(email);
    expect((await signIn(email)).status).toBe(429);

    const second = await createE2EApp({ resetRateLimits: false });
    try {
      // A second instance must inherit the count, so this is not in-process state.
      const response = await api(second)
        .post("/auth/sign-in")
        .send({ email, password: "wrong-password-value" });
      expect(response.status).toBe(429);
    } finally {
      await second.close();
    }
  });

  it("has no in-memory fallback anywhere in the rate-limit module", () => {
    const source = readFileSync(
      join(__dirname, "..", "src", "rate-limit", "rate-limit.module.ts"),
      "utf8",
    );
    expect(source).not.toContain("ThrottlerStorageService");
    expect(source).toContain("ThrottlerStorageRedisService");
  });

  it("does not branch fail-closed on NODE_ENV — auth policies always fail closed", () => {
    for (const file of [
      "route-aware-throttler.guard.ts",
      "throttlers.ts",
      "rate-limit.module.ts",
    ]) {
      const source = readFileSync(join(__dirname, "..", "src", "rate-limit", file), "utf8");
      expect(source).not.toMatch(/NODE_ENV/);
    }
    expect(THROTTLER_POLICIES["auth-strict"].failClosed).toBe(true);
    expect(THROTTLER_POLICIES["auth-strict-ip"].failClosed).toBe(true);
    expect(THROTTLER_POLICIES.default.failClosed).toBe(false);
  });

  describe("when Redis is unreachable", () => {
    it.each(["development", "production"] as const)(
      "fails closed on auth routes in NODE_ENV=%s",
      async (nodeEnv) => {
        const previous = process.env.NODE_ENV;
        process.env.NODE_ENV = nodeEnv;
        const isolated = await createE2EApp({ resetRateLimits: false });
        try {
          // Sever the client the guard depends on, without stopping the shared
          // container that other workers are using.
          isolated.redis.disconnect();

          const signInResponse = await api(isolated)
            .post("/auth/sign-in")
            .send({ email: uniqueEmail("down"), password: PASSWORD });
          expect(signInResponse.status).toBe(503);
          expect(signInResponse.body.code).toBe("RATE_LIMIT_STORE_UNAVAILABLE");
        } finally {
          process.env.NODE_ENV = previous;
          await isolated.close().catch(() => undefined);
        }
      },
    );

    it("still reports health when Redis is down, without an in-memory limiter", async () => {
      const isolated = await createE2EApp({ resetRateLimits: false });
      try {
        isolated.redis.disconnect();

        const health = await api(isolated).get("/health");
        expect(health.status).toBe(503);
        expect(health.body.code).toBe("SERVICE_UNHEALTHY");
        expect(health.body.details).toMatchObject({ db: "up", redis: "down" });
      } finally {
        await isolated.close().catch(() => undefined);
      }
    });
  });
});

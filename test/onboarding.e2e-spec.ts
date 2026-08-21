import { createE2EApp, type E2EContext } from "./create-app";
import {
  authed,
  inviteAndAccept,
  signUpAdmin,
  signUpAdminUnverified,
  type Session,
} from "./auth-helpers";

const DETAILS = {
  num_locations: "1",
  main_location: "Cairo",
  avg_customers_per_day: "50-100",
  avg_cheque_per_day: "120",
  currency: "EGP",
  website: "https://shop.example",
};

const STATE_KEYS = [
  "onboarding_completed",
  "num_locations",
  "main_location",
  "website",
  "avg_customers_per_day",
  "avg_cheque_per_day",
  "currency",
  "business_name",
  "business_category",
  "business_type",
  "plan",
] as const;

async function fillStepsThroughPlan(ctx: E2EContext, session: Session, plan = "premium") {
  const client = authed(ctx, session);
  await client.patch("/api/onboarding/details").send(DETAILS).expect(200);
  await client
    .patch("/api/onboarding/business-type")
    .send({ business_category: "Retail" })
    .expect(200);
  await client
    .patch("/api/onboarding/industry")
    .send({ business_type: "Grocery / Supermarket" })
    .expect(200);
  return client.patch("/api/onboarding/plan").send({ plan }).expect(200);
}

async function waitForBlockedOnboardingLocks(ctx: E2EContext, expected: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const rows = await ctx.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS "count"
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
        AND query LIKE '%FROM "profiles"%FOR UPDATE%'
    `;
    if (Number(rows[0]?.count ?? 0) >= expected) return;
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${expected} blocked onboarding row lock(s)`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("Onboarding (e2e)", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await createE2EApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe("shop buyer", () => {
    it("runs details → type → industry → plan → complete, and plan does not flip the flag", async () => {
      const { session } = await signUpAdmin(ctx);

      const me = await authed(ctx, session).get("/auth/me").expect(200);
      expect(me.body.user.onboarding_completed).toBe(false);
      expect(me.body.user).not.toHaveProperty("onboarding_completed", undefined);

      const empty = await authed(ctx, session).get("/api/onboarding").expect(200);
      expect(Object.keys(empty.body).sort()).toEqual([...STATE_KEYS].sort());
      expect(empty.body.onboarding_completed).toBe(false);
      expect(empty.body.plan).toBeNull();

      const planned = await fillStepsThroughPlan(ctx, session, "premium");
      expect(planned.body.onboarding_completed).toBe(false);
      expect(planned.body.plan).toBe("premium");
      expect(planned.body.currency).toBe("EGP");
      expect(planned.body.business_category).toBe("Retail");
      expect(planned.body.business_type).toBe("Grocery / Supermarket");

      const stillOpen = await authed(ctx, session).get("/auth/me").expect(200);
      expect(stillOpen.body.user.onboarding_completed).toBe(false);

      const completed = await authed(ctx, session).post("/api/onboarding/complete").expect(200);
      expect(completed.body.onboarding_completed).toBe(true);

      const live = await authed(ctx, session).get("/auth/me").expect(200);
      expect(live.body.user.onboarding_completed).toBe(true);

      const again = await authed(ctx, session).post("/api/onboarding/complete").expect(200);
      expect(again.body.onboarding_completed).toBe(true);
    });

    it("allows changing plan downward while incomplete", async () => {
      const { session } = await signUpAdmin(ctx);
      await fillStepsThroughPlan(ctx, session, "premium");

      const response = await authed(ctx, session)
        .patch("/api/onboarding/plan")
        .send({ plan: "starter" })
        .expect(200);
      expect(response.body.plan).toBe("starter");
      expect(response.body.onboarding_completed).toBe(false);
      expect(response.body.code).toBeUndefined();
    });

    it("validates ISO currency and normalizes an optional website", async () => {
      const { session } = await signUpAdmin(ctx);
      const client = authed(ctx, session);

      const invalidCurrency = await client
        .patch("/api/onboarding/details")
        .send({ ...DETAILS, currency: "ZZZ" })
        .expect(400);
      expect(invalidCurrency.body.code).toBe("VALIDATION_FAILED");

      const normalized = await client
        .patch("/api/onboarding/details")
        .send({ ...DETAILS, currency: "egp", website: "  loyollo.com/store  " })
        .expect(200);
      expect(normalized.body.currency).toBe("EGP");
      expect(normalized.body.website).toBe("https://loyollo.com/store");

      const preserved = await client
        .patch("/api/onboarding/details")
        .send({ ...DETAILS, website: "   " })
        .expect(200);
      expect(preserved.body.website).toBe("https://loyollo.com/store");

      for (const website of ["hello", "ftp://example.com", "javascript:alert(1)"]) {
        const invalidWebsite = await client
          .patch("/api/onboarding/details")
          .send({ ...DETAILS, website })
          .expect(400);
        expect(invalidWebsite.body.code).toBe("VALIDATION_FAILED");
      }
    });

    it("rejects complete when required fields are missing", async () => {
      const { session } = await signUpAdmin(ctx);
      const response = await authed(ctx, session).post("/api/onboarding/complete").expect(400);
      expect(response.body.code).toBe("ONBOARDING_INCOMPLETE");
      expect(response.body.details.missing).toEqual(
        expect.arrayContaining(["currency", "plan", "business_category"]),
      );
    });

    it("rejects an unknown industry", async () => {
      const { session } = await signUpAdmin(ctx);
      await authed(ctx, session).patch("/api/onboarding/details").send(DETAILS).expect(200);
      await authed(ctx, session)
        .patch("/api/onboarding/business-type")
        .send({ business_category: "Retail" })
        .expect(200);

      const response = await authed(ctx, session)
        .patch("/api/onboarding/industry")
        .send({ business_type: "Not a real industry" })
        .expect(400);
      expect(response.body.code).toBe("BUSINESS_INDUSTRY_INVALID");
    });

    it("locks currency and other mutations after complete", async () => {
      const { session } = await signUpAdmin(ctx);
      await fillStepsThroughPlan(ctx, session);
      await authed(ctx, session).post("/api/onboarding/complete").expect(200);

      const currency = await authed(ctx, session)
        .patch("/api/onboarding/details")
        .send({ ...DETAILS, currency: "USD" })
        .expect(400);
      expect(currency.body.code).toBe("CURRENCY_LOCKED");

      const plan = await authed(ctx, session)
        .patch("/api/onboarding/plan")
        .send({ plan: "growth" })
        .expect(403);
      expect(plan.body.code).toBe("ONBOARDING_NOT_APPLICABLE");

      const type = await authed(ctx, session)
        .patch("/api/onboarding/business-type")
        .send({ business_category: "Automotive" })
        .expect(403);
      expect(type.body.code).toBe("ONBOARDING_NOT_APPLICABLE");
    });

    it("serializes a Business Type mutation ahead of completion", async () => {
      const { session } = await signUpAdmin(ctx);
      await fillStepsThroughPlan(ctx, session);

      let releaseRowLock!: () => void;
      const holdRowLock = new Promise<void>((resolve) => {
        releaseRowLock = resolve;
      });
      let rowLocked!: () => void;
      const rowLockAcquired = new Promise<void>((resolve) => {
        rowLocked = resolve;
      });

      const lockTransaction = ctx.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "id"
          FROM "profiles"
          WHERE "id" = ${session.user.id}::uuid
          FOR UPDATE
        `;
        rowLocked();
        await holdRowLock;
      });

      await rowLockAcquired;
      const queuedType = Promise.resolve(
        authed(ctx, session)
          .patch("/api/onboarding/business-type")
          .send({ business_category: "Automotive" }),
      );
      await waitForBlockedOnboardingLocks(ctx, 1);
      const queuedComplete = Promise.resolve(
        authed(ctx, session).post("/api/onboarding/complete"),
      );
      let results: [Awaited<typeof queuedType>, Awaited<typeof queuedComplete>] | undefined;
      try {
        await waitForBlockedOnboardingLocks(ctx, 2);
        releaseRowLock();
        results = await Promise.all([queuedType, queuedComplete]);
      } finally {
        releaseRowLock();
        await Promise.allSettled([queuedType, queuedComplete]);
        await lockTransaction;
      }

      if (!results) throw new Error("concurrent onboarding requests did not complete");
      const [type, complete] = results;

      expect(type.status).toBe(200);
      expect(type.body.business_category).toBe("Automotive");
      expect(type.body.business_type).toBeNull();
      expect(complete.status).toBe(400);
      expect(complete.body.code).toBe("ONBOARDING_INCOMPLETE");
      expect(complete.body.details.missing).toContain("business_type");

      const state = await authed(ctx, session).get("/api/onboarding").expect(200);
      expect(state.body.onboarding_completed).toBe(false);
      expect(state.body.business_category).toBe("Automotive");
      expect(state.body.business_type).toBeNull();
    });

    it("rejects an unverified buyer", async () => {
      const { session } = await signUpAdminUnverified(ctx);
      const response = await authed(ctx, session).get("/api/onboarding").expect(403);
      expect(response.body.code).toBe("EMAIL_NOT_VERIFIED");
    });

    it("does not put onboarding_completed on the access token", async () => {
      const { session } = await signUpAdmin(ctx);
      const payload = JSON.parse(
        Buffer.from(session.access_token.split(".")[1], "base64url").toString("utf8"),
      ) as Record<string, unknown>;
      expect(payload).not.toHaveProperty("onboarding_completed");
    });
  });

  describe("invitees", () => {
    it("marks staff complete on accept-invite and forbids onboarding APIs", async () => {
      const admin = (await signUpAdmin(ctx)).session;
      const { session } = await inviteAndAccept(ctx, admin, { role: "staff" });

      expect(session.user.onboarding_completed).toBe(true);
      expect(session.user.owner_id).not.toBe(session.user.id);

      const get = await authed(ctx, session).get("/api/onboarding").expect(403);
      expect(get.body.code).toBe("ONBOARDING_NOT_APPLICABLE");

      const patch = await authed(ctx, session)
        .patch("/api/onboarding/details")
        .send(DETAILS)
        .expect(403);
      expect(patch.body.code).toBe("ONBOARDING_NOT_APPLICABLE");

      const complete = await authed(ctx, session).post("/api/onboarding/complete").expect(403);
      expect(complete.body.code).toBe("ONBOARDING_NOT_APPLICABLE");
    });

    it("also forbids invited admin", async () => {
      const admin = (await signUpAdmin(ctx)).session;
      const { session } = await inviteAndAccept(ctx, admin, { role: "admin" });

      expect(session.user.onboarding_completed).toBe(true);
      expect(session.user.role).toBe("admin");
      expect(session.user.owner_id).not.toBe(session.user.id);

      const response = await authed(ctx, session).get("/api/onboarding").expect(403);
      expect(response.body.code).toBe("ONBOARDING_NOT_APPLICABLE");
    });
  });
});

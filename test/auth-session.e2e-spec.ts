import { createE2EApp, type E2EContext } from "./create-app";
import {
  PASSWORD,
  api,
  authed,
  signUpAdmin,
  signUpBody,
  uniqueEmail,
  waitForEmail,
} from "./auth-helpers";

describe("Auth session lifecycle (e2e)", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await createE2EApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(() => ctx.mailer.reset());

  describe("sign-up", () => {
    it("registers a merchant and persists the required identity and contact fields", async () => {
      const email = uniqueEmail("owner");
      const response = await api(ctx)
        .post("/auth/sign-up")
        .send(
          signUpBody(` ${email.toUpperCase()} `, {
            full_name: " Corner Owner ",
            business_name: " Corner Cafe ",
            phone: " +14165550100 ",
          }),
        )
        .expect(201);

      expect(response.body.user).toMatchObject({
        email,
        role: "admin",
        account_status: "active",
        email_confirmed_at: null,
      });
      // An admin owns their own scope, so `owner_id` resolves to their own id.
      expect(response.body.user.owner_id).toBe(response.body.user.id);
      expect(response.body.permissions).toEqual(
        expect.arrayContaining(["team:invite", "account:status:update"]),
      );
      expect(typeof response.body.access_token).toBe("string");
      expect(typeof response.body.refresh_token).toBe("string");
      const profile = await ctx.prisma.profile.findUniqueOrThrow({ where: { email } });
      expect(profile).toMatchObject({
        full_name: "Corner Owner",
        business_name: "Corner Cafe",
        phone: "+14165550100",
      });
      const mail = await waitForEmail(() => ctx.mailer.lastTo(email));
      expect(mail.templateName).toBe("auth:signup");
      expect(mail.subject).toBe("Confirm your email");
    });

    it("rejects a client-supplied role, account_status, or owner_id", async () => {
      for (const override of [
        { role: "admin" },
        { account_status: "active" },
        { owner_id: "00000000-0000-0000-0000-000000000000" },
        { shop_id: "00000000-0000-0000-0000-000000000000" },
      ]) {
        const response = await api(ctx)
          .post("/auth/sign-up")
          .send(signUpBody(uniqueEmail("escalate"), override))
          .expect(400);
        expect(response.body.code).toBe("VALIDATION_FAILED");
      }
    });

    it("enforces the 12-character minimum password", async () => {
      const response = await api(ctx)
        .post("/auth/sign-up")
        .send(
          signUpBody(uniqueEmail("weak"), {
            password: "short",
            confirm_password: "short",
          }),
        )
        .expect(400);
      expect(response.body.code).toBe("VALIDATION_FAILED");
    });

    it("requires names, phone, matching password confirmation, and both consents", async () => {
      const email = uniqueEmail("required");
      const response = await api(ctx)
        .post("/auth/sign-up")
        .send(
          signUpBody(email, {
            full_name: "   ",
            business_name: "   ",
            phone: "   ",
            confirm_password: "not-the-password",
            agree_terms: false,
            agree_privacy: false,
          }),
        )
        .expect(400);

      expect(response.body.code).toBe("VALIDATION_FAILED");
      expect(response.body.details.fields.map((field: { field: string }) => field.field)).toEqual(
        expect.arrayContaining([
          "full_name",
          "business_name",
          "phone",
          "confirm_password",
          "agree_terms",
          "agree_privacy",
        ]),
      );
      expect(await ctx.prisma.profile.findUnique({ where: { email } })).toBeNull();
      expect(ctx.mailer.lastTo(email)).toBeUndefined();
    });

    it.each([
      "abc",
      "+",
      "123-456",
      "+1 (416) 555-0100",
      "4165550100",
      "+1416555010",
      "+141655501001",
      "+44165550100",
      "+15550100",
    ])("rejects noncanonical phone value %p", async (phone) => {
      const email = uniqueEmail("invalid-phone");
      const response = await api(ctx)
        .post("/auth/sign-up")
        .send(signUpBody(email, { phone }))
        .expect(400);

      expect(response.body.code).toBe("VALIDATION_FAILED");
      expect(response.body.details.fields).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: "phone" })]),
      );
      expect(await ctx.prisma.profile.findUnique({ where: { email } })).toBeNull();
      expect(ctx.mailer.lastTo(email)).toBeUndefined();
    });

    it.each(["+14165550100", "+12125551234"])(
      "accepts NANP phone value %p",
      async (phone) => {
        const email = uniqueEmail("valid-phone");
        await api(ctx).post("/auth/sign-up").send(signUpBody(email, { phone })).expect(201);

        const profile = await ctx.prisma.profile.findUniqueOrThrow({ where: { email } });
        expect(profile.phone).toBe(phone);
      },
    );

    it("refuses a duplicate email", async () => {
      const { email } = await signUpAdmin(ctx);
      const response = await api(ctx)
        .post("/auth/sign-up")
        .send(signUpBody(email))
        .expect(409);
      expect(response.body.code).toBe("EMAIL_ALREADY_REGISTERED");
    });

    it("never persists a password in plaintext", async () => {
      const { email } = await signUpAdmin(ctx);
      const profile = await ctx.prisma.profile.findUniqueOrThrow({ where: { email } });
      expect(profile.password_hash).not.toContain(PASSWORD);
      expect(profile.password_hash.startsWith("$2")).toBe(true);
    });
  });

  describe("sign-in", () => {
    it("issues a session for valid credentials", async () => {
      const { email } = await signUpAdmin(ctx);
      const response = await api(ctx)
        .post("/auth/sign-in")
        .send({ email, password: PASSWORD })
        .expect(200);
      expect(response.body.user.email).toBe(email);
      expect(typeof response.body.refresh_token).toBe("string");
    });

    it("returns the same generic error for a wrong password and an unknown email", async () => {
      const { email } = await signUpAdmin(ctx);

      const wrongPassword = await api(ctx)
        .post("/auth/sign-in")
        .send({ email, password: "not-the-right-password" })
        .expect(401);
      const unknownEmail = await api(ctx)
        .post("/auth/sign-in")
        .send({ email: uniqueEmail("ghost"), password: PASSWORD })
        .expect(401);

      expect(wrongPassword.body).toEqual(unknownEmail.body);
      expect(wrongPassword.body.code).toBe("INVALID_CREDENTIALS");
    });

    it("locks the account after five failed attempts and reports it distinctly", async () => {
      const { email } = await signUpAdmin(ctx);

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await api(ctx).post("/auth/sign-in").send({ email, password: "wrong-password-value" });
      }

      const locked = await api(ctx)
        .post("/auth/sign-in")
        .send({ email, password: PASSWORD })
        .expect(403);
      expect(locked.body.code).toBe("ACCOUNT_LOCKED");
      expect(locked.body.details.locked_until).toEqual(expect.any(String));

      const profile = await ctx.prisma.profile.findUniqueOrThrow({ where: { email } });
      // Lockout is a system state; it must not touch the admin-controlled field.
      expect(profile.account_status).toBe("active");

      const audit = await ctx.prisma.authAuditLog.findMany({
        where: { actor_id: profile.id, action: "account_locked" },
      });
      expect(audit).toHaveLength(1);
    });

    it("clears the failure counter after a successful sign-in", async () => {
      const { email } = await signUpAdmin(ctx);
      await api(ctx).post("/auth/sign-in").send({ email, password: "wrong-password-value" });
      await api(ctx).post("/auth/sign-in").send({ email, password: PASSWORD }).expect(200);

      const profile = await ctx.prisma.profile.findUniqueOrThrow({ where: { email } });
      expect(profile.failed_login_count).toBe(0);
      expect(profile.locked_until).toBeNull();
    });
  });

  describe("GET /auth/me", () => {
    it("rejects a missing or malformed bearer token", async () => {
      await api(ctx).get("/auth/me").expect(401);
      await api(ctx).get("/auth/me").set("authorization", "Bearer not-a-jwt").expect(401);
      await api(ctx).get("/auth/me").set("authorization", "Basic abc").expect(401);
    });

    it("returns the caller with permissions expanded from their role", async () => {
      const { session } = await signUpAdmin(ctx);
      const response = await authed(ctx, session).get("/auth/me").expect(200);
      expect(response.body.user.id).toBe(session.user.id);
      expect(response.body.permissions).not.toContain("*");
      expect(response.body.permissions).toEqual(
        expect.arrayContaining(["team:invite", "account:status:update"]),
      );
    });
  });

  describe("refresh rotation", () => {
    it("rotates the refresh token and keeps the old one unusable", async () => {
      const { session } = await signUpAdmin(ctx);

      const rotated = await api(ctx)
        .post("/auth/refresh")
        .send({ refresh_token: session.refresh_token })
        .expect(200);
      expect(rotated.body.refresh_token).not.toBe(session.refresh_token);

      await api(ctx)
        .post("/auth/refresh")
        .send({ refresh_token: rotated.body.refresh_token })
        .expect(200);
    });

    it("kills the whole family when a rotated token is replayed", async () => {
      const { session } = await signUpAdmin(ctx);
      const rotated = await api(ctx)
        .post("/auth/refresh")
        .send({ refresh_token: session.refresh_token })
        .expect(200);

      const replay = await api(ctx)
        .post("/auth/refresh")
        .send({ refresh_token: session.refresh_token })
        .expect(401);
      expect(replay.body.code).toBe("INVALID_TOKEN");

      // The live token from the same chain must die alongside the replayed one.
      await api(ctx)
        .post("/auth/refresh")
        .send({ refresh_token: rotated.body.refresh_token })
        .expect(401);

      const audit = await ctx.prisma.authAuditLog.findMany({
        where: { actor_id: session.user.id, action: "refresh_reuse_detected" },
      });
      expect(audit.length).toBeGreaterThanOrEqual(1);
    });

    it("stores only a hash of the refresh token", async () => {
      const { session } = await signUpAdmin(ctx);
      const rows = await ctx.prisma.refreshToken.findMany({
        where: { profile_id: session.user.id, revoked_at: null },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].token_hash).not.toBe(session.refresh_token);
      expect(rows[0].token_hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("rejects an unknown refresh token", async () => {
      await api(ctx).post("/auth/refresh").send({ refresh_token: "nope" }).expect(401);
    });
  });

  describe("sign-out", () => {
    it("revokes only the presented session", async () => {
      const { email, session } = await signUpAdmin(ctx);
      const second = await api(ctx)
        .post("/auth/sign-in")
        .send({ email, password: PASSWORD })
        .expect(200);

      await authed(ctx, session)
        .post("/auth/sign-out")
        .send({ refresh_token: session.refresh_token })
        .expect(204);

      // The other device keeps working. Checked before replaying the revoked
      // token, because that replay is treated as reuse and kills the family.
      await api(ctx)
        .post("/auth/refresh")
        .send({ refresh_token: second.body.refresh_token })
        .expect(200);
      await api(ctx)
        .post("/auth/refresh")
        .send({ refresh_token: session.refresh_token })
        .expect(401);
    });

    it("sign-out-all revokes every session and is audited", async () => {
      const { email, session } = await signUpAdmin(ctx);
      const second = await api(ctx)
        .post("/auth/sign-in")
        .send({ email, password: PASSWORD })
        .expect(200);

      const response = await authed(ctx, session).post("/auth/sign-out-all").expect(200);
      expect(response.body.revoked).toBeGreaterThanOrEqual(2);

      await api(ctx)
        .post("/auth/refresh")
        .send({ refresh_token: second.body.refresh_token })
        .expect(401);

      const audit = await ctx.prisma.authAuditLog.findMany({
        where: { actor_id: session.user.id, action: "sign_out_all" },
      });
      expect(audit).toHaveLength(1);
    });
  });

  describe("change-password", () => {
    it("requires the current password", async () => {
      const { session } = await signUpAdmin(ctx);
      const response = await authed(ctx, session)
        .post("/auth/change-password")
        .send({ current_password: "wrong-password-value", new_password: "a-brand-new-password" })
        .expect(401);
      expect(response.body.code).toBe("INVALID_CREDENTIALS");
    });

    it("changes the password, notifies the user, and keeps only the calling session", async () => {
      const { email, session } = await signUpAdmin(ctx);
      const other = await api(ctx)
        .post("/auth/sign-in")
        .send({ email, password: PASSWORD })
        .expect(200);
      const newPassword = "an-entirely-new-password";

      await authed(ctx, session)
        .post("/auth/change-password")
        .send({
          current_password: PASSWORD,
          new_password: newPassword,
          refresh_token: session.refresh_token,
        })
        .expect(200);

      await api(ctx).post("/auth/sign-in").send({ email, password: newPassword }).expect(200);
      await api(ctx).post("/auth/sign-in").send({ email, password: PASSWORD }).expect(401);

      // The calling session survives; check it before the revoked one, whose
      // replay would be read as reuse and revoke everything.
      await api(ctx)
        .post("/auth/refresh")
        .send({ refresh_token: session.refresh_token })
        .expect(200);
      await api(ctx)
        .post("/auth/refresh")
        .send({ refresh_token: other.body.refresh_token })
        .expect(401);

      await waitForEmail(() => ctx.mailer.lastTo(email));
      expect(ctx.mailer.lastTo(email)?.templateName).toBe("transactional:password_changed");
    });
  });
});

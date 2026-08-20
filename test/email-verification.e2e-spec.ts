import { createE2EApp, type E2EContext } from "./create-app";
import {
  PASSWORD,
  api,
  authed,
  inviteAndAccept,
  mainBranchId,
  signUpAdmin,
  signUpAdminUnverified,
  uniqueEmail,
  waitForEmail,
} from "./auth-helpers";

describe("Merchant email verification (e2e)", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await createE2EApp();
  });

  afterAll(async () => ctx.close());
  beforeEach(() => ctx.mailer.reset());

  it("emails on sign-up and gates merchant APIs while session routes remain available", async () => {
    const { email, session } = await signUpAdminUnverified(ctx);
    expect(session.user.email_confirmed_at).toBeNull();

    const mail = await waitForEmail(() => ctx.mailer.lastTo(email));
    expect(mail.templateName).toBe("auth:signup");
    expect(mail.subject).toBe("Confirm your email");
    expect(mail.html).toContain("/auth/verify?token=");

    const me = await authed(ctx, session).get("/auth/me").expect(200);
    expect(me.body.user.email_confirmed_at).toBeNull();

    const branchId = await mainBranchId(ctx, session.user.owner_id);
    const gated = await authed(ctx, session)
      .post("/auth/team")
      .send({ email: uniqueEmail("staff"), branch_id: branchId, role: "staff" })
      .expect(403);
    expect(gated.body.code).toBe("EMAIL_NOT_VERIFIED");

    const signedIn = await api(ctx)
      .post("/auth/sign-in")
      .send({ email, password: PASSWORD })
      .expect(200);
    expect(signedIn.body.user.email_confirmed_at).toBeNull();

    await authed(ctx, session)
      .post("/auth/sign-out")
      .send({ refresh_token: session.refresh_token })
      .expect(204);
  });

  it("atomically verifies once and returns a confirmed replacement session", async () => {
    const { email } = await signUpAdminUnverified(ctx);
    const token = await waitForEmail(() => ctx.mailer.tokenFor(email) ?? undefined);

    const verified = await api(ctx).post("/auth/verify-email").send({ token }).expect(200);
    expect(verified.body.user.email_confirmed_at).toEqual(expect.any(String));

    const reused = await api(ctx).post("/auth/verify-email").send({ token }).expect(400);
    expect(reused.body.code).toBe("INVALID_TOKEN");

    const invalid = await api(ctx)
      .post("/auth/verify-email")
      .send({ token: "unknown-token" })
      .expect(400);
    expect(invalid.body.code).toBe("INVALID_TOKEN");
  });

  it("rejects an expired verification token", async () => {
    const { email, session } = await signUpAdminUnverified(ctx);
    const token = await waitForEmail(() => ctx.mailer.tokenFor(email) ?? undefined);

    await ctx.prisma.emailVerificationToken.updateMany({
      where: { profile_id: session.user.id, used_at: null },
      data: { expires_at: new Date(Date.now() - 1_000) },
    });

    const expired = await api(ctx).post("/auth/verify-email").send({ token }).expect(400);
    expect(expired.body.code).toBe("INVALID_TOKEN");
  });

  it("resend supersedes the old token and keeps the generic response byte-identical", async () => {
    const { email } = await signUpAdminUnverified(ctx);
    const oldToken = await waitForEmail(() => ctx.mailer.tokenFor(email) ?? undefined);
    ctx.mailer.reset();

    const pending = await api(ctx)
      .post("/auth/resend-verification")
      .send({ email })
      .expect(200);
    const resendMail = await waitForEmail(() => ctx.mailer.lastTo(email));
    const newToken = ctx.mailer.tokenFor(email);
    expect(resendMail.templateName).toBe("auth:signup");
    expect(resendMail.subject).toBe("Confirm your email");
    expect(newToken).not.toBe(oldToken);

    await api(ctx).post("/auth/verify-email").send({ token: oldToken }).expect(400);
    await api(ctx).post("/auth/verify-email").send({ token: newToken }).expect(200);

    const verified = await api(ctx)
      .post("/auth/resend-verification")
      .send({ email })
      .expect(200);
    const unknown = await api(ctx)
      .post("/auth/resend-verification")
      .send({ email: uniqueEmail("unknown") })
      .expect(200);
    const inactiveEmail = uniqueEmail("inactive");
    await signUpAdminUnverified(ctx, inactiveEmail);
    await ctx.prisma.profile.update({
      where: { email: inactiveEmail },
      data: { account_status: "inactive" },
    });
    const inactive = await api(ctx)
      .post("/auth/resend-verification")
      .send({ email: inactiveEmail })
      .expect(200);
    expect(JSON.stringify(verified.body)).toBe(JSON.stringify(pending.body));
    expect(JSON.stringify(unknown.body)).toBe(JSON.stringify(pending.body));
    expect(JSON.stringify(inactive.body)).toBe(JSON.stringify(pending.body));
  });

  it("treats an accepted invitation as verified", async () => {
    const admin = await signUpAdmin(ctx);
    const accepted = await inviteAndAccept(ctx, admin.session);
    expect(accepted.session.user.email_confirmed_at).toEqual(expect.any(String));
  });
});

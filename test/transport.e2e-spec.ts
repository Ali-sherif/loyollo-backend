import { createE2EApp, type E2EContext } from "./create-app";
import { PASSWORD, api, authed, signUpAdmin, uniqueEmail } from "./auth-helpers";

const ALLOWED_ORIGIN = "http://localhost:3000";
const FOREIGN_ORIGIN = "https://evil.example";

/**
 * ADR-017 / LOYB-16: Nest authenticates mutations with `Authorization: Bearer`
 * only. Cookies are a Next.js concern; a foreign Origin plus a cookie header
 * must not become a session.
 */
describe("Transport security (e2e)", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await createE2EApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("ignores cookies — a session cookie without Bearer is unauthenticated", async () => {
    const { session } = await signUpAdmin(ctx);

    await api(ctx)
      .get("/auth/me")
      .set("Cookie", `access_token=${session.access_token}; refresh_token=${session.refresh_token}`)
      .expect(401);

    await api(ctx)
      .post("/auth/sign-out-all")
      .set("Cookie", `access_token=${session.access_token}`)
      .expect(401);
  });

  it("still authenticates Bearer when a foreign Origin and a forged cookie are present", async () => {
    const { session } = await signUpAdmin(ctx);

    await api(ctx)
      .get("/auth/me")
      .set("authorization", `Bearer ${session.access_token}`)
      .set("Origin", FOREIGN_ORIGIN)
      .set("Cookie", "access_token=forged; refresh_token=forged")
      .expect(200);

    const mutation = await authed(ctx, session)
      .post("/auth/sign-out-all")
      .set("Origin", FOREIGN_ORIGIN)
      .set("Cookie", `access_token=${session.access_token}`)
      .expect(200);
    expect(mutation.body.revoked).toBeGreaterThanOrEqual(1);
  });

  it("does not echo a foreign Origin or allow credentialed CORS", async () => {
    const response = await api(ctx)
      .post("/auth/sign-in")
      .set("Origin", FOREIGN_ORIGIN)
      .set("Cookie", "access_token=forged")
      .send({ email: uniqueEmail("cors"), password: PASSWORD });

    expect(response.headers["access-control-allow-origin"]).not.toBe(FOREIGN_ORIGIN);
    expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("echoes the allow-listed origin without credentials", async () => {
    const response = await api(ctx)
      .options("/auth/sign-in")
      .set("Origin", ALLOWED_ORIGIN)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "authorization,content-type");

    expect(response.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
    expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
    expect(String(response.headers["access-control-allow-headers"] ?? "").toLowerCase()).toContain(
      "authorization",
    );
  });
});

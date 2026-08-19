import { randomUUID } from "node:crypto";
import request from "supertest";
import type TestAgent from "supertest/lib/agent";

import type { E2EContext } from "./create-app";

export const PASSWORD = "correct-horse-battery-staple";

export type Session = {
  user: { id: string; email: string; role: string; account_status: string; owner_id: string };
  permissions: string[];
  access_token: string;
  refresh_token: string;
};

export function api(ctx: E2EContext): TestAgent {
  return request(ctx.app.getHttpServer());
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomUUID()}@example.test`;
}

/** Registers a merchant admin and returns the session the API handed back. */
export async function signUpAdmin(
  ctx: E2EContext,
  email = uniqueEmail("admin"),
): Promise<{ email: string; session: Session }> {
  const response = await api(ctx)
    .post("/auth/sign-up")
    .send({ email, password: PASSWORD, full_name: "Test Shop" });
  if (response.status !== 201) {
    throw new Error(`sign-up failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return { email, session: response.body as Session };
}

/** Sign-up creates exactly one branch per shop; invitations need its id. */
export async function mainBranchId(ctx: E2EContext, shopId: string): Promise<string> {
  const branch = await ctx.prisma.branch.findFirstOrThrow({
    where: { shop_id: shopId },
    select: { id: true },
  });
  return branch.id;
}

/**
 * Runs the full invitation flow and returns the accepted staff member's session,
 * pulling the one-time token out of the captured email exactly like a real user
 * would from their inbox.
 */
export async function inviteAndAccept(
  ctx: E2EContext,
  admin: Session,
  options: { role?: "admin" | "staff"; email?: string } = {},
): Promise<{ email: string; session: Session; invitationId: string }> {
  const email = options.email ?? uniqueEmail("staff");
  const branchId = await mainBranchId(ctx, admin.user.owner_id);

  const created = await api(ctx)
    .post("/auth/team")
    .set("authorization", `Bearer ${admin.access_token}`)
    .send({ email, branch_id: branchId, role: options.role ?? "staff" })
    .expect(201);

  const token = ctx.mailer.tokenFor(email);
  if (!token) throw new Error(`no invitation token was emailed to ${email}`);

  const accepted = await api(ctx)
    .post("/auth/accept-invite")
    .send({ token, full_name: "Test Staff", password: PASSWORD })
    .expect(201);

  return {
    email,
    session: accepted.body as Session,
    invitationId: created.body.invitation.id as string,
  };
}

/**
 * Some sends are deliberately fire-and-forget, so the HTTP response can land
 * before the message does. Poll briefly instead of asserting immediately.
 */
export async function waitForEmail<T>(
  read: () => T | undefined,
  timeoutMs = 2_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting for an email");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export function authed(ctx: E2EContext, session: Session) {
  return {
    get: (path: string) =>
      api(ctx).get(path).set("authorization", `Bearer ${session.access_token}`),
    post: (path: string) =>
      api(ctx).post(path).set("authorization", `Bearer ${session.access_token}`),
    patch: (path: string) =>
      api(ctx).patch(path).set("authorization", `Bearer ${session.access_token}`),
  };
}

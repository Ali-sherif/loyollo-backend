import { hours, minutes, seconds } from "@nestjs/throttler";

/**
 * How a request is bucketed. Nothing here is stored raw: the guard salts and
 * hashes the tracker before it becomes a Redis key, so an operator reading Redis
 * cannot recover an address, an email, or a token.
 */
export type TrackStrategy =
  /** Caller address only. Blunt, and the only option before a body is parsed. */
  | "ip"
  /** Address + submitted email. Stops password spraying one account. */
  | "ip-email"
  /** Address + submitted token. Stops brute-forcing one reset/invite link. */
  | "ip-token"
  /** The presented refresh token. One rotating session, one bucket. */
  | "refresh"
  /** Authenticated caller. Requires the JWT guard to have run first. */
  | "user"
  /** Authenticated caller when known, address otherwise. */
  | "user-or-ip";

export type ThrottlerPolicy = {
  limit: number;
  ttl: number;
  strategy: TrackStrategy;
  /**
   * `false` lets a request through when Redis is unreachable. Only the baseline
   * policy does this — every auth-sensitive policy fails closed (ADR-020 §D).
   */
  failClosed: boolean;
};

export const DEFAULT_THROTTLER = "default";

/**
 * The whole rate-limit configuration, in one table. `docs/backend/rate-limiting.md`
 * mirrors these numbers; change them together.
 *
 * Auth-sensitive routes stack two policies: a loose address-scoped one that stops
 * an attacker sweeping many accounts from one host, and a tight identity-scoped
 * one that stops them grinding a single account. A single combined IP+email
 * tracker would do neither — a sweep never repeats the same email.
 */
export const THROTTLER_POLICIES = {
  /** Baseline applied to every route that does not opt into something stricter. */
  [DEFAULT_THROTTLER]: {
    limit: 120,
    ttl: seconds(60),
    strategy: "user-or-ip",
    failClosed: false,
  },

  /** Sign-in / sign-up / forgot-password, address layer. */
  "auth-strict-ip": { limit: 40, ttl: minutes(15), strategy: "ip", failClosed: true },
  /** Sign-in / sign-up / forgot-password, account layer. */
  "auth-strict": { limit: 8, ttl: minutes(15), strategy: "ip-email", failClosed: true },

  /**
   * Refresh is bucketed per token, not per address: a shared office NATs to one
   * address but each session rotates its own token. 60 per 15 min is far above
   * the ~1 per access-token-lifetime a well-behaved client needs.
   */
  "auth-refresh": { limit: 60, ttl: minutes(15), strategy: "refresh", failClosed: true },

  /** Reset-password / accept-invite, address layer. */
  "auth-reset-ip": { limit: 40, ttl: minutes(15), strategy: "ip", failClosed: true },
  /** Reset-password / accept-invite, token layer. */
  "auth-reset": { limit: 12, ttl: minutes(15), strategy: "ip-token", failClosed: true },

  /** Self-service actions by an authenticated caller, e.g. change-password. */
  "authenticated-self": { limit: 10, ttl: minutes(15), strategy: "user", failClosed: true },

  /** Resending an invitation sends mail, so it is capped per admin per hour. */
  "invite-resend": { limit: 5, ttl: hours(1), strategy: "user", failClosed: true },
} as const satisfies Record<string, ThrottlerPolicy>;

export type ThrottlerName = keyof typeof THROTTLER_POLICIES;

/**
 * Policy bundles referenced from handlers, so a route declares intent
 * (`RATE_LIMITS.authStrict`) rather than restating numbers.
 */
export const RATE_LIMITS = {
  authStrict: ["auth-strict-ip", "auth-strict"],
  authRefresh: ["auth-refresh"],
  authReset: ["auth-reset-ip", "auth-reset"],
  authenticatedSelf: ["authenticated-self"],
  inviteResend: ["invite-resend"],
} as const satisfies Record<string, readonly ThrottlerName[]>;

export function policyFor(name: string): ThrottlerPolicy | undefined {
  return (THROTTLER_POLICIES as Record<string, ThrottlerPolicy>)[name];
}

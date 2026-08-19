import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * 256-bit URL-safe secret. Used for refresh tokens, password-reset tokens, and
 * invitation tokens (ADR-022 §A) — never `Math.random`, never a UUID as a secret.
 */
export function generateRawToken(): string {
  return randomBytes(32).toString("base64url");
}

/** The only form of a secret that is ever persisted. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Constant-time string compare for shared secrets (ADR-018). */
export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  // Compare a fixed-width digest so length differences don't short-circuit.
  return timingSafeEqual(
    createHash("sha256").update(bufA).digest(),
    createHash("sha256").update(bufB).digest(),
  );
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Redacted email for logs (never log a full address — plan §1.7). */
export function redactEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  return `${local[0] ?? "*"}***@${domain}`;
}

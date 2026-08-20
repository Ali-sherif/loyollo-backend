/**
 * Single source of truth for environment-derived settings.
 * Application code reads these through `ConfigService`, never `process.env` directly
 * (ADR-020 §A). Unknown/missing required values fail at boot, not at first request.
 */

export type MailerProvider = "log" | "resend";

export type AppConfig = {
  nodeEnv: string;
  port: number;
  corsOrigins: string[];
  appBaseUrl: string;
  auth: {
    accessSecret: string;
    accessTtl: string;
    refreshTtlDays: number;
    passwordResetTtlMinutes: number;
    invitationTtlHours: number;
    emailVerificationTtlHours: number;
    trackerSalt: string;
    /** Consecutive failed passwords before a temporary lockout. */
    maxFailedLogins: number;
    lockoutMinutes: number;
    bcryptRounds: number;
    minPasswordLength: number;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
    /** Logical database index. e2e workers each take their own so counters never collide. */
    db: number;
  };
  messaging: {
    provider: MailerProvider;
    resendApiKey?: string;
    from: string;
    siteName: string;
    internalSecret: string;
  };
};

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be a number, got "${raw}"`);
  }
  return parsed;
}

/** `jsonwebtoken` accepts a bare number of seconds or a `ms`-style span. */
const JWT_TTL_PATTERN = /^\d+(ms|s|m|h|d)?$/;

export function configuration(): AppConfig {
  const accessTtl = (process.env.JWT_ACCESS_TTL ?? "15m").trim();
  if (!JWT_TTL_PATTERN.test(accessTtl)) {
    throw new Error(
      `JWT_ACCESS_TTL must look like "900", "15m", or "2h", got "${accessTtl}"`,
    );
  }

  const provider = (process.env.MAILER_PROVIDER ?? "log").trim();
  if (provider !== "log" && provider !== "resend") {
    throw new Error(
      `MAILER_PROVIDER must be "log" or "resend", got "${provider}"`,
    );
  }
  if (provider === "resend" && !process.env.RESEND_API_KEY) {
    throw new Error('MAILER_PROVIDER="resend" requires RESEND_API_KEY');
  }

  const corsOrigins = (process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (corsOrigins.includes("*")) {
    throw new Error("CORS_ORIGIN must be an explicit allow-list, never '*' (ADR-017)");
  }

  return {
    nodeEnv: process.env.NODE_ENV ?? "development",
    port: optionalInt("PORT", 4000),
    corsOrigins,
    appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000",
    auth: {
      accessSecret: required("JWT_ACCESS_SECRET"),
      accessTtl,
      refreshTtlDays: optionalInt("REFRESH_TOKEN_TTL_DAYS", 30),
      passwordResetTtlMinutes: optionalInt("PASSWORD_RESET_TTL_MINUTES", 30),
      invitationTtlHours: optionalInt("INVITATION_TTL_HOURS", 24),
      emailVerificationTtlHours: optionalInt("EMAIL_VERIFICATION_TTL_HOURS", 24),
      trackerSalt: required("AUTH_TRACKER_SALT"),
      maxFailedLogins: optionalInt("AUTH_MAX_FAILED_LOGINS", 5),
      lockoutMinutes: optionalInt("AUTH_LOCKOUT_MINUTES", 15),
      bcryptRounds: optionalInt("BCRYPT_ROUNDS", 12),
      minPasswordLength: optionalInt("AUTH_MIN_PASSWORD_LENGTH", 12),
    },
    redis: {
      host: process.env.REDIS_HOST ?? "localhost",
      port: optionalInt("REDIS_PORT", 6379),
      password: process.env.REDIS_PASSWORD?.trim() || undefined,
      db: optionalInt("REDIS_DB", 0),
    },
    messaging: {
      provider,
      resendApiKey: process.env.RESEND_API_KEY?.trim() || undefined,
      from: process.env.MAIL_FROM ?? "Loyollo <no-reply@loyollo.com>",
      siteName: process.env.MAIL_SITE_NAME ?? "Loyollo",
      internalSecret: required("MESSAGING_INTERNAL_SECRET"),
    },
  };
}

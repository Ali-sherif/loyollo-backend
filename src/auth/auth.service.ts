import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as bcrypt from "bcrypt";

import { AppError, ERROR_CODES } from "../common/app.error";
import { generateRawToken, redactEmail, sha256 } from "../common/crypto.util";
import type { AppConfig } from "../config/configuration";
import { permissionsFor } from "../authz/permissions";
import { AccountStatus, AuthAuditAction, Role } from "../generated/prisma/enums";
import { MessagingService } from "../messaging/messaging.service";
import { PrismaService } from "../prisma/prisma.service";
import type { AuthenticatedUser } from "./authenticated-user";
import { AuthAuditService } from "./auth-audit.service";
import type {
  ChangePasswordDto,
  ForgotPasswordDto,
  RefreshDto,
  ResendVerificationDto,
  ResetPasswordDto,
  SignInDto,
  SignUpDto,
  VerifyEmailDto,
} from "./dto/auth.dto";
import { TokenService, toSessionUser, type SessionResponse } from "./token.service";

const SESSION_SELECT = {
  id: true,
  email: true,
  role: true,
  account_status: true,
  owner_id: true,
  email_confirmed_at: true,
  onboarding_completed: true,
} as const;

type ClaimedEmailVerification = { profile_id: string };

/**
 * Precomputed hash of a value no one can supply, compared against when the email is
 * unknown so sign-in costs the same bcrypt work either way. Only `/auth/sign-in`
 * does this — `/auth/forgot-password` deliberately does not (it never verifies a
 * password; see docs/backend/forgot-password-security.md §2).
 */
const DUMMY_PASSWORD_HASH = "$2b$12$JQ3s7WjR0Zqk1w0Y2b0jMe0PN0EPPP3lRDlG4l1yTiTQFyDrY0lRO";

const GENERIC_FORGOT_PASSWORD_RESPONSE = {
  ok: true as const,
  message: "If an account with that email exists, a password reset link has been sent.",
};

const GENERIC_RESEND_RESPONSE = {
  ok: true as const,
  message:
    "If an account with that email exists and still needs confirmation, a verification link has been sent.",
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger("AuthService");

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly tokens: TokenService,
    private readonly audit: AuthAuditService,
    private readonly messaging: MessagingService,
  ) {}

  private get authConfig() {
    return this.config.get("auth", { infer: true });
  }

  private hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.authConfig.bcryptRounds);
  }

  // --- Registration ---------------------------------------------------------

  async signUp(dto: SignUpDto): Promise<SessionResponse> {
    const existing = await this.prisma.profile.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (existing) {
      throw AppError.conflict(
        ERROR_CODES.EMAIL_ALREADY_REGISTERED,
        "An account with that email already exists.",
      );
    }

    const passwordHash = await this.hashPassword(dto.password);
    const rawToken = generateRawToken();
    const tokenHash = sha256(rawToken);
    const expiresAt = new Date(
      Date.now() + this.authConfig.emailVerificationTtlHours * 60 * 60 * 1000,
    );

    // Merchant self-registration always derives `role` and `account_status`;
    // neither is readable from the request body.
    const profile = await this.prisma.$transaction(async (tx) => {
      const created = await tx.profile.create({
        data: {
          email: dto.email,
          password_hash: passwordHash,
          full_name: dto.full_name,
          business_name: dto.business_name,
          phone: dto.phone,
          role: Role.admin,
          account_status: AccountStatus.active,
          owner_id: null,
        },
        select: SESSION_SELECT,
      });

      // The invitation flow requires a branch, and a new shop has none.
      await tx.branch.create({
        data: { shop_id: created.id, name: "Main branch", is_main: true },
      });

      await tx.emailVerificationToken.create({
        data: { profile_id: created.id, token_hash: tokenHash, expires_at: expiresAt },
      });

      return created;
    });

    const url = `${this.config.get("appBaseUrl", { infer: true })}/auth/verify?token=${rawToken}`;
    this.messaging.dispatch(
      () => this.messaging.sendAuthEmail("signup", profile.email, { confirmationUrl: url }),
      "signup_verification_email_failed",
    );

    return this.tokens.issueSession(profile);
  }

  // --- Email verification --------------------------------------------------

  async verifyEmail(dto: VerifyEmailDto): Promise<SessionResponse> {
    const tokenHash = sha256(dto.token);

    const session = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$queryRaw<ClaimedEmailVerification[]>`
        UPDATE "email_verification_tokens"
        SET "used_at" = now()
        WHERE "token_hash" = ${tokenHash}
          AND "used_at" IS NULL
          AND "expires_at" > now()
        RETURNING "profile_id"
      `;
      const token = claimed[0];
      if (!token) {
        throw AppError.badRequest(
          ERROR_CODES.INVALID_TOKEN,
          "This email verification link is invalid or has expired.",
        );
      }

      const profile = await tx.profile.update({
        where: { id: token.profile_id },
        data: { email_confirmed_at: new Date() },
        select: SESSION_SELECT,
      });

      await this.audit.record(
        {
          action: AuthAuditAction.email_verified,
          actorId: profile.id,
          targetId: profile.id,
        },
        tx,
      );

      await this.tokens.revokeAllForProfile(profile.id, { tx });

      return this.tokens.issueSession(profile, tx);
    });

    return session;
  }

  async resendVerification(
    dto: ResendVerificationDto,
    ip: string | null,
  ): Promise<typeof GENERIC_RESEND_RESPONSE> {
    const profile = await this.prisma.profile
      .findUnique({
        where: { email: dto.email },
        select: { id: true, email: true, account_status: true, email_confirmed_at: true },
      })
      .catch((error: unknown) => {
        this.logger.error(
          `resend_verification_lookup_failed error=${error instanceof Error ? error.name : "unknown"}`,
        );
        return null;
      });

    const rawToken = generateRawToken();
    const tokenHash = sha256(rawToken);
    const expiresAt = new Date(
      Date.now() + this.authConfig.emailVerificationTtlHours * 60 * 60 * 1000,
    );
    const eligible =
      profile !== null &&
      profile.account_status === AccountStatus.active &&
      profile.email_confirmed_at === null;

    if (eligible) {
      await this.prisma.$transaction(async (tx) => {
        await tx.emailVerificationToken.updateMany({
          where: { profile_id: profile.id, used_at: null },
          data: { used_at: new Date() },
        });
        await tx.emailVerificationToken.create({
          data: { profile_id: profile.id, token_hash: tokenHash, expires_at: expiresAt },
        });
      });

      const url = `${this.config.get("appBaseUrl", { infer: true })}/auth/verify?token=${rawToken}`;
      this.messaging.dispatch(
        () => this.messaging.sendAuthEmail("signup", profile.email, { confirmationUrl: url }),
        "resend_verification_email_failed",
      );
      await this.audit.record({
        action: AuthAuditAction.email_verification_resent,
        actorId: profile.id,
        targetId: profile.id,
        ip,
      });
    }

    this.logger.log(
      `email_verification_requested email=${redactEmail(dto.email)} ip=${ip ?? "unknown"} matched=${eligible}`,
    );
    return GENERIC_RESEND_RESPONSE;
  }

  // --- Sign in / out --------------------------------------------------------

  async signIn(dto: SignInDto, ip: string | null): Promise<SessionResponse> {
    const profile = await this.prisma.profile.findUnique({
      where: { email: dto.email },
      select: {
        ...SESSION_SELECT,
        password_hash: true,
        failed_login_count: true,
        locked_until: true,
      },
    });

    const passwordMatches = await bcrypt.compare(
      dto.password,
      profile?.password_hash ?? DUMMY_PASSWORD_HASH,
    );

    if (!profile || !passwordMatches) {
      if (profile) await this.registerFailedLogin(profile.id, ip);
      this.logger.warn(`sign_in_failed email=${redactEmail(dto.email)} ip=${ip ?? "unknown"}`);
      await this.audit.record({
        action: AuthAuditAction.sign_in_failed,
        actorId: profile?.id ?? null,
        ip,
      });
      throw AppError.unauthorized(
        ERROR_CODES.INVALID_CREDENTIALS,
        "Invalid email or password.",
      );
    }

    // `account_status` is checked before `locked_until` so a deactivated account
    // always reports deactivation, never a lockout (ADR-005).
    if (profile.account_status !== AccountStatus.active) {
      throw AppError.forbidden(ERROR_CODES.ACCOUNT_NOT_ACTIVE, "This account is not active.", {
        account_status: profile.account_status,
      });
    }

    if (profile.locked_until && profile.locked_until.getTime() > Date.now()) {
      throw AppError.forbidden(
        ERROR_CODES.ACCOUNT_LOCKED,
        "Too many failed sign-in attempts. Try again later.",
        { locked_until: profile.locked_until.toISOString() },
      );
    }

    if (profile.failed_login_count !== 0 || profile.locked_until !== null) {
      await this.prisma.profile.update({
        where: { id: profile.id },
        data: { failed_login_count: 0, locked_until: null },
      });
    }

    return this.tokens.issueSession(profile);
  }

  /**
   * Automatic lockout. Deliberately never reads or writes `account_status` —
   * disjoint from admin deactivation (ADR-005).
   */
  private async registerFailedLogin(profileId: string, ip: string | null): Promise<void> {
    const { maxFailedLogins, lockoutMinutes } = this.authConfig;

    const updated = await this.prisma.profile.update({
      where: { id: profileId },
      data: { failed_login_count: { increment: 1 } },
      select: { failed_login_count: true, locked_until: true },
    });

    const alreadyLocked =
      updated.locked_until !== null && updated.locked_until.getTime() > Date.now();

    if (updated.failed_login_count >= maxFailedLogins && !alreadyLocked) {
      const lockedUntil = new Date(Date.now() + lockoutMinutes * 60 * 1000);
      await this.prisma.profile.update({
        where: { id: profileId },
        data: { locked_until: lockedUntil },
      });
      this.logger.warn(`account_locked profile=${profileId} until=${lockedUntil.toISOString()}`);
      await this.audit.record({
        action: AuthAuditAction.account_locked,
        actorId: profileId,
        targetId: profileId,
        ip,
        metadata: { locked_until: lockedUntil.toISOString() },
      });
    }
  }

  async signOut(profileId: string, refreshToken?: string): Promise<void> {
    if (!refreshToken) return;
    await this.prisma.refreshToken.updateMany({
      where: { profile_id: profileId, token_hash: sha256(refreshToken), revoked_at: null },
      data: { revoked_at: new Date() },
    });
  }

  async signOutAll(user: AuthenticatedUser, ip: string | null): Promise<{ revoked: number }> {
    const revoked = await this.tokens.revokeAllForProfile(user.id);
    await this.audit.record({
      action: AuthAuditAction.sign_out_all,
      actorId: user.id,
      targetId: user.id,
      ip,
      metadata: { revoked },
    });
    return { revoked };
  }

  // --- Refresh rotation -----------------------------------------------------

  async refresh(dto: RefreshDto, ip: string | null): Promise<SessionResponse> {
    const tokenHash = sha256(dto.refresh_token);

    const existing = await this.prisma.refreshToken.findUnique({
      where: { token_hash: tokenHash },
      select: { id: true, profile_id: true, expires_at: true, revoked_at: true },
    });

    if (!existing) {
      throw AppError.unauthorized(ERROR_CODES.INVALID_TOKEN, "Session expired or invalid.");
    }

    // A revoked token being presented again means the chain leaked: kill the whole
    // family, not just this token. This is an active-compromise signal.
    if (existing.revoked_at !== null) {
      await this.tokens.revokeAllForProfile(existing.profile_id);
      this.logger.error(`refresh_reuse_detected profile=${existing.profile_id} ip=${ip ?? "unknown"}`);
      await this.audit.record({
        action: AuthAuditAction.refresh_reuse_detected,
        actorId: existing.profile_id,
        targetId: existing.profile_id,
        ip,
        metadata: { refresh_token_id: existing.id },
      });
      throw AppError.unauthorized(ERROR_CODES.INVALID_TOKEN, "Session expired or invalid.");
    }

    if (existing.expires_at.getTime() <= Date.now()) {
      await this.prisma.refreshToken.update({
        where: { id: existing.id },
        data: { revoked_at: new Date() },
      });
      throw AppError.unauthorized(ERROR_CODES.INVALID_TOKEN, "Session expired or invalid.");
    }

    // `role` and `account_status` are re-read from the database; the old claims are
    // never carried forward.
    const profile = await this.prisma.profile.findUnique({
      where: { id: existing.profile_id },
      select: SESSION_SELECT,
    });
    if (!profile) {
      throw AppError.unauthorized(ERROR_CODES.INVALID_TOKEN, "Session expired or invalid.");
    }
    if (profile.account_status !== AccountStatus.active) {
      throw AppError.forbidden(ERROR_CODES.ACCOUNT_NOT_ACTIVE, "This account is not active.", {
        account_status: profile.account_status,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const issued = await this.tokens.issueRefreshToken(profile.id, tx);
      await tx.refreshToken.update({
        where: { id: existing.id },
        data: { revoked_at: new Date(), replaced_by_id: issued.id },
      });

      return {
        user: toSessionUser(profile),
        permissions: permissionsFor(profile.role),
        access_token: await this.tokens.signAccessToken(profile),
        refresh_token: issued.raw,
      };
    });
  }

  // --- Session --------------------------------------------------------------

  async me(user: AuthenticatedUser) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: user.id },
      select: SESSION_SELECT,
    });
    if (!profile) {
      throw AppError.unauthorized(ERROR_CODES.UNAUTHENTICATED, "Session expired or invalid.");
    }
    return { user: toSessionUser(profile), permissions: permissionsFor(profile.role) };
  }

  // --- Password recovery ----------------------------------------------------

  /**
   * Anti-enumeration and timing hardening per docs/backend/forgot-password-security.md.
   *
   * There is exactly one success return path. Both branches run the same lookup,
   * token generation, and hash; only the existing-account branch persists the row
   * and triggers the email. The email is dispatched without awaiting the provider
   * round trip, which is the dominant timing signal this endpoint has.
   */
  async forgotPassword(
    dto: ForgotPasswordDto,
    ip: string | null,
  ): Promise<typeof GENERIC_FORGOT_PASSWORD_RESPONSE> {
    const profile = await this.prisma.profile
      .findUnique({
        where: { email: dto.email },
        select: { id: true, email: true, account_status: true },
      })
      .catch((error: unknown) => {
        this.logger.error(
          `forgot_password_lookup_failed error=${error instanceof Error ? error.name : "unknown"}`,
        );
        return null;
      });

    // Identical work on both branches. The non-existing branch discards its result
    // instead of persisting it — never a live, redeemable token for no account.
    const rawToken = generateRawToken();
    const tokenHash = sha256(rawToken);
    const expiresAt = new Date(
      Date.now() + this.authConfig.passwordResetTtlMinutes * 60 * 1000,
    );

    const eligible = profile !== null && profile.account_status === AccountStatus.active;

    if (eligible) {
      await this.prisma.passwordResetToken.create({
        data: { profile_id: profile.id, token_hash: tokenHash, expires_at: expiresAt },
      });

      const url = `${this.config.get("appBaseUrl", { infer: true })}/auth/reset-password?token=${rawToken}`;
      this.messaging.dispatch(
        () => this.messaging.sendAuthEmail("recovery", profile.email, { confirmationUrl: url }),
        "forgot_password_email_queue_failed",
      );
    }

    this.logger.log(
      `forgot_password_requested email=${redactEmail(dto.email)} ip=${ip ?? "unknown"} matched=${eligible}`,
    );

    return GENERIC_FORGOT_PASSWORD_RESPONSE;
  }

  async resetPassword(dto: ResetPasswordDto, ip: string | null): Promise<SessionResponse> {
    const tokenHash = sha256(dto.token);

    const record = await this.prisma.passwordResetToken.findUnique({
      where: { token_hash: tokenHash },
      select: { id: true, profile_id: true, expires_at: true, used_at: true },
    });

    if (!record || record.used_at !== null || record.expires_at.getTime() <= Date.now()) {
      throw AppError.badRequest(
        ERROR_CODES.INVALID_TOKEN,
        "This password reset link is invalid or has expired.",
      );
    }

    const profile = await this.prisma.profile.findUnique({
      where: { id: record.profile_id },
      select: SESSION_SELECT,
    });
    if (!profile) {
      throw AppError.badRequest(
        ERROR_CODES.INVALID_TOKEN,
        "This password reset link is invalid or has expired.",
      );
    }
    if (profile.account_status !== AccountStatus.active) {
      throw AppError.forbidden(ERROR_CODES.ACCOUNT_NOT_ACTIVE, "This account is not active.", {
        account_status: profile.account_status,
      });
    }

    const passwordHash = await this.hashPassword(dto.password);

    const session = await this.prisma.$transaction(async (tx) => {
      // Single-use is enforced by the conditional update, not a read-then-write.
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, used_at: null },
        data: { used_at: new Date() },
      });
      if (claimed.count !== 1) {
        throw AppError.badRequest(
          ERROR_CODES.INVALID_TOKEN,
          "This password reset link is invalid or has expired.",
        );
      }

      await tx.profile.update({
        where: { id: profile.id },
        data: { password_hash: passwordHash, failed_login_count: 0, locked_until: null },
      });

      // Every pre-existing session dies with the password.
      await this.tokens.revokeAllForProfile(profile.id, { tx });

      return this.tokens.issueSession(profile, tx);
    });

    await this.audit.record({
      action: AuthAuditAction.password_reset,
      actorId: profile.id,
      targetId: profile.id,
      ip,
    });

    return session;
  }

  async changePassword(user: AuthenticatedUser, dto: ChangePasswordDto) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: user.id },
      select: { ...SESSION_SELECT, password_hash: true, full_name: true, business_name: true },
    });
    if (!profile) {
      throw AppError.unauthorized(ERROR_CODES.UNAUTHENTICATED, "Session expired or invalid.");
    }

    const matches = await bcrypt.compare(dto.current_password, profile.password_hash);
    if (!matches) {
      throw AppError.unauthorized(
        ERROR_CODES.INVALID_CREDENTIALS,
        "Your current password is incorrect.",
      );
    }

    const passwordHash = await this.hashPassword(dto.new_password);

    await this.prisma.$transaction(async (tx) => {
      await tx.profile.update({
        where: { id: profile.id },
        data: { password_hash: passwordHash },
      });
      await this.tokens.revokeAllForProfile(profile.id, {
        tx,
        exceptTokenHash: dto.refresh_token ? sha256(dto.refresh_token) : undefined,
      });
    });

    this.messaging.dispatch(
      () =>
        this.messaging.sendTransactionalEmail("password_changed", profile.email, {
          businessName:
            profile.business_name?.trim() || profile.full_name?.trim() || "Loyollo",
        }),
      "password_changed_email_failed",
    );

    return { user: toSessionUser(profile) };
  }
}

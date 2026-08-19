import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as bcrypt from "bcrypt";

import { AppError, ERROR_CODES } from "../common/app.error";
import { generateRawToken, sha256 } from "../common/crypto.util";
import type { AppConfig } from "../config/configuration";
import { permissionsFor } from "../authz/permissions";
import {
  AccountStatus,
  AuthAuditAction,
  InvitationStatus,
  Role,
} from "../generated/prisma/enums";
import { MessagingService } from "../messaging/messaging.service";
import { PrismaService } from "../prisma/prisma.service";
import type { AuthenticatedUser } from "./authenticated-user";
import { AuthAuditService } from "./auth-audit.service";
import type { AcceptInviteDto, CreateInvitationDto } from "./dto/auth.dto";
import { TokenService, toSessionUser, type SessionResponse } from "./token.service";

export type InvitationSummary = {
  id: string;
  email: string;
  branch_id: string;
  role: Role;
  status: InvitationStatus;
  expires_at: string;
};

export type InvitationValidationResult =
  | {
      valid: true;
      email: string;
      shop_name: string;
      branch_name: string;
      role: Role;
      expires_at: string;
    }
  | { valid: false; state: "expired" | "revoked" | "consumed" | "invalid" };

/** Shape returned by the atomic claim in `acceptInvite`. */
type ClaimedInvitation = {
  id: string;
  email: string;
  shop_id: string;
  branch_id: string;
  role: Role;
};

@Injectable()
export class InvitationService {
  private readonly logger = new Logger("InvitationService");

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly tokens: TokenService,
    private readonly audit: AuthAuditService,
    private readonly messaging: MessagingService,
  ) {}

  private expiryFromNow(): Date {
    const hours = this.config.get("auth", { infer: true }).invitationTtlHours;
    return new Date(Date.now() + hours * 60 * 60 * 1000);
  }

  private static summarize(invitation: {
    id: string;
    email: string;
    branch_id: string;
    role: Role;
    status: InvitationStatus;
    expires_at: Date;
  }): InvitationSummary {
    return {
      id: invitation.id,
      email: invitation.email,
      branch_id: invitation.branch_id,
      role: invitation.role,
      status: invitation.status,
      expires_at: invitation.expires_at.toISOString(),
    };
  }

  // --- Create ---------------------------------------------------------------

  async create(
    dto: CreateInvitationDto,
    caller: AuthenticatedUser,
    ip: string | null,
  ): Promise<{ invitation: InvitationSummary }> {
    const shopId = caller.owner_id;

    // The branch must belong to the caller's shop. A cross-shop branch id is a 404,
    // not a 403, so it never confirms that the branch exists elsewhere.
    const branch = await this.prisma.branch.findFirst({
      where: { id: dto.branch_id, shop_id: shopId },
      select: { id: true, name: true },
    });
    if (!branch) {
      throw AppError.notFound("Branch not found.");
    }

    const existingAccount = await this.prisma.profile.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (existingAccount) {
      throw AppError.conflict(
        ERROR_CODES.ACCOUNT_ALREADY_EXISTS,
        "An account with that email already exists. Ask them to sign in instead.",
      );
    }

    const rawToken = generateRawToken();
    const invitation = await this.prisma.invitation.create({
      data: {
        email: dto.email,
        shop_id: shopId,
        branch_id: branch.id,
        role: dto.role,
        token_hash: sha256(rawToken),
        status: InvitationStatus.PENDING,
        expires_at: this.expiryFromNow(),
        created_by_profile_id: caller.id,
      },
      select: {
        id: true,
        email: true,
        branch_id: true,
        role: true,
        status: true,
        expires_at: true,
      },
    });

    await this.sendInvitationEmail({
      email: invitation.email,
      rawToken,
      shopId,
      branchName: branch.name,
      role: invitation.role,
      expiresAt: invitation.expires_at,
    });

    await this.audit.record({
      action: AuthAuditAction.invitation_created,
      actorId: caller.id,
      ip,
      metadata: { invitation_id: invitation.id, role: invitation.role },
    });

    return { invitation: InvitationService.summarize(invitation) };
  }

  // --- Resend / revoke ------------------------------------------------------

  async resend(
    invitationId: string,
    caller: AuthenticatedUser,
    ip: string | null,
  ): Promise<{ invitation: InvitationSummary }> {
    const shopId = caller.owner_id;

    const existing = await this.prisma.invitation.findFirst({
      where: { id: invitationId, shop_id: shopId },
      select: {
        id: true,
        email: true,
        branch_id: true,
        role: true,
        status: true,
        branch: { select: { name: true } },
      },
    });
    // Cross-shop or unknown: 404, never 403 — an admin from another shop must not
    // learn the invitation exists.
    if (!existing) throw AppError.notFound("Invitation not found.");
    if (existing.status !== InvitationStatus.PENDING) {
      throw AppError.conflict(
        ERROR_CODES.INVALID_INVITATION,
        "This invitation is no longer pending.",
      );
    }

    const rawToken = generateRawToken();

    // Revoke + reissue as one unit. The old row's token is never mutated in place,
    // so the previous link dies the moment this commits (ADR-022 §I).
    const replacement = await this.prisma.$transaction(async (tx) => {
      await tx.invitation.update({
        where: { id: existing.id },
        data: { status: InvitationStatus.REVOKED, revoked_at: new Date() },
      });

      return tx.invitation.create({
        data: {
          email: existing.email,
          shop_id: shopId,
          branch_id: existing.branch_id,
          role: existing.role,
          token_hash: sha256(rawToken),
          status: InvitationStatus.PENDING,
          expires_at: this.expiryFromNow(),
          created_by_profile_id: caller.id,
        },
        select: {
          id: true,
          email: true,
          branch_id: true,
          role: true,
          status: true,
          expires_at: true,
        },
      });
    });

    await this.sendInvitationEmail({
      email: replacement.email,
      rawToken,
      shopId,
      branchName: existing.branch.name,
      role: replacement.role,
      expiresAt: replacement.expires_at,
    });

    await this.audit.record({
      action: AuthAuditAction.invitation_resent,
      actorId: caller.id,
      ip,
      metadata: { invitation_id: replacement.id, replaced_invitation_id: existing.id },
    });

    return { invitation: InvitationService.summarize(replacement) };
  }

  async revoke(
    invitationId: string,
    caller: AuthenticatedUser,
    ip: string | null,
  ): Promise<{ invitation: { id: string; status: InvitationStatus } }> {
    const existing = await this.prisma.invitation.findFirst({
      where: { id: invitationId, shop_id: caller.owner_id },
      select: { id: true, status: true },
    });
    if (!existing) throw AppError.notFound("Invitation not found.");
    if (existing.status !== InvitationStatus.PENDING) {
      throw AppError.conflict(
        ERROR_CODES.INVALID_INVITATION,
        "This invitation is no longer pending.",
      );
    }

    await this.prisma.invitation.update({
      where: { id: existing.id },
      data: { status: InvitationStatus.REVOKED, revoked_at: new Date() },
    });

    await this.audit.record({
      action: AuthAuditAction.invitation_revoked,
      actorId: caller.id,
      ip,
      metadata: { invitation_id: existing.id },
    });

    return { invitation: { id: existing.id, status: InvitationStatus.REVOKED } };
  }

  // --- Public validate / accept ---------------------------------------------

  /**
   * Never distinguishes "no such token" from "hash mismatch" — both collapse to
   * `invalid` (ADR-022 §E).
   */
  async validate(rawToken: string): Promise<InvitationValidationResult> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { token_hash: sha256(rawToken) },
      select: {
        email: true,
        shop_id: true,
        role: true,
        status: true,
        expires_at: true,
        branch: { select: { name: true } },
      },
    });

    if (!invitation) return { valid: false, state: "invalid" };
    if (invitation.status === InvitationStatus.CONSUMED) {
      return { valid: false, state: "consumed" };
    }
    if (invitation.status === InvitationStatus.REVOKED) {
      return { valid: false, state: "revoked" };
    }
    if (invitation.expires_at.getTime() <= Date.now()) {
      return { valid: false, state: "expired" };
    }

    const shop = await this.prisma.profile.findUnique({
      where: { id: invitation.shop_id },
      select: { full_name: true },
    });

    return {
      valid: true,
      email: invitation.email,
      shop_name: shop?.full_name?.trim() || "Loyollo",
      branch_name: invitation.branch.name,
      role: invitation.role,
      expires_at: invitation.expires_at.toISOString(),
    };
  }

  async acceptInvite(dto: AcceptInviteDto, ip: string | null): Promise<SessionResponse> {
    const tokenHash = sha256(dto.token);
    const passwordHash = await bcrypt.hash(
      dto.password,
      this.config.get("auth", { infer: true }).bcryptRounds,
    );

    const session = await this.prisma.$transaction(async (tx) => {
      // The atomic claim. Two concurrent requests on the same token cannot both
      // affect a row here, so only one can ever proceed to create an account
      // (ADR-022 §F). A "check then act" in application code is not sufficient.
      const claimed = await tx.$queryRaw<ClaimedInvitation[]>`
        UPDATE "invitations"
        SET "status" = 'CONSUMED', "consumed_at" = now(), "updated_at" = now()
        WHERE "token_hash" = ${tokenHash}
          AND "status" = 'PENDING'
          AND "expires_at" > now()
        RETURNING "id", "email", "shop_id", "branch_id", "role"
      `;

      const invitation = claimed[0];
      if (!invitation) {
        // Same generic failure as validate — never says which check failed.
        throw AppError.badRequest(
          ERROR_CODES.INVALID_INVITATION,
          "This invitation link is invalid, expired, or has already been used.",
        );
      }

      const existing = await tx.profile.findUnique({
        where: { email: invitation.email },
        select: { id: true },
      });
      if (existing) {
        // Rolls back the claim: never silently attach an invitation to an account.
        throw AppError.conflict(
          ERROR_CODES.ACCOUNT_ALREADY_EXISTS,
          "An account with that email already exists. Please sign in instead.",
        );
      }

      // Everything identifying comes from the invitation row, never the request.
      const profile = await tx.profile.create({
        data: {
          email: invitation.email,
          password_hash: passwordHash,
          full_name: dto.full_name,
          role: invitation.role,
          account_status: AccountStatus.active,
          owner_id: invitation.shop_id,
          branch_id: invitation.branch_id,
        },
        select: {
          id: true,
          email: true,
          role: true,
          account_status: true,
          owner_id: true,
        },
      });

      await tx.invitation.update({
        where: { id: invitation.id },
        data: { consumed_by_profile_id: profile.id },
      });

      await this.audit.record(
        {
          action: AuthAuditAction.invitation_accepted,
          actorId: profile.id,
          ip,
          metadata: { invitation_id: invitation.id },
        },
        tx,
      );

      const issued = await this.tokens.issueRefreshToken(profile.id, tx);
      return {
        user: toSessionUser(profile),
        permissions: permissionsFor(profile.role),
        access_token: await this.tokens.signAccessToken(profile),
        refresh_token: issued.raw,
      };
    });

    return session;
  }

  // --- Email ----------------------------------------------------------------

  private async sendInvitationEmail(args: {
    email: string;
    rawToken: string;
    shopId: string;
    branchName: string;
    role: Role;
    expiresAt: Date;
  }): Promise<void> {
    const shop = await this.prisma.profile.findUnique({
      where: { id: args.shopId },
      select: { full_name: true },
    });

    const acceptUrl = `${this.config.get("appBaseUrl", { infer: true })}/accept-invite?token=${args.rawToken}`;

    const result = await this.messaging.sendAuthEmail("invite", args.email, {
      confirmationUrl: acceptUrl,
      shopName: shop?.full_name?.trim() || "Loyollo",
      branchName: args.branchName,
      role: args.role,
      expiresAt: args.expiresAt.toUTCString(),
    });

    // A delivery failure must not roll back the invitation — the admin can resend.
    if (!result.ok) {
      this.logger.error(`invitation_email_failed code=${result.code}`);
    }
  }
}

import { Injectable, Logger } from "@nestjs/common";

import { AppError } from "../common/app.error";
import { AccountStatus, AuthAuditAction, Role } from "../generated/prisma/enums";
import { PrismaService } from "../prisma/prisma.service";
import type { AuthenticatedUser } from "./authenticated-user";
import { AuthAuditService } from "./auth-audit.service";
import type { UpdateAccountStatusDto } from "./dto/auth.dto";
import { TokenService, toSessionUser } from "./token.service";

/**
 * Manual account deactivation (ADR-005 § Account status vs automatic lockout).
 *
 * This handler never reads or writes `locked_until` / `failed_login_count` —
 * automatic lockout is a separate, self-expiring mechanism on the same row.
 */
@Injectable()
export class AccountsService {
  private readonly logger = new Logger("AccountsService");

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuthAuditService,
  ) {}

  async updateStatus(
    targetId: string,
    dto: UpdateAccountStatusDto,
    caller: AuthenticatedUser,
    ip: string | null,
  ) {
    const target = await this.prisma.profile.findUnique({
      where: { id: targetId },
      select: {
        id: true,
        email: true,
        role: true,
        account_status: true,
        owner_id: true,
        email_confirmed_at: true,
      },
    });

    // 404 rather than 403 across shops, so the response never confirms that an
    // account with this id exists somewhere else.
    if (!target || target.role === Role.admin || target.owner_id !== caller.owner_id) {
      throw AppError.notFound("Account not found.");
    }

    // Idempotent: a repeat call is a no-op, not a second revoke or audit row.
    if (target.account_status === dto.account_status) {
      return { user: toSessionUser(target) };
    }

    const deactivating = dto.account_status === AccountStatus.inactive;

    const updated = await this.prisma.$transaction(async (tx) => {
      const profile = await tx.profile.update({
        where: { id: target.id },
        data: { account_status: dto.account_status },
        select: {
          id: true,
          email: true,
          role: true,
          account_status: true,
          owner_id: true,
          email_confirmed_at: true,
        },
      });

      if (deactivating) {
        // Same revocation path `sign-out-all` uses — there is no second one.
        // Reactivation deliberately does not undo this: the user signs in again.
        await this.tokens.revokeAllForProfile(target.id, { tx });
      }

      return profile;
    });

    await this.audit.record({
      action: AuthAuditAction.account_status_changed,
      actorId: caller.id,
      targetId: target.id,
      ip,
      metadata: { from: target.account_status, to: updated.account_status },
    });

    this.logger.log(
      `account_status_changed actor=${caller.id} target=${target.id} to=${updated.account_status}`,
    );

    return { user: toSessionUser(updated) };
  }
}

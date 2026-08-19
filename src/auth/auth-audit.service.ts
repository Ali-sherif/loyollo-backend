import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client";

import type { AuthAuditAction } from "../generated/prisma/enums";
import { PrismaService } from "../prisma/prisma.service";

type AuditInput = {
  action: AuthAuditAction;
  actorId?: string | null;
  targetId?: string | null;
  ip?: string | null;
  /** Never a raw token, token hash, or password — reference ids only. */
  metadata?: Record<string, string | number | boolean | null>;
};

/**
 * Admin/security actions with a defined actor (plan §1.7). A forgot-password
 * *request* has no authenticated actor and is deliberately not recorded here —
 * it uses structured application logs instead.
 */
@Injectable()
export class AuthAuditService {
  private readonly logger = new Logger("AuthAudit");

  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    try {
      await client.authAuditLog.create({
        data: {
          action: input.action,
          actor_id: input.actorId ?? null,
          target_id: input.targetId ?? null,
          ip: input.ip ?? null,
          metadata: input.metadata ?? {},
        },
      });
    } catch (error) {
      // An audit write must never break the operation it describes, but a silent
      // loss of security history is itself worth surfacing.
      this.logger.error(
        `audit_write_failed action=${input.action} error=${
          error instanceof Error ? error.name : "unknown"
        }`,
      );
    }
  }
}

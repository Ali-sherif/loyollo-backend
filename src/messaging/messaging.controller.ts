import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";

import { AppError, ERROR_CODES } from "../common/app.error";
import { Public } from "../auth/decorators/public.decorator";
import { SendCampaignEmailDto, SendTransactionalEmailDto } from "./dto/send-email.dto";
import { InternalSecretGuard } from "./internal-secret.guard";
import { MessagingService, type TransactionalEmailVars } from "./messaging.service";

/**
 * Service-to-service surface for the `loyollo-web` BFF routes that still own
 * campaign / notification / join business logic against Supabase data (ADR-018).
 * Nest's own modules call `MessagingService` in-process instead.
 *
 * `@Public()` skips JWT auth only — the shared-secret guard is the control here.
 */
@Controller("messaging")
@Public()
@SkipThrottle()
@UseGuards(InternalSecretGuard)
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Post("email")
  @HttpCode(HttpStatus.ACCEPTED)
  async sendTransactional(@Body() dto: SendTransactionalEmailDto) {
    const result = await this.messaging.sendTransactionalEmail(
      dto.type,
      dto.to,
      dto.vars as unknown as TransactionalEmailVars[typeof dto.type],
    );

    if (!result.ok) {
      throw AppError.serviceUnavailable(
        ERROR_CODES.MESSAGING_SEND_FAILED,
        "The message could not be delivered.",
      );
    }

    return { ok: true, provider_message_id: result.providerMessageId ?? null };
  }

  @Post("campaign/email")
  @HttpCode(HttpStatus.ACCEPTED)
  async sendCampaign(@Body() dto: SendCampaignEmailDto) {
    const result = await this.messaging.sendCampaignEmail(dto.to, {
      businessName: dto.businessName,
      subjectTemplate: dto.subjectTemplate,
      messageTemplate: dto.messageTemplate,
      tokens: dto.tokens ?? {},
      messageId: dto.messageId,
      label: dto.label,
    });

    if (!result.ok) {
      throw AppError.serviceUnavailable(
        ERROR_CODES.MESSAGING_SEND_FAILED,
        "The message could not be delivered.",
      );
    }

    return { ok: true, provider_message_id: result.providerMessageId ?? null };
  }

  /** DG-08: refuses before any per-recipient fan-out. */
  @Post("campaign/sms")
  sendCampaignSms(): never {
    return this.messaging.sendCampaignSms();
  }
}

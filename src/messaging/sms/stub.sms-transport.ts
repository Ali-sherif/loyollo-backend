import { Injectable, Logger } from "@nestjs/common";

import type { SendSmsInput, SendResult, SmsTransport } from "../contracts";

/**
 * No SMS/WhatsApp provider is chosen (standing ACCEPTED RISK, ADR-018).
 * Ported verbatim in behavior from `loyollo-web`: fails explicitly, never a silent
 * success. A real provider plugs into this same interface with no relocation.
 */
@Injectable()
export class StubSmsTransport implements SmsTransport {
  private readonly logger = new Logger("StubSmsTransport");

  async sendSms(input: SendSmsInput): Promise<SendResult> {
    this.logger.warn(
      `sms.stub_refused to=${redactPhone(input.to)} template=${input.templateName ?? "n/a"}`,
    );
    return {
      ok: false,
      code: "SMS_TRANSPORT_NOT_CONFIGURED",
      error: "SMS provider not configured",
    };
  }
}

function redactPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `***${digits.slice(-4)}`;
}

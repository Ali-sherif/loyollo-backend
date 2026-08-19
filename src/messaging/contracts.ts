/**
 * Provider-agnostic messaging contracts (ADR-018, ported from
 * `loyollo-web/src/lib/server/messaging/contracts.ts`).
 * Features must import from here — never from a delivery vendor SDK.
 */

export type MessagingChannel = "email" | "sms";

export type RenderedMessage = {
  subject?: string;
  html?: string;
  text: string;
};

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  /** Observability / idempotency correlation (optional). */
  messageId?: string;
  templateName?: string;
};

export type SendSmsInput = {
  to: string;
  body: string;
  messageId?: string;
  templateName?: string;
};

export type MessagingErrorCode =
  | "EMAIL_TRANSPORT_FAILED"
  | "SMS_TRANSPORT_NOT_CONFIGURED"
  | "RENDER_FAILED"
  | "INVALID_INPUT";

export type SendResult =
  | { ok: true; providerMessageId?: string }
  | { ok: false; error: string; code: MessagingErrorCode };

export interface Mailer {
  readonly name: string;
  sendEmail(input: SendEmailInput): Promise<SendResult>;
}

export interface SmsTransport {
  sendSms(input: SendSmsInput): Promise<SendResult>;
}

export const MAILER = Symbol("MAILER");
export const SMS_TRANSPORT = Symbol("SMS_TRANSPORT");

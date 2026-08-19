import { Logger } from "@nestjs/common";
import { Resend } from "resend";

import { redactEmail } from "../../common/crypto.util";
import type { Mailer, SendEmailInput, SendResult } from "../contracts";

export class ResendMailer implements Mailer {
  readonly name = "resend";
  private readonly logger = new Logger("ResendMailer");
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly defaultFrom: string,
  ) {
    this.client = new Resend(apiKey);
  }

  async sendEmail(input: SendEmailInput): Promise<SendResult> {
    const { data, error } = await this.client.emails.send({
      from: input.from ?? this.defaultFrom,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      replyTo: input.replyTo,
    });

    if (error) {
      // Provider error text can echo request content; log the class only.
      this.logger.error(
        `email.send_failed to=${redactEmail(input.to)} template=${
          input.templateName ?? "n/a"
        } error=${error.name}`,
      );
      return { ok: false, code: "EMAIL_TRANSPORT_FAILED", error: error.name };
    }

    return { ok: true, providerMessageId: data?.id };
  }
}

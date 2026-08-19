import { Injectable, Logger } from "@nestjs/common";

import { redactEmail } from "../../common/crypto.util";
import type { Mailer, SendEmailInput, SendResult } from "../contracts";

/**
 * Development mailer. Unlike the old `loyollo-web` stub it reports success, because
 * the rendered message genuinely reached its (log) destination — the send path is
 * exercised end to end without a provider. It never logs the message body, which
 * can contain reset/invitation links.
 */
@Injectable()
export class LogMailer implements Mailer {
  readonly name = "log";
  private readonly logger = new Logger("LogMailer");

  async sendEmail(input: SendEmailInput): Promise<SendResult> {
    this.logger.log(
      `email.rendered to=${redactEmail(input.to)} subject="${input.subject}" template=${
        input.templateName ?? "n/a"
      }`,
    );
    return { ok: true, providerMessageId: input.messageId };
  }
}

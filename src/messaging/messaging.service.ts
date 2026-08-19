import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AppError, ERROR_CODES } from "../common/app.error";
import type { AppConfig } from "../config/configuration";
import {
  MAILER,
  SMS_TRANSPORT,
  type Mailer,
  type SendResult,
  type SmsTransport,
} from "./contracts";
import {
  renderAuthEmail,
  renderCampaignEmail,
  renderCampaignSms,
  type AuthEmailType,
  type CampaignRenderInput,
} from "./render";
import {
  renderNewCustomerJoined,
  renderOwnerPreferenceNotification,
  renderPasswordChanged,
  renderRewardEarnedCustomer,
  renderRewardEarnedOwner,
  type TransactionalEmailType,
} from "./templates/transactional";

export type AuthEmailVars = {
  signup: { confirmationUrl: string; siteUrl?: string; recipient?: string };
  invite: {
    confirmationUrl: string;
    shopName: string;
    branchName: string;
    role: string;
    expiresAt: string;
    siteUrl?: string;
  };
  magiclink: { confirmationUrl: string };
  recovery: { confirmationUrl: string };
  email_change: {
    oldEmail: string;
    email: string;
    newEmail: string;
    confirmationUrl: string;
  };
  reauthentication: { token: string };
};

export type TransactionalEmailVars = {
  password_changed: { businessName: string; changedAt?: string };
  new_customer_joined: { businessName: string; customerName: string; profileUrl: string };
  reward_earned_owner: {
    businessName: string;
    customerName: string;
    rewardName: string;
    profileUrl: string;
  };
  reward_earned_customer: {
    businessName: string;
    customerName: string;
    rewardName: string;
  };
  owner_preference_notification: {
    businessName: string;
    title: string;
    message: string;
    ctaLabel?: string;
    ctaUrl?: string;
    subject?: string;
  };
};

/**
 * The single place that renders and sends messages (ADR-018). Other Nest modules
 * call these methods in-process; the Next.js BFF reaches them over
 * `POST /messaging/email`.
 */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger("MessagingService");

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(SMS_TRANSPORT) private readonly sms: SmsTransport,
  ) {}

  private get siteName(): string {
    return this.config.get("messaging", { infer: true }).siteName;
  }

  private get siteUrl(): string {
    return this.config.get("appBaseUrl", { infer: true });
  }

  async sendAuthEmail<T extends AuthEmailType>(
    type: T,
    to: string,
    vars: AuthEmailVars[T],
  ): Promise<SendResult> {
    const rendered = await renderAuthEmail(
      this.buildAuthRenderInput(type, to, vars),
    );

    return this.mailer.sendEmail({
      to,
      subject: rendered.subject ?? this.siteName,
      html: rendered.html ?? "",
      text: rendered.text,
      templateName: `auth:${type}`,
    });
  }

  async sendTransactionalEmail<T extends TransactionalEmailType>(
    type: T,
    to: string,
    vars: TransactionalEmailVars[T],
  ): Promise<SendResult> {
    const rendered = this.renderTransactional(type, vars);
    return this.mailer.sendEmail({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      templateName: `transactional:${type}`,
    });
  }

  async sendCampaignEmail(
    to: string,
    input: CampaignRenderInput & { messageId?: string; label?: string },
  ): Promise<SendResult> {
    const rendered = renderCampaignEmail(input);
    return this.mailer.sendEmail({
      to,
      subject: rendered.subject ?? input.businessName,
      html: rendered.html ?? "",
      text: rendered.text,
      from: `${input.businessName} <${this.config.get("messaging", { infer: true }).from}>`,
      messageId: input.messageId,
      templateName: input.label ?? "campaign",
    });
  }

  /**
   * DG-08 is preserved exactly: campaign SMS refuses with 503 before any
   * per-recipient fan-out, so the campaign stays `draft`.
   */
  sendCampaignSms(): never {
    throw AppError.serviceUnavailable(
      ERROR_CODES.SMS_CAMPAIGNS_NOT_AVAILABLE_PHASE1,
      "SMS sending isn't available during the trial. You can save this campaign as a draft; messages will not be delivered until SMS is enabled.",
    );
  }

  /** Direct single SMS. Fails explicitly until a provider is configured. */
  sendSms(to: string, body: string, templateName?: string): Promise<SendResult> {
    return this.sms.sendSms({ to, body, templateName });
  }

  /**
   * Fire-and-forget send for paths where the HTTP response must not wait on the
   * provider round trip (forgot-password, §1.3a). Failures are logged, never thrown.
   */
  dispatch(send: () => Promise<SendResult>, event: string): void {
    void send()
      .then((result) => {
        if (!result.ok) {
          this.logger.error(`${event} code=${result.code}`);
        }
      })
      .catch((error: unknown) => {
        this.logger.error(
          `${event} error=${error instanceof Error ? error.name : "unknown"}`,
        );
      });
  }

  private buildAuthRenderInput<T extends AuthEmailType>(
    type: T,
    to: string,
    vars: AuthEmailVars[T],
  ) {
    const siteName = this.siteName;
    const siteUrl = this.siteUrl;

    switch (type) {
      case "signup": {
        const v = vars as AuthEmailVars["signup"];
        return {
          type: "signup" as const,
          props: {
            siteName,
            siteUrl: v.siteUrl ?? siteUrl,
            recipient: v.recipient ?? to,
            confirmationUrl: v.confirmationUrl,
          },
        };
      }
      case "invite": {
        const v = vars as AuthEmailVars["invite"];
        return {
          type: "invite" as const,
          props: {
            siteName,
            siteUrl: v.siteUrl ?? siteUrl,
            confirmationUrl: v.confirmationUrl,
            shopName: v.shopName,
            branchName: v.branchName,
            role: v.role,
            expiresAt: v.expiresAt,
          },
        };
      }
      case "magiclink": {
        const v = vars as AuthEmailVars["magiclink"];
        return {
          type: "magiclink" as const,
          props: { siteName, confirmationUrl: v.confirmationUrl },
        };
      }
      case "recovery": {
        const v = vars as AuthEmailVars["recovery"];
        return {
          type: "recovery" as const,
          props: { siteName, confirmationUrl: v.confirmationUrl },
        };
      }
      case "email_change": {
        const v = vars as AuthEmailVars["email_change"];
        return {
          type: "email_change" as const,
          props: {
            siteName,
            oldEmail: v.oldEmail,
            email: v.email,
            newEmail: v.newEmail,
            confirmationUrl: v.confirmationUrl,
          },
        };
      }
      case "reauthentication": {
        const v = vars as AuthEmailVars["reauthentication"];
        return {
          type: "reauthentication" as const,
          props: { token: v.token },
        };
      }
      default: {
        const exhaustive: never = type;
        throw new Error(`Unknown auth email type: ${String(exhaustive)}`);
      }
    }
  }

  private renderTransactional<T extends TransactionalEmailType>(
    type: T,
    vars: TransactionalEmailVars[T],
  ) {
    switch (type) {
      case "password_changed":
        return renderPasswordChanged(vars as TransactionalEmailVars["password_changed"]);
      case "new_customer_joined":
        return renderNewCustomerJoined(vars as TransactionalEmailVars["new_customer_joined"]);
      case "reward_earned_owner":
        return renderRewardEarnedOwner(vars as TransactionalEmailVars["reward_earned_owner"]);
      case "reward_earned_customer":
        return renderRewardEarnedCustomer(
          vars as TransactionalEmailVars["reward_earned_customer"],
        );
      case "owner_preference_notification":
        return renderOwnerPreferenceNotification(
          vars as TransactionalEmailVars["owner_preference_notification"],
        );
      default: {
        const exhaustive: never = type;
        throw new Error(`Unknown transactional email type: ${String(exhaustive)}`);
      }
    }
  }
}

export { renderCampaignSms };

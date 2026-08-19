import * as React from "react";
import { render } from "@react-email/render";

import type { RenderedMessage } from "./contracts";
import { EmailChangeEmail } from "./templates/auth/email-change";
import { InviteEmail } from "./templates/auth/invite";
import { MagicLinkEmail } from "./templates/auth/magic-link";
import { ReauthenticationEmail } from "./templates/auth/reauthentication";
import { RecoveryEmail } from "./templates/auth/recovery";
import { SignupEmail } from "./templates/auth/signup";
import { AUTH_EMAIL_SUBJECTS, type AuthEmailType } from "./templates/auth/subjects";
import { buildCampaignHtml } from "./templates/campaign/build-html";
import { personalize } from "./templates/campaign/personalize";

export { AUTH_EMAIL_SUBJECTS, type AuthEmailType };

export type AuthRenderInput =
  | { type: "signup"; props: React.ComponentProps<typeof SignupEmail> }
  | { type: "invite"; props: React.ComponentProps<typeof InviteEmail> }
  | { type: "magiclink"; props: React.ComponentProps<typeof MagicLinkEmail> }
  | { type: "recovery"; props: React.ComponentProps<typeof RecoveryEmail> }
  | { type: "email_change"; props: React.ComponentProps<typeof EmailChangeEmail> }
  | { type: "reauthentication"; props: React.ComponentProps<typeof ReauthenticationEmail> };

function authElement(input: AuthRenderInput): React.ReactElement {
  switch (input.type) {
    case "signup":
      return React.createElement(SignupEmail, input.props);
    case "invite":
      return React.createElement(InviteEmail, input.props);
    case "magiclink":
      return React.createElement(MagicLinkEmail, input.props);
    case "recovery":
      return React.createElement(RecoveryEmail, input.props);
    case "email_change":
      return React.createElement(EmailChangeEmail, input.props);
    case "reauthentication":
      return React.createElement(ReauthenticationEmail, input.props);
  }
}

/** Render preserved auth React Email templates to HTML (+ subject). */
export async function renderAuthEmail(input: AuthRenderInput): Promise<RenderedMessage> {
  const html = await render(authElement(input));
  return {
    subject: AUTH_EMAIL_SUBJECTS[input.type],
    html,
    text: html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  };
}

export type CampaignRenderInput = {
  businessName: string;
  subjectTemplate: string;
  messageTemplate: string;
  tokens: {
    name?: string;
    first_name?: string;
    business_name?: string;
  };
};

/** Campaign email: same personalization tokens + HTML wrapper as before the move. */
export function renderCampaignEmail(input: CampaignRenderInput): RenderedMessage {
  const ctx: Record<string, string> = {
    name: input.tokens.name ?? "",
    first_name: input.tokens.first_name ?? "",
    business_name: input.tokens.business_name ?? input.businessName,
  };
  const subject = personalize(input.subjectTemplate, ctx);
  const bodyText = personalize(input.messageTemplate, ctx);
  const html = buildCampaignHtml(input.businessName, bodyText);
  return { subject, html, text: bodyText };
}

/** Campaign SMS body — same tokens; transport stub fails until a provider is chosen. */
export function renderCampaignSms(input: {
  messageTemplate: string;
  tokens: CampaignRenderInput["tokens"];
  businessName: string;
}): { text: string } {
  const ctx: Record<string, string> = {
    name: input.tokens.name ?? "",
    first_name: input.tokens.first_name ?? "",
    business_name: input.tokens.business_name ?? input.businessName,
  };
  return { text: personalize(input.messageTemplate, ctx) };
}

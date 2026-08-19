import { escapeHtml as esc } from "../html";

/**
 * Transactional emails, ported verbatim from the `loyollo-web` services that
 * previously owned them (ADR-018): `security-service.ts` (password changed) and
 * `join-service.ts` (new customer, reward earned). Copy and markup are unchanged —
 * only ownership moved.
 */
export type TransactionalEmailType =
  | "password_changed"
  | "new_customer_joined"
  | "reward_earned_owner"
  | "reward_earned_customer"
  | "owner_preference_notification";

export type RenderedTransactional = {
  subject: string;
  html: string;
  text: string;
};

function shell(businessName: string, inner: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f6fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <div style="background:#fff;border-radius:14px;padding:32px;border:1px solid #eef1f7;">
${inner}
    </div>
    <p style="margin:16px 0 0;text-align:center;font-size:12px;color:#8698bb;">Sent by ${esc(businessName)} via Loyollo</p>
  </div>
</body></html>`;
}

export function renderPasswordChanged(vars: {
  businessName: string;
  changedAt?: string;
}): RenderedTransactional {
  const businessName = vars.businessName;
  const whenStr = vars.changedAt ?? new Date().toUTCString();
  const subject = "Your password was changed";
  const heading = "Your password was changed";
  const body = `We're letting you know the password on your ${businessName} account was just changed at ${whenStr}. If this was you, no action is needed. If this wasn't you, please contact support immediately at support@loyollo.com and reset your password.`;

  return {
    subject,
    text: `${heading}\n\n${body}`,
    html: shell(
      businessName,
      `      <h1 style="margin:0 0 12px 0;font-size:20px;color:#0a152f;">${esc(heading)}</h1>
      <p style="margin:0 0 16px 0;line-height:1.55;color:#0a152f;font-size:15px;">${esc(body)}</p>`,
    ),
  };
}

export function renderNewCustomerJoined(vars: {
  businessName: string;
  customerName: string;
  profileUrl: string;
}): RenderedTransactional {
  const { businessName, customerName, profileUrl } = vars;
  return {
    subject: `New customer joined: ${customerName}`,
    text: `${customerName} just joined your loyalty program.\n\nView their profile: ${profileUrl}`,
    html: shell(
      businessName,
      `      <h1 style="margin:0 0 12px 0;font-size:20px;color:#0a152f;">New customer joined</h1>
      <p style="margin:0 0 20px 0;line-height:1.55;color:#0a152f;font-size:15px;"><strong>${esc(customerName)}</strong> just joined your loyalty program.</p>
      <p style="margin:0 0 24px 0;"><a href="${esc(profileUrl)}" style="display:inline-block;background:#0a152f;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-size:14px;">View customer profile</a></p>`,
    ),
  };
}

export function renderRewardEarnedOwner(vars: {
  businessName: string;
  customerName: string;
  rewardName: string;
  profileUrl: string;
}): RenderedTransactional {
  const { businessName, customerName, rewardName, profileUrl } = vars;
  return {
    subject: `${customerName} earned a reward`,
    text: `${customerName} just earned "${rewardName}" in your loyalty program.\n\nView their profile: ${profileUrl}`,
    html: shell(
      businessName,
      `      <h1 style="margin:0 0 12px 0;font-size:20px;color:#0a152f;">Reward earned 🎉</h1>
      <p style="margin:0 0 20px 0;line-height:1.55;color:#0a152f;font-size:15px;"><strong>${esc(customerName)}</strong> just earned <strong>${esc(rewardName)}</strong>.</p>
      <p style="margin:0 0 24px 0;"><a href="${esc(profileUrl)}" style="display:inline-block;background:#0a152f;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-size:14px;">View customer profile</a></p>`,
    ),
  };
}

export function renderRewardEarnedCustomer(vars: {
  businessName: string;
  customerName: string;
  rewardName: string;
}): RenderedTransactional {
  const { businessName, customerName, rewardName } = vars;
  return {
    subject: `You earned ${rewardName} at ${businessName}!`,
    text: `Congratulations ${customerName}!\n\nYou just earned "${rewardName}" from ${businessName}. Show this email or your card next visit to redeem.`,
    html: `<!doctype html><html><body style="margin:0;padding:0;background:#f4f6fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <div style="background:#fff;border-radius:14px;padding:32px;border:1px solid #eef1f7;text-align:center;">
      <div style="font-size:36px;">🎉</div>
      <h1 style="margin:12px 0 8px 0;font-size:22px;color:#0a152f;">Congratulations, ${esc(customerName)}!</h1>
      <p style="margin:0 0 16px 0;line-height:1.55;color:#0a152f;font-size:15px;">You've earned <strong>${esc(rewardName)}</strong> at ${esc(businessName)}.</p>
      <p style="margin:0;color:#525252;font-size:14px;">Show this email or your loyalty card on your next visit to redeem.</p>
    </div>
    <p style="margin:16px 0 0;text-align:center;font-size:12px;color:#8698bb;">Sent by ${esc(businessName)} via Loyollo</p>
  </div>
</body></html>`,
  };
}

/**
 * Generic owner-preference notification. `POST /api/notifications/owner` previously
 * only wrote the in-app row and left the email side unimplemented; this is the same
 * visual shell as the other owner notifications above.
 */
export function renderOwnerPreferenceNotification(vars: {
  businessName: string;
  title: string;
  message: string;
  ctaLabel?: string;
  ctaUrl?: string;
  subject?: string;
}): RenderedTransactional {
  const { businessName, title, message, ctaLabel, ctaUrl } = vars;
  const cta =
    ctaUrl && ctaLabel
      ? `\n      <p style="margin:0 0 24px 0;"><a href="${esc(ctaUrl)}" style="display:inline-block;background:#0a152f;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-size:14px;">${esc(ctaLabel)}</a></p>`
      : "";

  return {
    subject: vars.subject ?? title,
    text: ctaUrl ? `${title}\n\n${message}\n\n${ctaUrl}` : `${title}\n\n${message}`,
    html: shell(
      businessName,
      `      <h1 style="margin:0 0 12px 0;font-size:20px;color:#0a152f;">${esc(title)}</h1>
      <p style="margin:0 0 20px 0;line-height:1.55;color:#0a152f;font-size:15px;">${esc(message)}</p>${cta}`,
    ),
  };
}

/** Auth email subjects — preserve current copy (docs/frontend/17-messaging-templates.md). */
export const AUTH_EMAIL_SUBJECTS = {
  signup: "Confirm your email",
  invite: "You've been invited",
  magiclink: "Your login link",
  recovery: "Reset your password",
  email_change: "Confirm your new email",
  reauthentication: "Your verification code",
} as const;

export type AuthEmailType = keyof typeof AUTH_EMAIL_SUBJECTS;

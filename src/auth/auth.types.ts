export type ProfileRole = "admin" | "staff" | "customer";
export type AccountStatus = "active" | "inactive" | "pending";

export type SessionUser = {
  id: string;
  email: string | null;
  role: ProfileRole;
  account_status: AccountStatus;
  owner_id: string;
  must_change_password: boolean;
};

export type AuthTokens = {
  access_token: string;
  refresh_token: string;
};

export type AuthResponse = {
  user: SessionUser;
  access_token: string;
  refresh_token: string;
};

export type JwtPayload = {
  sub: string;
  role: ProfileRole;
  account_status: AccountStatus;
  owner_id: string;
  email?: string;
};

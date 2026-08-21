import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";

import { generateRawToken, sha256 } from "../common/crypto.util";
import type { AppConfig } from "../config/configuration";
import { permissionsFor, type Permission } from "../authz/permissions";
import type { Prisma } from "../generated/prisma/client";
import { Role, type AccountStatus } from "../generated/prisma/enums";
import { PrismaService } from "../prisma/prisma.service";
import type { AccessTokenClaims } from "./authenticated-user";

export type SessionProfile = {
  id: string;
  email: string;
  role: Role;
  account_status: AccountStatus;
  email_confirmed_at: Date | null;
  owner_id: string | null;
  onboarding_completed: boolean;
};

export type SessionUser = {
  id: string;
  email: string;
  role: Role;
  account_status: AccountStatus;
  email_confirmed_at: string | null;
  owner_id: string;
  onboarding_completed: boolean;
};

export type SessionResponse = {
  user: SessionUser;
  permissions: Permission[];
  access_token: string;
  refresh_token: string;
};

/** `owner_id` is stored null for `admin` but always resolves to their own id. */
export function shopScopeOf(profile: Pick<SessionProfile, "id" | "owner_id">): string {
  return profile.owner_id ?? profile.id;
}

export function toSessionUser(profile: SessionProfile): SessionUser {
  return {
    id: profile.id,
    email: profile.email,
    role: profile.role,
    account_status: profile.account_status,
    email_confirmed_at: profile.email_confirmed_at?.toISOString() ?? null,
    owner_id: shopScopeOf(profile),
    onboarding_completed: profile.onboarding_completed,
  };
}

@Injectable()
export class TokenService {
  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  private get authConfig() {
    return this.config.get("auth", { infer: true });
  }

  async signAccessToken(profile: SessionProfile): Promise<string> {
    const claims: AccessTokenClaims = {
      sub: profile.id,
      email: profile.email,
      role: profile.role,
      account_status: profile.account_status,
      email_confirmed_at: profile.email_confirmed_at?.toISOString() ?? null,
      owner_id: shopScopeOf(profile),
    };
    return this.jwt.signAsync(claims);
  }

  /** Creates a new refresh-token row and returns the raw value (never persisted). */
  async issueRefreshToken(
    profileId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ raw: string; id: string }> {
    const client = tx ?? this.prisma;
    const raw = generateRawToken();
    const expiresAt = new Date(
      Date.now() + this.authConfig.refreshTtlDays * 24 * 60 * 60 * 1000,
    );

    const row = await client.refreshToken.create({
      data: { profile_id: profileId, token_hash: sha256(raw), expires_at: expiresAt },
      select: { id: true },
    });

    return { raw, id: row.id };
  }

  async issueSession(
    profile: SessionProfile,
    tx?: Prisma.TransactionClient,
  ): Promise<SessionResponse> {
    const [accessToken, refresh] = await Promise.all([
      this.signAccessToken(profile),
      this.issueRefreshToken(profile.id, tx),
    ]);

    return {
      user: toSessionUser(profile),
      permissions: permissionsFor(profile.role),
      access_token: accessToken,
      refresh_token: refresh.raw,
    };
  }

  /**
   * The single revocation path. `sign-out-all`, password reset/change, refresh-reuse
   * detection, and admin deactivation all call this — there is no second one.
   */
  async revokeAllForProfile(
    profileId: string,
    options: { exceptTokenHash?: string; tx?: Prisma.TransactionClient } = {},
  ): Promise<number> {
    const client = options.tx ?? this.prisma;
    const result = await client.refreshToken.updateMany({
      where: {
        profile_id: profileId,
        revoked_at: null,
        ...(options.exceptTokenHash ? { token_hash: { not: options.exceptTokenHash } } : {}),
      },
      data: { revoked_at: new Date() },
    });
    return result.count;
  }
}

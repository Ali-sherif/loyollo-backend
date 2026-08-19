import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import * as bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import type { AccountStatus, ProfileRole } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { RefreshDto, SignInDto, SignUpDto, ForgotPasswordDto, ResetPasswordDto, ChangePasswordDto } from "./auth.dto";
import type { AuthResponse, JwtPayload, SessionUser } from "./auth.types";
import { AuthMailerService } from "./auth-mailer.service";

const ACCESS_TTL = "15m";
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mailer: AuthMailerService,
  ) {}

  async signUp(dto: SignUpDto): Promise<AuthResponse> {
    const existing = await this.prisma.profile.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (existing) {
      throw new ForbiddenException({
        code: "EMAIL_ALREADY_REGISTERED",
        message: "An account with this email already exists.",
      });
    }

    const password_hash = await bcrypt.hash(dto.password, 12);
    const id = crypto.randomUUID();
    const profile = await this.prisma.profile.create({
      data: {
        id,
        email: dto.email.toLowerCase(),
        password_hash,
        role: "admin",
        account_status: "active",
        owner_id: id,
        full_name: dto.full_name,
        business_name: dto.business_name,
        phone: dto.phone,
      },
    });

    return this.issueSession(profile);
  }

  async signIn(dto: SignInDto): Promise<AuthResponse> {
    const profile = await this.prisma.profile.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (!profile) {
      throw new UnauthorizedException({
        code: "INVALID_CREDENTIALS",
        message: "Invalid email or password.",
      });
    }

    const valid = await bcrypt.compare(dto.password, profile.password_hash);
    if (!valid) {
      throw new UnauthorizedException({
        code: "INVALID_CREDENTIALS",
        message: "Invalid email or password.",
      });
    }

    this.assertMerchantSessionAllowed(profile.role, profile.account_status);
    return this.issueSession(profile);
  }

  async refresh(dto: RefreshDto): Promise<Omit<AuthResponse, "refresh_token"> & { access_token: string; user: SessionUser }> {
    const refreshToken = dto.refresh_token;
    if (!refreshToken) {
      throw new UnauthorizedException();
    }

    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync<{ sub: string }>(refreshToken, {
        secret: this.config.getOrThrow<string>("JWT_REFRESH_SECRET"),
      });
    } catch {
      throw new UnauthorizedException();
    }

    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { token_hash: tokenHash },
      include: { profile: true },
    });
    if (!stored || stored.expires_at < new Date() || stored.profile_id !== payload.sub) {
      throw new UnauthorizedException();
    }

    const profile = stored.profile;
    this.assertMerchantSessionAllowed(profile.role, profile.account_status);

    const access_token = await this.signAccessToken(profile);
    return {
      user: this.toSessionUser(profile),
      access_token,
    };
  }

  async signOut(refreshToken?: string): Promise<void> {
    if (!refreshToken) return;
    const tokenHash = this.hashToken(refreshToken);
    await this.prisma.refreshToken.deleteMany({ where: { token_hash: tokenHash } });
  }

  async me(profileId: string): Promise<{ user: SessionUser }> {
    const profile = await this.prisma.profile.findUnique({ where: { id: profileId } });
    if (!profile) {
      throw new UnauthorizedException();
    }
    return { user: this.toSessionUser(profile) };
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ ok: true }> {
    const profile = await this.prisma.profile.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (!profile || profile.role === "customer") {
      return { ok: true };
    }

    await this.prisma.passwordResetToken.deleteMany({ where: { profile_id: profile.id } });
    const rawToken = createHash("sha256")
      .update(`${profile.id}:${Date.now()}:${crypto.randomUUID()}`)
      .digest("hex");
    await this.prisma.passwordResetToken.create({
      data: {
        token_hash: this.hashToken(rawToken),
        profile_id: profile.id,
        expires_at: new Date(Date.now() + RESET_TTL_MS),
      },
    });
    this.mailer.sendPasswordResetEmail(profile.email, rawToken);
    return { ok: true };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<AuthResponse> {
    const tokenHash = this.hashToken(dto.token);
    const stored = await this.prisma.passwordResetToken.findUnique({
      where: { token_hash: tokenHash },
      include: { profile: true },
    });
    if (!stored || stored.expires_at < new Date()) {
      throw new UnauthorizedException({
        code: "INVALID_RESET_TOKEN",
        message: "This reset link is invalid or has expired.",
      });
    }

    const profile = stored.profile;
    if (profile.role === "customer") {
      throw new ForbiddenException({
        code: "FORBIDDEN_ROLE",
        message: "Customer sessions cannot access merchant APIs.",
      });
    }
    if (profile.account_status === "inactive") {
      throw new ForbiddenException({
        code: "ACCOUNT_NOT_ACTIVE",
        message: "This account is inactive.",
      });
    }

    const password_hash = await bcrypt.hash(dto.password, 12);
    const updated = await this.prisma.profile.update({
      where: { id: profile.id },
      data: {
        password_hash,
        account_status: profile.account_status === "pending" ? "active" : profile.account_status,
      },
    });

    await this.prisma.passwordResetToken.deleteMany({ where: { profile_id: profile.id } });
    await this.prisma.refreshToken.deleteMany({ where: { profile_id: profile.id } });

    return this.issueSession(updated);
  }

  async changePassword(
    profileId: string,
    dto: ChangePasswordDto,
  ): Promise<{ user: SessionUser }> {
    const profile = await this.prisma.profile.findUnique({ where: { id: profileId } });
    if (!profile) {
      throw new UnauthorizedException();
    }

    const valid = await bcrypt.compare(dto.current_password, profile.password_hash);
    if (!valid) {
      throw new UnauthorizedException({
        code: "INVALID_CREDENTIALS",
        message: "Current password is incorrect.",
      });
    }

    const password_hash = await bcrypt.hash(dto.new_password, 12);
    const updated = await this.prisma.profile.update({
      where: { id: profile.id },
      data: {
        password_hash,
        account_status: profile.account_status === "pending" ? "active" : profile.account_status,
      },
    });

    await this.prisma.refreshToken.deleteMany({ where: { profile_id: profile.id } });

    return { user: this.toSessionUser(updated) };
  }

  private async issueSession(profile: {
    id: string;
    email: string;
    role: ProfileRole;
    account_status: AccountStatus;
    owner_id: string;
  }): Promise<AuthResponse> {
    const access_token = await this.signAccessToken(profile);
    const refresh_token = await this.signRefreshToken(profile.id);
    return {
      user: this.toSessionUser(profile),
      access_token,
      refresh_token,
    };
  }

  private async signAccessToken(profile: {
    id: string;
    email: string;
    role: ProfileRole;
    account_status: AccountStatus;
    owner_id: string;
  }): Promise<string> {
    const payload: JwtPayload = {
      sub: profile.id,
      role: profile.role,
      account_status: profile.account_status,
      owner_id: profile.owner_id,
      email: profile.email,
    };
    return this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>("JWT_ACCESS_SECRET"),
      expiresIn: ACCESS_TTL,
    });
  }

  private async signRefreshToken(profileId: string): Promise<string> {
    const refresh_token = await this.jwt.signAsync(
      { sub: profileId },
      {
        secret: this.config.getOrThrow<string>("JWT_REFRESH_SECRET"),
        expiresIn: "7d",
      },
    );
    await this.prisma.refreshToken.create({
      data: {
        token_hash: this.hashToken(refresh_token),
        profile_id: profileId,
        expires_at: new Date(Date.now() + REFRESH_TTL_MS),
      },
    });
    return refresh_token;
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private toSessionUser(profile: {
    id: string;
    email: string;
    role: ProfileRole;
    account_status: AccountStatus;
    owner_id: string;
  }): SessionUser {
    return {
      id: profile.id,
      email: profile.email,
      role: profile.role,
      account_status: profile.account_status,
      owner_id: profile.owner_id,
      must_change_password: profile.account_status === "pending",
    };
  }

  private assertMerchantSessionAllowed(role: ProfileRole, account_status: AccountStatus): void {
    if (role === "customer") {
      throw new ForbiddenException({
        code: "FORBIDDEN_ROLE",
        message: "Customer sessions cannot access merchant APIs.",
      });
    }
    if (account_status === "inactive") {
      throw new ForbiddenException({
        code: "ACCOUNT_NOT_ACTIVE",
        message: "This account is inactive.",
      });
    }
  }
}

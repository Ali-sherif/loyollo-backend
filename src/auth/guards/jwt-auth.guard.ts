import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";

import { AppError, ERROR_CODES } from "../../common/app.error";
import { AccountStatus, Role } from "../../generated/prisma/enums";
import { PrismaService } from "../../prisma/prisma.service";
import type { AccessTokenClaims, AuthenticatedUser } from "../authenticated-user";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

/**
 * Registered globally via `APP_GUARD`, so a new route is protected unless it opts
 * out with `@Public()`.
 *
 * Beyond signature verification it applies two coarse gates:
 * - `role === 'customer'` → 403 `FORBIDDEN_ROLE` (customers never reach merchant routes)
 * - live `account_status !== 'active'` → 403 `ACCOUNT_NOT_ACTIVE`
 *
 * The status check re-reads `profiles` on every request rather than trusting the
 * claim, so an admin deactivation takes effect on the very next request instead of
 * up to 15 minutes later (ADR-005). This is one indexed primary-key lookup — not a
 * cache, and deliberately not a Redis token denylist.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const token = extractBearerToken(request);
    if (!token) {
      throw AppError.unauthorized(ERROR_CODES.UNAUTHENTICATED, "Authentication required.");
    }

    let claims: AccessTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessTokenClaims>(token);
    } catch {
      throw AppError.unauthorized(ERROR_CODES.UNAUTHENTICATED, "Session expired or invalid.");
    }

    if (claims.role === Role.customer) {
      throw AppError.forbidden(
        ERROR_CODES.FORBIDDEN_ROLE,
        "This account cannot access merchant resources.",
      );
    }

    const live = await this.prisma.profile.findUnique({
      where: { id: claims.sub },
      select: { account_status: true },
    });

    if (!live) {
      throw AppError.unauthorized(ERROR_CODES.UNAUTHENTICATED, "Session expired or invalid.");
    }

    if (live.account_status !== AccountStatus.active) {
      throw AppError.forbidden(
        ERROR_CODES.ACCOUNT_NOT_ACTIVE,
        "This account is not active.",
        { account_status: live.account_status },
      );
    }

    request.user = {
      id: claims.sub,
      email: claims.email,
      role: claims.role,
      account_status: live.account_status,
      owner_id: claims.owner_id,
    };

    return true;
  }
}

export function extractBearerToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

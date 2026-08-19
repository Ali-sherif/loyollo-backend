import { ExecutionContext, HttpException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerLimitDetail,
  type ThrottlerModuleOptions,
  type ThrottlerRequest,
  type ThrottlerStorage,
} from "@nestjs/throttler";

import { AppError, ERROR_CODES } from "../common/app.error";
import { normalizeEmail, sha256 } from "../common/crypto.util";
import type { AppConfig } from "../config/configuration";
import { RATE_LIMIT_KEY, TRACK_BY_KEY } from "./rate-limit.decorator";
import {
  DEFAULT_THROTTLER,
  policyFor,
  type ThrottlerName,
  type TrackStrategy,
} from "./throttlers";

const CALLER_ID_CACHE = Symbol("rate-limit.callerId");

type MaybeAuthenticatedRequest = {
  ip?: string;
  body?: Record<string, unknown>;
  user?: { id?: string };
  headers?: Record<string, unknown>;
  socket?: { remoteAddress?: string };
  [CALLER_ID_CACHE]?: string | null;
};

/**
 * Bucketing is decided per route and per policy rather than by one global
 * tracker (ADR-020 §B). A single `IP + email` tracker would leave every route
 * without an email in the body — refresh, reset, resend — silently sharing one
 * address bucket, and would let an account sweep pass unnoticed because each
 * request carries a different email.
 *
 * Failure behaviour is deliberate: when Redis is unreachable the auth policies
 * reject with 503 rather than waving traffic through, because an unavailable
 * limiter is exactly the moment brute force gets cheap. The generic baseline
 * fails open so an outage in a non-security control cannot take down reads.
 *
 * This guard runs ahead of `JwtAuthGuard` so a flood is rejected before it
 * reaches the database. That means `request.user` is not populated yet, so
 * user-scoped policies verify the bearer token themselves rather than trusting
 * an unverified `sub` — otherwise anyone could spread their traffic across
 * buckets by forging the claim.
 */
@Injectable()
export class RouteAwareThrottlerGuard extends ThrottlerGuard {
  private readonly logger = new Logger(RouteAwareThrottlerGuard.name);
  private readonly trackerSalt: string;

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    config: ConfigService<AppConfig, true>,
    private readonly jwt: JwtService,
  ) {
    super(options, storageService, reflector);
    this.trackerSalt = config.get("auth", { infer: true }).trackerSalt;
  }

  protected async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const name = requestProps.throttler.name ?? DEFAULT_THROTTLER;
    try {
      return await super.handleRequest(requestProps);
    } catch (error) {
      // A 429 (or any deliberate rejection) must pass through untouched; only a
      // storage failure gets translated.
      if (error instanceof HttpException) throw error;

      const failClosed = policyFor(name)?.failClosed ?? true;
      const route = routeOf(requestProps.context);
      this.logger.error(
        `Rate-limit store unavailable for policy "${name}" on ${route}; ` +
          (failClosed ? "rejecting request" : "allowing request"),
        error instanceof Error ? error.stack : undefined,
      );

      if (!failClosed) return true;
      throw AppError.serviceUnavailable(
        ERROR_CODES.RATE_LIMIT_STORE_UNAVAILABLE,
        "Rate limiting is temporarily unavailable. Please try again shortly.",
      );
    }
  }

  protected generateKey(context: ExecutionContext, suffix: string, name: string): string {
    const request = context.switchToHttp().getRequest<MaybeAuthenticatedRequest>();
    const strategy = this.strategyFor(context, name);
    const tracker = buildTracker(request, suffix, strategy, () => this.callerId(request));
    // The salt keeps Redis keys opaque: emails and tokens never leave the process
    // in a form anyone can read back out of the store.
    return `throttle:${name}:${routeOf(context)}:${sha256(`${this.trackerSalt}|${tracker}`)}`;
  }

  protected async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const retryAfterSeconds = Math.max(1, Math.ceil(detail.timeToBlockExpire || detail.timeToExpire));
    const response = context.switchToHttp().getResponse<{ header?: (k: string, v: string) => void }>();
    response.header?.("Retry-After", String(retryAfterSeconds));
    throw AppError.tooManyRequests(
      "Too many requests. Please wait before trying again.",
      retryAfterSeconds,
    );
  }

  private strategyFor(context: ExecutionContext, name: string): TrackStrategy {
    const override = this.reflector.getAllAndOverride<
      TrackStrategy | Partial<Record<ThrottlerName, TrackStrategy>> | undefined
    >(TRACK_BY_KEY, [context.getHandler(), context.getClass()]);

    if (typeof override === "string") return override;
    if (override && name in override) {
      return override[name as ThrottlerName]!;
    }
    return policyFor(name)?.strategy ?? "ip";
  }

  /**
   * The caller's id, from `JwtAuthGuard` if it has already run, otherwise from a
   * signature-verified bearer token. Memoized so stacking two policies on one
   * route does not verify twice.
   */
  private callerId(request: MaybeAuthenticatedRequest): string | null {
    if (request.user?.id) return request.user.id;
    if (CALLER_ID_CACHE in request) return request[CALLER_ID_CACHE] ?? null;

    const header = request.headers?.authorization;
    const token =
      typeof header === "string" && header.startsWith("Bearer ")
        ? header.slice("Bearer ".length).trim()
        : null;

    let id: string | null = null;
    if (token) {
      try {
        id = this.jwt.verify<{ sub?: string }>(token).sub ?? null;
      } catch {
        // Expired or forged: the address bucket handles it.
        id = null;
      }
    }

    request[CALLER_ID_CACHE] = id;
    return id;
  }
}

function routeOf(context: ExecutionContext): string {
  return `${context.getClass().name}.${context.getHandler().name}`;
}

function clientIp(request: MaybeAuthenticatedRequest, fallback: string): string {
  return request.ip ?? request.socket?.remoteAddress ?? fallback ?? "unknown-ip";
}

function bodyString(request: MaybeAuthenticatedRequest, field: string): string | null {
  const value = request.body?.[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Every strategy degrades to the address bucket when its input is absent, so a
 * caller cannot escape a limit by omitting the field it is keyed on.
 */
function buildTracker(
  request: MaybeAuthenticatedRequest,
  ipSuffix: string,
  strategy: TrackStrategy,
  callerId: () => string | null,
): string {
  const ip = `ip:${clientIp(request, ipSuffix)}`;

  switch (strategy) {
    case "ip":
      return ip;
    case "ip-email": {
      const email = bodyString(request, "email");
      return email ? `${ip}|email:${normalizeEmail(email)}` : ip;
    }
    case "ip-token": {
      const token = bodyString(request, "token");
      return token ? `${ip}|token:${sha256(token)}` : ip;
    }
    case "refresh": {
      const refresh = bodyString(request, "refresh_token");
      return refresh ? `refresh:${sha256(refresh)}` : ip;
    }
    case "user":
    case "user-or-ip": {
      const id = callerId();
      return id ? `user:${id}` : ip;
    }
  }
}

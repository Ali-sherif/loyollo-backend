import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";

import { AppError, ERROR_CODES } from "../common/app.error";
import { timingSafeEqualString } from "../common/crypto.util";
import type { AppConfig } from "../config/configuration";

/**
 * Service-to-service auth for `POST /messaging/email` (ADR-018).
 * Timing-safe compare against `MESSAGING_INTERNAL_SECRET`. The secret and the
 * presented value are never logged.
 */
@Injectable()
export class InternalSecretGuard implements CanActivate {
  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    const expected = this.config.get("messaging", { infer: true }).internalSecret;

    if (!presented || !timingSafeEqualString(presented, expected)) {
      throw AppError.unauthorized(
        ERROR_CODES.UNAUTHENTICATED,
        "Invalid internal service credentials.",
      );
    }

    return true;
  }
}

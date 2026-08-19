import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "is_public";

/**
 * Opts a route out of `JwtAuthGuard` only. Throttling still applies unless the
 * route is explicitly `@SkipThrottle()` (ADR-020 §E).
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

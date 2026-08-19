import { SetMetadata } from "@nestjs/common";

import type { ThrottlerName, TrackStrategy } from "./throttlers";

export const RATE_LIMIT_KEY = "rate_limit:policies";
export const TRACK_BY_KEY = "rate_limit:track_by";

/**
 * Opts a handler into named policies from `THROTTLER_POLICIES`. Policies other
 * than `default` are inert until a route asks for them, so adding a policy to the
 * table cannot accidentally start throttling unrelated endpoints.
 *
 * ```ts
 * @RateLimit(RATE_LIMITS.authStrict)
 * ```
 */
export const RateLimit = (policies: readonly ThrottlerName[]) =>
  SetMetadata(RATE_LIMIT_KEY, policies);

/**
 * Overrides the tracking strategy a policy normally uses, for the rare route
 * where the default does not fit. Pass a strategy to change every policy on the
 * route, or a map to change one.
 */
export const TrackBy = (
  strategy: TrackStrategy | Partial<Record<ThrottlerName, TrackStrategy>>,
) => SetMetadata(TRACK_BY_KEY, strategy);

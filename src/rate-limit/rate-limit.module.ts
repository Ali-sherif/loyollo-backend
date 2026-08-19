import { type ExecutionContext, Module } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ThrottlerModule, type ThrottlerOptions } from "@nestjs/throttler";
import { ThrottlerStorageRedisService } from "@nest-lab/throttler-storage-redis";
import type Redis from "ioredis";

import { RATE_LIMIT_KEY } from "./rate-limit.decorator";
import { REDIS_CLIENT, RedisModule } from "./redis.module";
import { RouteAwareThrottlerGuard } from "./route-aware-throttler.guard";
import { DEFAULT_THROTTLER, THROTTLER_POLICIES, type ThrottlerName } from "./throttlers";

// `Reflector` is a stateless wrapper over `Reflect.getMetadata`, so reading route
// metadata from a plain instance here is equivalent to reading it inside a guard.
const reflector = new Reflector();

function optedIn(name: string, context: ExecutionContext): boolean {
  const policies = reflector.getAllAndOverride<readonly ThrottlerName[] | undefined>(
    RATE_LIMIT_KEY,
    [context.getHandler(), context.getClass()],
  );
  return policies?.includes(name as ThrottlerName) ?? false;
}

/**
 * `ThrottlerGuard` evaluates every configured policy on every request, so each
 * named policy skips itself unless the handler asked for it with `@RateLimit`.
 * Only the baseline is unconditional.
 */
function throttlerDefinitions(): ThrottlerOptions[] {
  return Object.entries(THROTTLER_POLICIES).map(([name, policy]) => ({
    name,
    limit: policy.limit,
    ttl: policy.ttl,
    ...(name === DEFAULT_THROTTLER
      ? {}
      : { skipIf: (context: ExecutionContext) => !optedIn(name, context) }),
  }));
}

@Module({
  imports: [
    RedisModule,
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [REDIS_CLIENT],
      useFactory: (redis: Redis) => ({
        throttlers: throttlerDefinitions(),
        storage: new ThrottlerStorageRedisService(redis),
      }),
    }),
  ],
  providers: [RouteAwareThrottlerGuard],
  exports: [ThrottlerModule, RouteAwareThrottlerGuard],
})
export class RateLimitModule {}

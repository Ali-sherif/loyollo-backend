import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";

import { AuthModule } from "./auth/auth.module";
import { JwtAuthGuard } from "./auth/guards/jwt-auth.guard";
import { PermissionGuard } from "./authz/permission.guard";
import { AllExceptionsFilter } from "./common/all-exceptions.filter";
import { configuration } from "./config/configuration";
import { HealthModule } from "./health/health.module";
import { MessagingModule } from "./messaging/messaging.module";
import { OnboardingModule } from "./onboarding/onboarding.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RateLimitModule } from "./rate-limit/rate-limit.module";
import { RouteAwareThrottlerGuard } from "./rate-limit/route-aware-throttler.guard";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], cache: true }),
    PrismaModule,
    RateLimitModule,
    MessagingModule,
    AuthModule,
    OnboardingModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Order matters (ADR-020). Throttling runs first so a flood is turned away
    // before it costs a token verification or a database round trip; the guard
    // resolves the caller from the bearer token itself for user-scoped policies.
    { provide: APP_GUARD, useClass: RouteAwareThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class AppModule {}

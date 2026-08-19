import { Controller, Get, Inject } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type Redis from "ioredis";

import { Public } from "../auth/decorators/public.decorator";
import { AppError, ERROR_CODES } from "../common/app.error";
import { PrismaService } from "../prisma/prisma.service";
import { REDIS_CLIENT } from "../rate-limit/redis.module";

type Health = { status: "ok" | "error"; db: "up" | "down"; redis: "up" | "down" };

@Controller("health")
@Public()
// Probes poll far more often than a human, and throttling the signal that tells
// you the service is unwell is self-defeating.
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get()
  async check(): Promise<Health> {
    const [db, redis] = await Promise.all([this.checkDb(), this.checkRedis()]);
    const body: Health = {
      status: db === "up" && redis === "up" ? "ok" : "error",
      db,
      redis,
    };

    // Redis down means the auth rate limiter is failing closed, so the instance
    // is genuinely unhealthy even though the database is fine.
    if (body.status === "error") {
      throw AppError.serviceUnavailable(
        ERROR_CODES.SERVICE_UNHEALTHY,
        "One or more dependencies are unavailable.",
        { db, redis },
      );
    }
    return body;
  }

  private async checkDb(): Promise<"up" | "down"> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return "up";
    } catch {
      return "down";
    }
  }

  private async checkRedis(): Promise<"up" | "down"> {
    try {
      return (await this.redis.ping()) === "PONG" ? "up" : "down";
    } catch {
      return "down";
    }
  }
}

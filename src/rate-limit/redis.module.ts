import { Global, Inject, Logger, Module, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

import type { AppConfig } from "../config/configuration";

export const REDIS_CLIENT = "REDIS_CLIENT";

const logger = new Logger("Redis");

function waitUntilReady(client: Redis, timeoutMs: number): Promise<void> {
  if (client.status === "ready") return Promise.resolve();

  return new Promise((resolve) => {
    const settle = () => {
      clearTimeout(timer);
      client.off("ready", settle);
      resolve();
    };
    const timer = setTimeout(() => {
      logger.warn(
        `Redis was not ready within ${timeoutMs}ms; rate-limited routes will refuse requests until it is.`,
      );
      settle();
    }, timeoutMs);
    client.once("ready", settle);
  });
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: async (config: ConfigService<AppConfig, true>): Promise<Redis> => {
        const { host, port, password, db } = config.get("redis", { infer: true });
        const client = new Redis({
          host,
          port,
          password,
          db,
          // Fail fast instead of buffering: a rate-limit check that hangs behind a
          // reconnect queue is worse than one that reports the store is down, and
          // the guard needs a prompt error to apply its fail-closed rule.
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          retryStrategy: (attempt) => Math.min(attempt * 200, 2_000),
        });

        // Without a listener, ioredis promotes connection errors to an unhandled
        // 'error' event and takes the process down.
        client.on("error", (error: Error) => {
          logger.error(`Redis connection error: ${error.message}`);
        });

        // Because the offline queue is disabled, a command issued during the
        // initial handshake fails outright. Settle the connection here so a cold
        // start cannot 503 its own first request; if Redis is genuinely down we
        // still boot (and report unhealthy) rather than blocking forever.
        await waitUntilReady(client, 5_000);

        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }
}

import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type Redis from "ioredis";

import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app.setup";
import { MAILER, type Mailer, type SendEmailInput, type SendResult } from "../src/messaging/contracts";
import { PrismaService } from "../src/prisma/prisma.service";
import { REDIS_CLIENT } from "../src/rate-limit/redis.module";

/**
 * Captures every outbound email instead of sending it, so tests can assert on
 * delivery and pull the one-time links that only ever exist in a message body.
 */
export class CapturingMailer implements Mailer {
  readonly name = "capture";
  readonly sent: SendEmailInput[] = [];
  /** Set to delay resolution, to prove a caller does not await the send. */
  delayMs = 0;
  failNext = false;

  async sendEmail(input: SendEmailInput): Promise<SendResult> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    if (this.failNext) {
      this.failNext = false;
      return { ok: false, error: "forced failure", code: "EMAIL_TRANSPORT_FAILED" };
    }
    this.sent.push(input);
    return { ok: true, providerMessageId: `capture-${this.sent.length}` };
  }

  reset(): void {
    this.sent.length = 0;
    this.delayMs = 0;
    this.failNext = false;
  }

  lastTo(email: string): SendEmailInput | undefined {
    return [...this.sent].reverse().find((message) => message.to === email);
  }

  /** Pulls a `?token=` value out of the most recent message to an address. */
  tokenFor(email: string): string | null {
    const html = this.lastTo(email)?.html ?? "";
    return /[?&]token=([A-Za-z0-9_-]+)/.exec(html)?.[1] ?? null;
  }
}

export type E2EContext = {
  app: INestApplication;
  prisma: PrismaService;
  redis: Redis;
  mailer: CapturingMailer;
  close: () => Promise<void>;
};

export async function createE2EApp(
  options: { resetRateLimits?: boolean } = {},
): Promise<E2EContext> {
  const mailer = new CapturingMailer();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MAILER)
    .useValue(mailer)
    .compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  const redis = app.get<Redis>(REDIS_CLIENT);
  // Each spec file starts from zero counters; files inside one worker run
  // sequentially, so this cannot race a sibling suite. Tests that stand up a
  // second instance to prove counters are shared must opt out.
  if (options.resetRateLimits !== false) {
    await redis.flushdb();
  }

  return {
    app,
    prisma: app.get(PrismaService),
    redis,
    mailer,
    close: () => app.close(),
  };
}

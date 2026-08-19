import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { NestExpressApplication } from "@nestjs/platform-express";

import { AppError, ERROR_CODES } from "./common/app.error";
import type { AppConfig } from "./config/configuration";

/**
 * Everything the HTTP layer needs beyond module wiring. `main.ts` and the e2e
 * harness both call this, so a test never passes because it skipped a pipe that
 * production applies.
 */
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService<AppConfig, true>);

  // Rate limiting buckets by caller address, so a proxy that rewrites the peer
  // address would collapse every client into one bucket. Trust exactly one hop.
  (app as NestExpressApplication).set("trust proxy", 1);

  app.enableCors({
    origin: config.get("corsOrigins", { infer: true }),
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Internal-Secret"],
    // The API authenticates with `Authorization: Bearer`, never a cookie. Refusing
    // credentialed cross-origin requests keeps CSRF out of the backend's threat
    // model entirely — session cookies live only on the Next.js origin (ADR-017).
    credentials: false,
    maxAge: 600,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // Unknown fields are a client bug or a privilege-escalation attempt; either
      // way, rejecting is safer than silently dropping (plan §1.6).
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) =>
        AppError.badRequest(ERROR_CODES.VALIDATION_FAILED, "Request validation failed.", {
          fields: errors.map((error) => ({
            field: error.property,
            constraints: Object.values(error.constraints ?? {}),
          })),
        }),
    }),
  );

  app.enableShutdownHooks();
}

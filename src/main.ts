import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";

import { AppModule } from "./app.module";
import { configureApp } from "./app.setup";
import type { AppConfig } from "./config/configuration";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // The allow-list is applied by `configureApp` once configuration is available.
    cors: false,
  });

  configureApp(app);

  const config = app.get(ConfigService<AppConfig, true>);
  const port = config.get("port", { infer: true });
  const corsOrigins = config.get("corsOrigins", { infer: true });

  await app.listen(port);
  new Logger("Bootstrap").log(
    `Loyollo API listening on :${port} (${config.get("nodeEnv", { infer: true })}); ` +
      `CORS allow-list: ${
        corsOrigins.length > 0 ? corsOrigins.join(", ") : "(empty — browser calls will be refused)"
      }`,
  );
}

void bootstrap();

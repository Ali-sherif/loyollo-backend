import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { AppConfig } from "../config/configuration";
import { MAILER, SMS_TRANSPORT, type Mailer } from "./contracts";
import { LogMailer } from "./mailer/log.mailer";
import { ResendMailer } from "./mailer/resend.mailer";
import { MessagingController } from "./messaging.controller";
import { MessagingService } from "./messaging.service";
import { StubSmsTransport } from "./sms/stub.sms-transport";

@Global()
@Module({
  controllers: [MessagingController],
  providers: [
    MessagingService,
    StubSmsTransport,
    {
      provide: MAILER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>): Mailer => {
        const messaging = config.get("messaging", { infer: true });
        switch (messaging.provider) {
          case "resend":
            // `configuration()` already rejects `resend` without a key at boot.
            return new ResendMailer(messaging.resendApiKey!, messaging.from);
          case "log":
            return new LogMailer();
        }
      },
    },
    { provide: SMS_TRANSPORT, useExisting: StubSmsTransport },
  ],
  exports: [MessagingService, MAILER, SMS_TRANSPORT],
})
export class MessagingModule {}

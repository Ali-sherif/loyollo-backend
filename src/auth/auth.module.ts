import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule, type JwtSignOptions } from "@nestjs/jwt";

import type { AppConfig } from "../config/configuration";
import { AccountsService } from "./accounts.service";
import { AuthAuditService } from "./auth-audit.service";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { InvitationService } from "./invitation.service";
import { TokenService } from "./token.service";

/**
 * Global because `JwtAuthGuard` is registered app-wide in `AppModule` and needs
 * `JwtService` resolvable from the root injector.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const auth = config.get("auth", { infer: true });
        return {
          secret: auth.accessSecret,
          // `configuration()` rejects anything that is not a bare second count or
          // a `ms` span, which is exactly what this narrower type demands.
          signOptions: { expiresIn: auth.accessTtl as JwtSignOptions["expiresIn"] },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    AuthAuditService,
    InvitationService,
    AccountsService,
    JwtAuthGuard,
  ],
  exports: [JwtModule, TokenService, AuthAuditService, JwtAuthGuard],
})
export class AuthModule {}

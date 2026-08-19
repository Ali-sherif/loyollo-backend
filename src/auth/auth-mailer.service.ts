import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class AuthMailerService {
  private readonly logger = new Logger(AuthMailerService.name);

  constructor(private readonly config: ConfigService) {}

  sendPasswordResetEmail(email: string, token: string): void {
    const baseUrl =
      this.config.get<string>("APP_BASE_URL") ?? "http://localhost:3000";
    const resetUrl = `${baseUrl.replace(/\/$/, "")}/auth/reset-password?token=${encodeURIComponent(token)}`;
    // Provider stub — log reset link locally until real email transport is configured.
    this.logger.log(`Password reset for ${email}: ${resetUrl}`);
  }
}

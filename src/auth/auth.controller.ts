import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import type { JwtPayload } from "./auth.types";
import { AuthService } from "./auth.service";
import { RefreshDto, SignInDto, SignUpDto, ForgotPasswordDto, ResetPasswordDto, ChangePasswordDto } from "./auth.dto";
import { JwtAuthGuard } from "./jwt-auth.guard";

type AuthenticatedRequest = Request & { user: JwtPayload };

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("sign-up")
  signUp(@Body() dto: SignUpDto) {
    return this.auth.signUp(dto);
  }

  @Post("sign-in")
  @HttpCode(200)
  signIn(@Body() dto: SignInDto) {
    return this.auth.signIn(dto);
  }

  @Post("refresh")
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto);
  }

  @Post("sign-out")
  @HttpCode(204)
  async signOut(@Body() dto: RefreshDto) {
    await this.auth.signOut(dto.refresh_token);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  me(@Req() req: AuthenticatedRequest) {
    return this.auth.me(req.user.sub);
  }

  @Post("forgot-password")
  @HttpCode(200)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto);
  }

  @Post("reset-password")
  @HttpCode(200)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }

  @Post("change-password")
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  changePassword(@Req() req: AuthenticatedRequest, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(req.user.sub, dto);
  }
}

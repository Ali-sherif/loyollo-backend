import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";

import { RequirePermission } from "../authz/require-permission.decorator";
import { RateLimit } from "../rate-limit/rate-limit.decorator";
import { RATE_LIMITS } from "../rate-limit/throttlers";
import { AccountsService } from "./accounts.service";
import type { AuthenticatedUser } from "./authenticated-user";
import { AuthService } from "./auth.service";
import { CurrentUser } from "./decorators/current-user.decorator";
import { Public } from "./decorators/public.decorator";
import {
  AcceptInviteDto,
  ChangePasswordDto,
  CreateInvitationDto,
  ForgotPasswordDto,
  RefreshDto,
  ResetPasswordDto,
  SignInDto,
  SignOutDto,
  SignUpDto,
  UpdateAccountStatusDto,
  ValidateInvitationDto,
} from "./dto/auth.dto";
import { InvitationService } from "./invitation.service";

function clientIp(request: Request): string | null {
  return request.ip ?? request.socket.remoteAddress ?? null;
}

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly invitations: InvitationService,
    private readonly accounts: AccountsService,
  ) {}

  // --- Public credential routes ---------------------------------------------

  @Post("sign-up")
  @Public()
  @RateLimit(RATE_LIMITS.authStrict)
  signUp(@Body() dto: SignUpDto) {
    return this.auth.signUp(dto);
  }

  @Post("sign-in")
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit(RATE_LIMITS.authStrict)
  signIn(@Body() dto: SignInDto, @Req() request: Request) {
    return this.auth.signIn(dto, clientIp(request));
  }

  @Post("refresh")
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit(RATE_LIMITS.authRefresh)
  refresh(@Body() dto: RefreshDto, @Req() request: Request) {
    return this.auth.refresh(dto, clientIp(request));
  }

  @Post("forgot-password")
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit(RATE_LIMITS.authStrict)
  forgotPassword(@Body() dto: ForgotPasswordDto, @Req() request: Request) {
    return this.auth.forgotPassword(dto, clientIp(request));
  }

  @Post("reset-password")
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit(RATE_LIMITS.authReset)
  resetPassword(@Body() dto: ResetPasswordDto, @Req() request: Request) {
    return this.auth.resetPassword(dto, clientIp(request));
  }

  // --- Authenticated session ------------------------------------------------

  @Get("me")
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user);
  }

  @Post("sign-out")
  @HttpCode(HttpStatus.NO_CONTENT)
  async signOut(@CurrentUser() user: AuthenticatedUser, @Body() dto: SignOutDto) {
    await this.auth.signOut(user.id, dto.refresh_token);
  }

  @Post("sign-out-all")
  @HttpCode(HttpStatus.OK)
  signOutAll(@CurrentUser() user: AuthenticatedUser, @Req() request: Request) {
    return this.auth.signOutAll(user, clientIp(request));
  }

  @Post("change-password")
  @HttpCode(HttpStatus.OK)
  @RateLimit(RATE_LIMITS.authenticatedSelf)
  changePassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user, dto);
  }

  // --- Team invitations (ADR-022) -------------------------------------------

  @Post("team")
  @RequirePermission("team:invite")
  createInvitation(
    @Body() dto: CreateInvitationDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.invitations.create(dto, user, clientIp(request));
  }

  @Post("team/:id/resend")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("team:invite")
  @RateLimit(RATE_LIMITS.inviteResend)
  resendInvitation(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.invitations.resend(id, user, clientIp(request));
  }

  @Post("team/:id/revoke")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("team:invite")
  revokeInvitation(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.invitations.revoke(id, user, clientIp(request));
  }

  @Get("invitations/validate")
  @Public()
  @RateLimit(RATE_LIMITS.authStrict)
  validateInvitation(@Query() query: ValidateInvitationDto) {
    return this.invitations.validate(query.token);
  }

  @Post("accept-invite")
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @RateLimit(RATE_LIMITS.authReset)
  acceptInvite(@Body() dto: AcceptInviteDto, @Req() request: Request) {
    return this.invitations.acceptInvite(dto, clientIp(request));
  }

  // --- Account status -------------------------------------------------------

  @Patch("accounts/:id/status")
  @RequirePermission("account:status:update")
  updateAccountStatus(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateAccountStatusDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.accounts.updateStatus(id, dto, user, clientIp(request));
  }
}

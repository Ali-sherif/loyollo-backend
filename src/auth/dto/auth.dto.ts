import { Transform } from "class-transformer";
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from "class-validator";

import { AccountStatus, Role } from "../../generated/prisma/enums";

/**
 * Password policy: minimum 12 characters, no forced composition rules
 * (length over complexity). Enforced here so every entry point shares it.
 */
const MIN_PASSWORD = 12;
const MAX_PASSWORD = 200;

const normalizeEmailTransform = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim().toLowerCase() : value;

/**
 * `role`, `account_status`, `owner_id`, and `shop_id` are absent from every DTO in
 * this file by design — they are derived server-side. `forbidNonWhitelisted` on the
 * global `ValidationPipe` rejects a request that tries to supply them.
 */
export class SignUpDto {
  @Transform(normalizeEmailTransform)
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(MIN_PASSWORD)
  @MaxLength(MAX_PASSWORD)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  full_name?: string;
}

export class SignInDto {
  @Transform(normalizeEmailTransform)
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MaxLength(MAX_PASSWORD)
  password!: string;
}

export class RefreshDto {
  @IsString()
  @MaxLength(512)
  refresh_token!: string;
}

export class SignOutDto {
  @IsOptional()
  @IsString()
  @MaxLength(512)
  refresh_token?: string;
}

export class ForgotPasswordDto {
  @Transform(normalizeEmailTransform)
  @IsEmail()
  @MaxLength(320)
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @MaxLength(512)
  token!: string;

  @IsString()
  @MinLength(MIN_PASSWORD)
  @MaxLength(MAX_PASSWORD)
  password!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MaxLength(MAX_PASSWORD)
  current_password!: string;

  @IsString()
  @MinLength(MIN_PASSWORD)
  @MaxLength(MAX_PASSWORD)
  new_password!: string;

  /** Optional: the session's own refresh token, so it survives the mass revoke. */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  refresh_token?: string;
}

/** ADR-022: creates an Invitation. `shop_id` is never accepted from the client. */
export class CreateInvitationDto {
  @Transform(normalizeEmailTransform)
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsUUID()
  branch_id!: string;

  @IsIn([Role.admin, Role.staff])
  role!: typeof Role.admin | typeof Role.staff;
}

export class ValidateInvitationDto {
  @IsString()
  @MaxLength(512)
  token!: string;
}

/**
 * ADR-022 §F: `email` / `shop_id` / `branch_id` / `role` are read from the validated
 * Invitation row inside the transaction, never from this request.
 */
export class AcceptInviteDto {
  @IsString()
  @MaxLength(512)
  token!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  full_name!: string;

  @IsString()
  @MinLength(MIN_PASSWORD)
  @MaxLength(MAX_PASSWORD)
  password!: string;
}

export class UpdateAccountStatusDto {
  @IsIn([AccountStatus.active, AccountStatus.inactive])
  account_status!: typeof AccountStatus.active | typeof AccountStatus.inactive;
}

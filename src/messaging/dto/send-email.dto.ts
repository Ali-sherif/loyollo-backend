import { Type } from "class-transformer";
import {
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";

const TRANSACTIONAL_TYPES = [
  "password_changed",
  "new_customer_joined",
  "reward_earned_owner",
  "reward_earned_customer",
  "owner_preference_notification",
] as const;

export class SendTransactionalEmailDto {
  @IsIn(TRANSACTIONAL_TYPES)
  type!: (typeof TRANSACTIONAL_TYPES)[number];

  @IsEmail()
  to!: string;

  @IsObject()
  vars!: Record<string, string>;
}

export class CampaignTokensDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  first_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  business_name?: string;
}

export class SendCampaignEmailDto {
  @IsEmail()
  to!: string;

  @IsString()
  @MaxLength(200)
  businessName!: string;

  @IsString()
  @MaxLength(500)
  subjectTemplate!: string;

  @IsString()
  @MaxLength(20000)
  messageTemplate!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CampaignTokensDto)
  tokens?: CampaignTokensDto;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  messageId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;
}

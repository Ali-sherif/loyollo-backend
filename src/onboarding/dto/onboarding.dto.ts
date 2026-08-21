import { Transform } from "class-transformer";
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

import { PLANS } from "../business-types";

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

const trimEmptyToUndefined = ({ value }: { value: unknown }) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

export class PatchOnboardingDetailsDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  num_locations!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  main_location!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  avg_customers_per_day!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  avg_cheque_per_day!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: "currency must be an ISO 4217 code" })
  currency!: string;

  @IsOptional()
  @Transform(trimEmptyToUndefined)
  @IsString()
  @MaxLength(200)
  website?: string;

  @IsOptional()
  @Transform(trimEmptyToUndefined)
  @IsString()
  @MaxLength(200)
  business_name?: string;
}

export class PatchBusinessTypeDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  business_category!: string;
}

export class PatchIndustryDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  business_type!: string;
}

export class PatchPlanDto {
  @IsIn(PLANS)
  plan!: (typeof PLANS)[number];
}

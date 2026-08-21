import { Injectable } from "@nestjs/common";

import type { AuthenticatedUser } from "../auth/authenticated-user";
import { AppError, ERROR_CODES } from "../common/app.error";
import { PrismaService } from "../prisma/prisma.service";
import {
  isBusinessCategory,
  isIndustryOf,
} from "./business-types";
import type {
  PatchBusinessTypeDto,
  PatchIndustryDto,
  PatchOnboardingDetailsDto,
  PatchPlanDto,
} from "./dto/onboarding.dto";

const ONBOARDING_SELECT = {
  id: true,
  owner_id: true,
  onboarding_completed: true,
  num_locations: true,
  main_location: true,
  website: true,
  avg_customers_per_day: true,
  avg_cheque_per_day: true,
  currency: true,
  business_name: true,
  business_category: true,
  business_type: true,
  plan: true,
} as const;

type OnboardingRow = {
  id: string;
  owner_id: string | null;
  onboarding_completed: boolean;
  num_locations: string | null;
  main_location: string | null;
  website: string | null;
  avg_customers_per_day: string | null;
  avg_cheque_per_day: string | null;
  currency: string | null;
  business_name: string | null;
  business_category: string | null;
  business_type: string | null;
  plan: string | null;
};

export type OnboardingState = {
  onboarding_completed: boolean;
  num_locations: string | null;
  main_location: string | null;
  website: string | null;
  avg_customers_per_day: string | null;
  avg_cheque_per_day: string | null;
  currency: string | null;
  business_name: string | null;
  business_category: string | null;
  business_type: string | null;
  plan: string | null;
};

const REQUIRED_AT_COMPLETE = [
  "currency",
  "business_category",
  "business_type",
  "plan",
  "num_locations",
  "main_location",
  "avg_customers_per_day",
  "avg_cheque_per_day",
] as const satisfies readonly (keyof OnboardingState)[];

function isShopBuyer(row: Pick<OnboardingRow, "id" | "owner_id">): boolean {
  return row.owner_id === null || row.owner_id === row.id;
}

function toState(row: OnboardingRow): OnboardingState {
  return {
    onboarding_completed: row.onboarding_completed,
    num_locations: row.num_locations,
    main_location: row.main_location,
    website: row.website,
    avg_customers_per_day: row.avg_customers_per_day,
    avg_cheque_per_day: row.avg_cheque_per_day,
    currency: row.currency,
    business_name: row.business_name,
    business_category: row.business_category,
    business_type: row.business_type,
    plan: row.plan,
  };
}

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  async get(user: AuthenticatedUser): Promise<OnboardingState> {
    const row = await this.loadBuyer(user.id);
    return toState(row);
  }

  async patchDetails(
    user: AuthenticatedUser,
    dto: PatchOnboardingDetailsDto,
  ): Promise<OnboardingState> {
    const row = await this.loadBuyer(user.id);
    this.assertIncomplete(row, "currency");
    return this.update(row.id, {
      num_locations: dto.num_locations,
      main_location: dto.main_location,
      avg_customers_per_day: dto.avg_customers_per_day,
      avg_cheque_per_day: dto.avg_cheque_per_day,
      currency: dto.currency,
      website: dto.website ?? row.website,
      business_name: dto.business_name ?? row.business_name,
    });
  }

  async patchBusinessType(
    user: AuthenticatedUser,
    dto: PatchBusinessTypeDto,
  ): Promise<OnboardingState> {
    const row = await this.loadBuyer(user.id);
    this.assertIncomplete(row, "other");
    if (!isBusinessCategory(dto.business_category)) {
      throw AppError.badRequest(
        ERROR_CODES.BUSINESS_TYPE_INVALID,
        "Business type is not in the official list.",
      );
    }
    const industryStillValid =
      row.business_type !== null && isIndustryOf(dto.business_category, row.business_type);
    return this.update(row.id, {
      business_category: dto.business_category,
      business_type: industryStillValid ? row.business_type : null,
    });
  }

  async patchIndustry(user: AuthenticatedUser, dto: PatchIndustryDto): Promise<OnboardingState> {
    const row = await this.loadBuyer(user.id);
    this.assertIncomplete(row, "other");
    if (!row.business_category || !isIndustryOf(row.business_category, dto.business_type)) {
      throw AppError.badRequest(
        ERROR_CODES.BUSINESS_INDUSTRY_INVALID,
        "Industry must be an official sub-type of the selected business type.",
      );
    }
    return this.update(row.id, { business_type: dto.business_type });
  }

  async patchPlan(user: AuthenticatedUser, dto: PatchPlanDto): Promise<OnboardingState> {
    const row = await this.loadBuyer(user.id);
    this.assertIncomplete(row, "other");
    return this.update(row.id, { plan: dto.plan });
  }

  async complete(user: AuthenticatedUser): Promise<OnboardingState> {
    const row = await this.loadBuyer(user.id);
    if (row.onboarding_completed) return toState(row);

    const missing = REQUIRED_AT_COMPLETE.filter((field) => !row[field]);
    if (missing.length > 0) {
      throw AppError.badRequest(
        ERROR_CODES.ONBOARDING_INCOMPLETE,
        "Finish every onboarding step before continuing.",
        { missing },
      );
    }

    return this.update(row.id, { onboarding_completed: true });
  }

  private async loadBuyer(profileId: string): Promise<OnboardingRow> {
    const row = await this.prisma.profile.findUnique({
      where: { id: profileId },
      select: ONBOARDING_SELECT,
    });
    if (!row) {
      throw AppError.unauthorized(ERROR_CODES.UNAUTHENTICATED, "Session expired or invalid.");
    }
    if (!isShopBuyer(row)) {
      throw AppError.forbidden(
        ERROR_CODES.ONBOARDING_NOT_APPLICABLE,
        "Shop onboarding is only available to the shop owner.",
      );
    }
    return row;
  }

  private assertIncomplete(row: OnboardingRow, kind: "currency" | "other"): void {
    if (!row.onboarding_completed) return;
    if (kind === "currency") {
      throw AppError.badRequest(
        ERROR_CODES.CURRENCY_LOCKED,
        "Currency is locked after onboarding is complete.",
      );
    }
    throw AppError.forbidden(
      ERROR_CODES.ONBOARDING_NOT_APPLICABLE,
      "Onboarding steps cannot be changed after completion.",
    );
  }

  private async update(
    id: string,
    data: Partial<
      Pick<
        OnboardingRow,
        | "num_locations"
        | "main_location"
        | "website"
        | "avg_customers_per_day"
        | "avg_cheque_per_day"
        | "currency"
        | "business_name"
        | "business_category"
        | "business_type"
        | "plan"
        | "onboarding_completed"
      >
    >,
  ): Promise<OnboardingState> {
    const updated = await this.prisma.profile.update({
      where: { id },
      data,
      select: ONBOARDING_SELECT,
    });
    return toState(updated);
  }
}

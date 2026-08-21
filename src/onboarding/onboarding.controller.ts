import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from "@nestjs/common";

import type { AuthenticatedUser } from "../auth/authenticated-user";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RateLimit } from "../rate-limit/rate-limit.decorator";
import { RATE_LIMITS } from "../rate-limit/throttlers";
import {
  PatchBusinessTypeDto,
  PatchIndustryDto,
  PatchOnboardingDetailsDto,
  PatchPlanDto,
} from "./dto/onboarding.dto";
import { OnboardingService } from "./onboarding.service";

@Controller("api/onboarding")
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.onboarding.get(user);
  }

  @Patch("details")
  @RateLimit(RATE_LIMITS.authenticatedSelf)
  patchDetails(@CurrentUser() user: AuthenticatedUser, @Body() dto: PatchOnboardingDetailsDto) {
    return this.onboarding.patchDetails(user, dto);
  }

  @Patch("business-type")
  @RateLimit(RATE_LIMITS.authenticatedSelf)
  patchBusinessType(@CurrentUser() user: AuthenticatedUser, @Body() dto: PatchBusinessTypeDto) {
    return this.onboarding.patchBusinessType(user, dto);
  }

  @Patch("industry")
  @RateLimit(RATE_LIMITS.authenticatedSelf)
  patchIndustry(@CurrentUser() user: AuthenticatedUser, @Body() dto: PatchIndustryDto) {
    return this.onboarding.patchIndustry(user, dto);
  }

  @Patch("plan")
  @RateLimit(RATE_LIMITS.authenticatedSelf)
  patchPlan(@CurrentUser() user: AuthenticatedUser, @Body() dto: PatchPlanDto) {
    return this.onboarding.patchPlan(user, dto);
  }

  @Post("complete")
  @HttpCode(HttpStatus.OK)
  @RateLimit(RATE_LIMITS.authenticatedSelf)
  complete(@CurrentUser() user: AuthenticatedUser) {
    return this.onboarding.complete(user);
  }
}

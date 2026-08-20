import { SetMetadata } from "@nestjs/common";

export const ALLOW_UNVERIFIED_KEY = "auth:allow_unverified";
export const AllowUnverified = () => SetMetadata(ALLOW_UNVERIFIED_KEY, true);

-- Shop-buyer onboarding fields (docs/backend/data-contract.md).
-- Invitees (owner_id set to a shop other than themselves) skip buyer steps.

ALTER TABLE "profiles" ADD COLUMN "onboarding_completed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "profiles" ADD COLUMN "business_name" TEXT;
ALTER TABLE "profiles" ADD COLUMN "num_locations" TEXT;
ALTER TABLE "profiles" ADD COLUMN "main_location" TEXT;
ALTER TABLE "profiles" ADD COLUMN "website" TEXT;
ALTER TABLE "profiles" ADD COLUMN "avg_customers_per_day" TEXT;
ALTER TABLE "profiles" ADD COLUMN "avg_cheque_per_day" TEXT;
ALTER TABLE "profiles" ADD COLUMN "currency" TEXT;
ALTER TABLE "profiles" ADD COLUMN "business_category" TEXT;
ALTER TABLE "profiles" ADD COLUMN "business_type" TEXT;
ALTER TABLE "profiles" ADD COLUMN "plan" TEXT;

UPDATE "profiles"
SET "onboarding_completed" = true
WHERE "owner_id" IS NOT NULL AND "owner_id" <> "id";

-- Merchant self-registration requires and persists a contact phone number.
-- Nullable for existing profiles and invitation-created teammates.

ALTER TABLE "profiles" ADD COLUMN "phone" TEXT;

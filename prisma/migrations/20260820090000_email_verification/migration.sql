ALTER TYPE "AuthAuditAction" ADD VALUE 'email_verified';
ALTER TYPE "AuthAuditAction" ADD VALUE 'email_verification_resent';

ALTER TABLE "profiles" ADD COLUMN "email_confirmed_at" TIMESTAMPTZ(6);

UPDATE "profiles"
SET "email_confirmed_at" = "created_at"
WHERE "email_confirmed_at" IS NULL;

CREATE TABLE "email_verification_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profile_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_verification_tokens_token_hash_uidx"
ON "email_verification_tokens"("token_hash");

CREATE INDEX "email_verification_tokens_profile_idx"
ON "email_verification_tokens"("profile_id");

CREATE INDEX "email_verification_tokens_expires_idx"
ON "email_verification_tokens"("expires_at")
WHERE "used_at" IS NULL;

ALTER TABLE "email_verification_tokens"
ADD CONSTRAINT "email_verification_tokens_profile_id_fkey"
FOREIGN KEY ("profile_id") REFERENCES "profiles"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

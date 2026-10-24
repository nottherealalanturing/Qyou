-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "IdentityOutcome" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'INCONCLUSIVE');

-- CreateEnum
CREATE TYPE "IdentityMethod" AS ENUM ('MANUAL_REVIEW');

-- CreateTable
CREATE TABLE "assistant_profiles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "displayName" VARCHAR(60) NOT NULL,
    "bio" VARCHAR(600) NOT NULL DEFAULT '',
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "availabilityNote" VARCHAR(200),
    "timezone" VARCHAR(40) NOT NULL DEFAULT 'Africa/Lagos',
    "status" "ApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "statusReason" VARCHAR(500),
    "statusChangedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMPTZ(3),
    "approvedAt" TIMESTAMPTZ(3),
    "identityOutcome" "IdentityOutcome" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assistant_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_private_details" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "legalName" VARCHAR(120),
    "phoneE164" VARCHAR(16),
    "phoneVerifiedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assistant_private_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_service_areas" (
    "profileId" UUID NOT NULL,
    "cityId" UUID NOT NULL,

    CONSTRAINT "assistant_service_areas_pkey" PRIMARY KEY ("profileId","cityId")
);

-- CreateTable
CREATE TABLE "assistant_task_offers" (
    "profileId" UUID NOT NULL,
    "taskId" UUID NOT NULL,

    CONSTRAINT "assistant_task_offers_pkey" PRIMARY KEY ("profileId","taskId")
);

-- CreateTable
CREATE TABLE "assistant_availability_windows" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,

    CONSTRAINT "assistant_availability_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_verification_tokens" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "phoneE164" VARCHAR(16) NOT NULL,
    "codeHash" CHAR(64) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phone_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_checks" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "result" "IdentityOutcome" NOT NULL,
    "method" "IdentityMethod" NOT NULL DEFAULT 'MANUAL_REVIEW',
    "evidenceRef" VARCHAR(120),
    "notes" VARCHAR(500),
    "checkedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assistant_profiles_userId_key" ON "assistant_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "assistant_profiles_slug_key" ON "assistant_profiles"("slug");

-- CreateIndex
CREATE INDEX "assistant_profiles_status_createdAt_idx" ON "assistant_profiles"("status", "createdAt");

-- CreateIndex
CREATE INDEX "assistant_profiles_status_identityOutcome_idx" ON "assistant_profiles"("status", "identityOutcome");

-- CreateIndex
CREATE UNIQUE INDEX "assistant_private_details_profileId_key" ON "assistant_private_details"("profileId");

-- CreateIndex
CREATE INDEX "assistant_service_areas_cityId_idx" ON "assistant_service_areas"("cityId");

-- CreateIndex
CREATE INDEX "assistant_task_offers_taskId_idx" ON "assistant_task_offers"("taskId");

-- CreateIndex
CREATE INDEX "assistant_availability_windows_profileId_dayOfWeek_idx" ON "assistant_availability_windows"("profileId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "phone_verification_tokens_profileId_createdAt_idx" ON "phone_verification_tokens"("profileId", "createdAt");

-- CreateIndex
CREATE INDEX "phone_verification_tokens_expiresAt_idx" ON "phone_verification_tokens"("expiresAt");

-- CreateIndex
CREATE INDEX "identity_checks_profileId_createdAt_idx" ON "identity_checks"("profileId", "createdAt");

-- AddForeignKey
ALTER TABLE "assistant_profiles" ADD CONSTRAINT "assistant_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_private_details" ADD CONSTRAINT "assistant_private_details_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "assistant_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_service_areas" ADD CONSTRAINT "assistant_service_areas_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "assistant_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_service_areas" ADD CONSTRAINT "assistant_service_areas_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_task_offers" ADD CONSTRAINT "assistant_task_offers_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "assistant_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_task_offers" ADD CONSTRAINT "assistant_task_offers_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "eligible_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_availability_windows" ADD CONSTRAINT "assistant_availability_windows_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "assistant_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_verification_tokens" ADD CONSTRAINT "phone_verification_tokens_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "assistant_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_checks" ADD CONSTRAINT "identity_checks_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "assistant_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_checks" ADD CONSTRAINT "identity_checks_checkedByUserId_fkey" FOREIGN KEY ("checkedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────────────────────────────────────────────────────────────────────────
-- Database-enforced safety rules for assistants (the API validates the same rules first).
-- No GRANTs are needed: default privileges from 20261023214900 give the runtime role normal DML.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE "assistant_profiles" ADD CONSTRAINT "assistant_profiles_slug_format"
  CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "assistant_profiles" ADD CONSTRAINT "assistant_profiles_display_name_length"
  CHECK (char_length(btrim("displayName")) BETWEEN 2 AND 60);

-- Nigerian E.164 only at launch: +234 followed by exactly 10 digits.
ALTER TABLE "assistant_private_details" ADD CONSTRAINT "assistant_private_details_phone_format"
  CHECK ("phoneE164" IS NULL OR "phoneE164" ~ '^\+234[0-9]{10}$');
-- A verified phone belongs to exactly one assistant (prevents multi-accounting).
CREATE UNIQUE INDEX "assistant_private_details_verified_phone_key"
  ON "assistant_private_details" ("phoneE164") WHERE "phoneVerifiedAt" IS NOT NULL;
-- Verification only makes sense for a number that is present.
ALTER TABLE "assistant_private_details" ADD CONSTRAINT "assistant_private_details_verified_needs_phone"
  CHECK ("phoneVerifiedAt" IS NULL OR "phoneE164" IS NOT NULL);

ALTER TABLE "assistant_availability_windows" ADD CONSTRAINT "assistant_availability_day_range"
  CHECK ("dayOfWeek" BETWEEN 0 AND 6);
ALTER TABLE "assistant_availability_windows" ADD CONSTRAINT "assistant_availability_minutes_valid"
  CHECK ("startMinute" >= 0 AND "endMinute" <= 1440 AND "startMinute" < "endMinute");

ALTER TABLE "phone_verification_tokens" ADD CONSTRAINT "phone_verification_attempts_nonnegative"
  CHECK ("attempts" >= 0);

-- A recorded check always has an outcome; PENDING exists only on the profile ("nothing recorded yet").
ALTER TABLE "identity_checks" ADD CONSTRAINT "identity_checks_result_recorded"
  CHECK ("result" <> 'PENDING');

-- An assistant can never offer a task Qyou considers non-delegable, whatever code path inserts the row.
CREATE FUNCTION assistant_task_offers_reject_non_delegable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public."eligible_tasks" t
    WHERE t."id" = NEW."taskId" AND t."eligibility" = 'NOT_DELEGABLE'
  ) THEN
    RAISE EXCEPTION 'assistants cannot offer a non-delegable task'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER assistant_task_offers_no_non_delegable
  BEFORE INSERT OR UPDATE ON "assistant_task_offers"
  FOR EACH ROW EXECUTE FUNCTION assistant_task_offers_reject_non_delegable();

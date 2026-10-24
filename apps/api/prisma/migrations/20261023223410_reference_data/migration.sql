-- CreateEnum
CREATE TYPE "TaskKind" AS ENUM ('QUEUE_HOLDING', 'ERRAND');

-- CreateEnum
CREATE TYPE "TaskEligibility" AS ENUM ('ELIGIBLE', 'REQUIRES_AUTHORIZATION', 'NOT_DELEGABLE');

-- CreateEnum
CREATE TYPE "LocationStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RestrictionRule" AS ENUM ('PROHIBITED', 'REQUIRES_AUTHORIZATION', 'ADVISORY');

-- CreateTable
CREATE TABLE "cities" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "state" VARCHAR(80) NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "timezone" VARCHAR(40) NOT NULL DEFAULT 'Africa/Lagos',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_categories" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "nameKey" VARCHAR(80) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "iconKey" VARCHAR(30) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eligible_tasks" (
    "id" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "nameKey" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "kind" "TaskKind" NOT NULL,
    "eligibility" "TaskEligibility" NOT NULL,
    "requiresPersonalPresence" BOOLEAN NOT NULL DEFAULT false,
    "requiresCredentials" BOOLEAN NOT NULL DEFAULT false,
    "authorizationNotes" VARCHAR(1000),
    "restrictionNotes" VARCHAR(1000),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "eligible_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_locations" (
    "id" UUID NOT NULL,
    "cityId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "address" VARCHAR(250) NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "status" "LocationStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_restrictions" (
    "id" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "taskId" UUID,
    "rule" "RestrictionRule" NOT NULL,
    "note" VARCHAR(500) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "location_restrictions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cities_slug_key" ON "cities"("slug");

-- CreateIndex
CREATE INDEX "cities_isActive_sortOrder_idx" ON "cities"("isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "cities_state_name_key" ON "cities"("state", "name");

-- CreateIndex
CREATE UNIQUE INDEX "service_categories_slug_key" ON "service_categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "service_categories_nameKey_key" ON "service_categories"("nameKey");

-- CreateIndex
CREATE INDEX "service_categories_isActive_sortOrder_idx" ON "service_categories"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "eligible_tasks_categoryId_isActive_sortOrder_idx" ON "eligible_tasks"("categoryId", "isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "eligible_tasks_categoryId_slug_key" ON "eligible_tasks"("categoryId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "eligible_tasks_categoryId_nameKey_key" ON "eligible_tasks"("categoryId", "nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "service_locations_slug_key" ON "service_locations"("slug");

-- CreateIndex
CREATE INDEX "service_locations_cityId_status_idx" ON "service_locations"("cityId", "status");

-- CreateIndex
CREATE INDEX "service_locations_categoryId_status_idx" ON "service_locations"("categoryId", "status");

-- CreateIndex
CREATE INDEX "service_locations_status_name_idx" ON "service_locations"("status", "name");

-- CreateIndex
CREATE INDEX "location_restrictions_locationId_idx" ON "location_restrictions"("locationId");

-- CreateIndex
-- NULLS NOT DISTINCT (PostgreSQL 15+): a venue-wide restriction (taskId NULL) can exist only once per rule.
CREATE UNIQUE INDEX "location_restrictions_locationId_taskId_rule_key" ON "location_restrictions"("locationId", "taskId", "rule") NULLS NOT DISTINCT;

-- AddForeignKey
ALTER TABLE "eligible_tasks" ADD CONSTRAINT "eligible_tasks_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_locations" ADD CONSTRAINT "service_locations_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_locations" ADD CONSTRAINT "service_locations_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_restrictions" ADD CONSTRAINT "location_restrictions_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "service_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_restrictions" ADD CONSTRAINT "location_restrictions_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "eligible_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───────────────────────────────────────────────────────────────────────────
-- Database-enforced invariants. Prisma does not model CHECK constraints, so they live here; the
-- API validates the same rules first to return friendly errors, but these guarantee that no code
-- path or manual SQL can store a task that contradicts Qyou's delegation rules.
-- ───────────────────────────────────────────────────────────────────────────

-- Slugs: lowercase words separated by single hyphens.
ALTER TABLE "cities" ADD CONSTRAINT "cities_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "eligible_tasks" ADD CONSTRAINT "eligible_tasks_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "service_locations" ADD CONSTRAINT "service_locations_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- Task eligibility.
-- 1. Anything that needs the customer's personal presence or credentials cannot be delegated.
ALTER TABLE "eligible_tasks" ADD CONSTRAINT "eligible_tasks_presence_credentials_not_delegable"
  CHECK (NOT ("requiresPersonalPresence" OR "requiresCredentials") OR "eligibility" = 'NOT_DELEGABLE');
-- 2. Delegable-with-authorization tasks must say what authorization is needed.
ALTER TABLE "eligible_tasks" ADD CONSTRAINT "eligible_tasks_authorization_needs_notes"
  CHECK ("eligibility" <> 'REQUIRES_AUTHORIZATION' OR length(btrim(coalesce("authorizationNotes", ''))) > 0);
-- 3. Non-delegable tasks must say why.
ALTER TABLE "eligible_tasks" ADD CONSTRAINT "eligible_tasks_not_delegable_needs_reason"
  CHECK ("eligibility" <> 'NOT_DELEGABLE' OR length(btrim(coalesce("restrictionNotes", ''))) > 0);

-- Coordinates: in range; a location has both or neither.
ALTER TABLE "cities" ADD CONSTRAINT "cities_coordinates_range"
  CHECK ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180);
ALTER TABLE "service_locations" ADD CONSTRAINT "service_locations_coordinates_pair"
  CHECK (("latitude" IS NULL) = ("longitude" IS NULL));
ALTER TABLE "service_locations" ADD CONSTRAINT "service_locations_coordinates_range"
  CHECK (("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90) AND ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180));

-- Restriction notes must not be blank.
ALTER TABLE "location_restrictions" ADD CONSTRAINT "location_restrictions_note_not_blank" CHECK (length(btrim("note")) > 0);

-- No new GRANTs are needed: the default privileges from 20261023214900 give the runtime role
-- normal DML on these tables. Reference data is not append-only; changes are audited instead.

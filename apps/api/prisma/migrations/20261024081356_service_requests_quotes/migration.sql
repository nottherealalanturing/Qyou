-- CreateEnum
CREATE TYPE "ServiceRequestStatus" AS ENUM ('OPEN', 'QUOTED', 'QUOTE_ACCEPTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ScheduleKind" AS ENUM ('FLEXIBLE', 'ON_DATE');

-- CreateEnum
CREATE TYPE "TimePeriod" AS ENUM ('ANY', 'MORNING', 'AFTERNOON', 'EVENING');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'NOT_SELECTED', 'WITHDRAWN', 'REQUEST_CLOSED');

-- CreateTable
CREATE TABLE "service_requests" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "cityId" UUID NOT NULL,
    "locationId" UUID,
    "description" VARCHAR(1000) NOT NULL,
    "constraints" VARCHAR(500),
    "scheduleKind" "ScheduleKind" NOT NULL,
    "preferredDate" DATE,
    "preferredPeriod" "TimePeriod" NOT NULL DEFAULT 'ANY',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "authorizationConfirmedAt" TIMESTAMPTZ(3),
    "status" "ServiceRequestStatus" NOT NULL DEFAULT 'OPEN',
    "statusChangedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),
    "closureReason" VARCHAR(300),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "assistantId" UUID NOT NULL,
    "amountKobo" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "message" VARCHAR(1000),
    "status" "QuoteStatus" NOT NULL DEFAULT 'PENDING',
    "statusChangedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_requests_customerId_createdAt_idx" ON "service_requests"("customerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "service_requests_status_cityId_taskId_expiresAt_idx" ON "service_requests"("status", "cityId", "taskId", "expiresAt");

-- CreateIndex
CREATE INDEX "service_requests_locationId_idx" ON "service_requests"("locationId");

-- CreateIndex
CREATE INDEX "quotes_requestId_status_idx" ON "quotes"("requestId", "status");

-- CreateIndex
CREATE INDEX "quotes_assistantId_createdAt_idx" ON "quotes"("assistantId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "eligible_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "service_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "service_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_assistantId_fkey" FOREIGN KEY ("assistantId") REFERENCES "assistant_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────────────────────────────────────────────────────────────────────────
-- Database-enforced invariants for requests and quotes. The API validates the same rules first and
-- serialises changes with SELECT … FOR UPDATE on the request row; everything below still holds if
-- application code is wrong. (Default privileges from 20261023214900 grant the runtime role DML.)
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_description_length"
  CHECK (char_length(btrim("description")) BETWEEN 10 AND 1000);
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_constraints_length"
  CHECK ("constraints" IS NULL OR char_length(btrim("constraints")) BETWEEN 1 AND 500);
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_schedule_consistent"
  CHECK (
    ("scheduleKind" = 'FLEXIBLE' AND "preferredDate" IS NULL AND "preferredPeriod" = 'ANY')
    OR ("scheduleKind" = 'ON_DATE' AND "preferredDate" IS NOT NULL)
  );
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_expiry_after_creation"
  CHECK ("expiresAt" > "createdAt");
-- Lifecycle timestamps always agree with the status.
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_status_timestamps"
  CHECK (
    ("status" IN ('OPEN', 'QUOTED') AND "acceptedAt" IS NULL AND "closedAt" IS NULL AND "closureReason" IS NULL)
    OR ("status" = 'QUOTE_ACCEPTED' AND "acceptedAt" IS NOT NULL AND "closedAt" IS NULL AND "closureReason" IS NULL)
    OR ("status" = 'CANCELLED' AND "closedAt" IS NOT NULL)
  );
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_closure_reason_length"
  CHECK ("closureReason" IS NULL OR char_length(btrim("closureReason")) BETWEEN 1 AND 300);

ALTER TABLE "quotes" ADD CONSTRAINT "quotes_amount_positive"
  CHECK ("amountKobo" BETWEEN 1 AND 2000000000);
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_currency_ngn" CHECK ("currency" = 'NGN');
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_message_length"
  CHECK ("message" IS NULL OR char_length(btrim("message")) BETWEEN 1 AND 1000);

-- At most ONE accepted quote per request, whatever code path or race tries otherwise.
CREATE UNIQUE INDEX "quotes_one_accepted_per_request"
  ON "quotes" ("requestId") WHERE "status" = 'ACCEPTED';
-- An assistant has at most one ACTIVE (pending or accepted) quote per request.
CREATE UNIQUE INDEX "quotes_one_active_per_assistant_request"
  ON "quotes" ("requestId", "assistantId") WHERE "status" IN ('PENDING', 'ACCEPTED');

-- Requests: a delegable task, a venue that agrees with the city and the task's category, and an OPEN start.
CREATE FUNCTION service_requests_before_insert() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  task_category uuid;
  task_eligibility text;
  loc_city uuid;
  loc_category uuid;
BEGIN
  SELECT t."categoryId", t."eligibility"::text INTO task_category, task_eligibility
    FROM public."eligible_tasks" t WHERE t."id" = NEW."taskId";
  IF task_eligibility IS NULL OR task_eligibility = 'NOT_DELEGABLE' THEN
    RAISE EXCEPTION 'a request must be for a delegable task' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."locationId" IS NOT NULL THEN
    SELECT l."cityId", l."categoryId" INTO loc_city, loc_category
      FROM public."service_locations" l WHERE l."id" = NEW."locationId";
    IF loc_city IS DISTINCT FROM NEW."cityId" OR loc_category IS DISTINCT FROM task_category THEN
      RAISE EXCEPTION 'the venue must be in the request city and category' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW."status" <> 'OPEN' THEN
    RAISE EXCEPTION 'a request starts OPEN' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER service_requests_insert_guard
  BEFORE INSERT ON "service_requests"
  FOR EACH ROW EXECUTE FUNCTION service_requests_before_insert();

-- Requests are immutable apart from lifecycle fields, and only the documented transitions are possible.
CREATE FUNCTION service_requests_before_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW."customerId" IS DISTINCT FROM OLD."customerId"
    OR NEW."taskId" IS DISTINCT FROM OLD."taskId"
    OR NEW."cityId" IS DISTINCT FROM OLD."cityId"
    OR NEW."locationId" IS DISTINCT FROM OLD."locationId"
    OR NEW."description" IS DISTINCT FROM OLD."description"
    OR NEW."constraints" IS DISTINCT FROM OLD."constraints"
    OR NEW."scheduleKind" IS DISTINCT FROM OLD."scheduleKind"
    OR NEW."preferredDate" IS DISTINCT FROM OLD."preferredDate"
    OR NEW."preferredPeriod" IS DISTINCT FROM OLD."preferredPeriod"
    OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
    OR NEW."authorizationConfirmedAt" IS DISTINCT FROM OLD."authorizationConfirmedAt"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'a service request cannot be edited after creation' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'OPEN' AND NEW."status" IN ('QUOTED', 'CANCELLED'))
    OR (OLD."status" = 'QUOTED' AND NEW."status" IN ('OPEN', 'QUOTE_ACCEPTED', 'CANCELLED'))
    OR (OLD."status" = 'QUOTE_ACCEPTED' AND NEW."status" = 'CANCELLED')
  ) THEN
    RAISE EXCEPTION 'invalid service request transition % -> %', OLD."status", NEW."status"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER service_requests_update_guard
  BEFORE UPDATE ON "service_requests"
  FOR EACH ROW EXECUTE FUNCTION service_requests_before_update();

-- Quotes: only on an open request, never by the request's own customer, only by an approved assistant.
CREATE FUNCTION quotes_before_insert() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  req_status text;
  req_customer uuid;
  assistant_user uuid;
  assistant_status text;
BEGIN
  SELECT r."status"::text, r."customerId" INTO req_status, req_customer
    FROM public."service_requests" r WHERE r."id" = NEW."requestId";
  SELECT p."userId", p."status"::text INTO assistant_user, assistant_status
    FROM public."assistant_profiles" p WHERE p."id" = NEW."assistantId";
  IF req_status IS NULL OR req_status NOT IN ('OPEN', 'QUOTED') THEN
    RAISE EXCEPTION 'this request is not accepting quotes' USING ERRCODE = 'check_violation';
  END IF;
  IF assistant_user IS NULL OR assistant_status <> 'APPROVED' THEN
    RAISE EXCEPTION 'only an approved assistant can quote' USING ERRCODE = 'check_violation';
  END IF;
  IF assistant_user = req_customer THEN
    RAISE EXCEPTION 'you cannot quote on your own request' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" <> 'PENDING' THEN
    RAISE EXCEPTION 'a quote starts PENDING' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER quotes_insert_guard
  BEFORE INSERT ON "quotes"
  FOR EACH ROW EXECUTE FUNCTION quotes_before_insert();

-- Quotes are immutable apart from their status, and only the documented transitions are possible.
CREATE FUNCTION quotes_before_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW."requestId" IS DISTINCT FROM OLD."requestId"
    OR NEW."assistantId" IS DISTINCT FROM OLD."assistantId"
    OR NEW."amountKobo" IS DISTINCT FROM OLD."amountKobo"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."message" IS DISTINCT FROM OLD."message"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'a quote cannot be edited; withdraw it and send a new one' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'PENDING' AND NEW."status" IN ('ACCEPTED', 'NOT_SELECTED', 'WITHDRAWN', 'REQUEST_CLOSED'))
    OR (OLD."status" = 'ACCEPTED' AND NEW."status" = 'REQUEST_CLOSED')
  ) THEN
    RAISE EXCEPTION 'invalid quote transition % -> %', OLD."status", NEW."status"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER quotes_update_guard
  BEFORE UPDATE ON "quotes"
  FOR EACH ROW EXECUTE FUNCTION quotes_before_update();

-- Nothing in the product deletes requests or quotes, so the runtime role cannot either.
REVOKE DELETE ON TABLE "service_requests", "quotes" FROM qyou_app;

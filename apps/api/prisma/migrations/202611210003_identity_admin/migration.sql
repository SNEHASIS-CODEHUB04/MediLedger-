ALTER TABLE "Organization" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PENDING';
UPDATE "Organization" SET "status" = 'ACTIVE';
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_status_check" CHECK ("status" IN ('PENDING','ACTIVE','REJECTED','INACTIVE'));
ALTER TABLE "User" ADD COLUMN "verifiedAt" TIMESTAMP(3), ADD COLUMN "mustSetPassword" BOOLEAN NOT NULL DEFAULT false;
UPDATE "User" SET "active" = false WHERE "id" IN (
  '10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000006'
);
DELETE FROM "Session";
CREATE TABLE "AccountToken" (
  "hash" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "purpose" TEXT NOT NULL CHECK ("purpose" IN ('VERIFY','RESET','INVITE')),
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "AccountToken_userId_purpose_idx" ON "AccountToken" ("userId","purpose");
CREATE TABLE "SecurityEvent" (
  "id" SERIAL PRIMARY KEY,
  "action" TEXT NOT NULL,
  "actor" TEXT,
  "subject" TEXT,
  "detail" TEXT,
  "at" TIMESTAMP(3) NOT NULL,
  "previousHash" TEXT NOT NULL,
  "hash" TEXT NOT NULL UNIQUE
);
CREATE TABLE "SystemSettings" (
  "id" INTEGER PRIMARY KEY,
  "registrationOpen" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "SystemSettings_singleton" CHECK ("id" = 1)
);
CREATE FUNCTION prevent_security_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Security history is append only'; END;
$$;
CREATE TRIGGER security_event_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON "SecurityEvent"
FOR EACH STATEMENT EXECUTE FUNCTION prevent_security_event_mutation();

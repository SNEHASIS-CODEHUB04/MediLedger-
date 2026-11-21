ALTER TYPE "Role" ADD VALUE 'AUDITOR';
ALTER TABLE "User" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true, ADD COLUMN "department" TEXT;
CREATE TABLE "Verification" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "recordId" TEXT NOT NULL REFERENCES "DocumentMetadata"("id"),
  "actorId" TEXT NOT NULL,
  "organization" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "result" TEXT NOT NULL CHECK ("result" IN ('MATCH', 'MISMATCH')),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Verification_mode_createdAt_idx" ON "Verification" ("mode", "createdAt");
CREATE INDEX "Verification_recordId_actorId_idx" ON "Verification" ("recordId", "actorId");

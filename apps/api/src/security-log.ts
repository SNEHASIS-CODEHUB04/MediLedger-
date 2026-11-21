import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

export async function lockIdentity(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(420431)`;
}

export function eventHash(event: {
  previousHash: string;
  action: string;
  actor: string | null;
  subject: string | null;
  detail: string | null;
  at: Date;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        event.previousHash,
        event.action,
        event.actor,
        event.subject,
        event.detail,
        event.at.toISOString(),
      ]),
    )
    .digest("hex");
}

export async function appendEvent(
  tx: Prisma.TransactionClient,
  action: string,
  actor: string | null = null,
  subject: string | null = null,
  detail: string | null = null,
) {
  await lockIdentity(tx);
  const tail = await tx.securityEvent.findFirst({
    orderBy: { id: "desc" },
    select: { hash: true },
  });
  const event = {
    action,
    actor,
    subject,
    detail,
    at: new Date(),
    previousHash: tail?.hash ?? "GENESIS",
  };
  await tx.securityEvent.create({ data: { ...event, hash: eventHash(event) } });
}

export const logEvent = (
  db: PrismaClient,
  action: string,
  actor?: string | null,
  subject?: string | null,
) => db.$transaction((tx) => appendEvent(tx, action, actor, subject));

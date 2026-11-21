import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { systemOrganization, validatePassword } from "./accounts";
import { appendEvent, lockIdentity } from "./security-log";

async function run() {
  const email = process.env.MEDILEDGER_BOOTSTRAP_EMAIL?.trim().toLowerCase();
  const password = process.env.MEDILEDGER_BOOTSTRAP_PASSWORD;
  if (
    !email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 254 ||
    !password
  )
    throw new Error(
      "Supply MEDILEDGER_BOOTSTRAP_EMAIL and MEDILEDGER_BOOTSTRAP_PASSWORD through the operator environment.",
    );
  validatePassword(password);
  const db = new PrismaClient();
  try {
    const passwordHash = await hash(password, 12);
    await db.$transaction(async (tx) => {
      await lockIdentity(tx);
      if (await tx.user.findFirst({ where: { role: "AUDITOR", active: true } }))
        throw new Error("An active auditor already exists.");
      if (await tx.user.findUnique({ where: { email } }))
        throw new Error("Use an email without an existing account.");
      const org = await systemOrganization(tx);
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          organizationId: org.id,
          verifiedAt: new Date(),
          role: "AUDITOR",
        },
      });
      await appendEvent(tx, "SUPERADMIN_PROVISIONED", user.id);
    });
    console.log("Initial superadmin provisioned.");
  } finally {
    await db.$disconnect();
  }
}
void run().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Provisioning failed.",
  );
  process.exitCode = 1;
});

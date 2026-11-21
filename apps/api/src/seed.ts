import { fixture } from "./fixture";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { MediLedger } from "./service";

const issuer = "10000000-0000-4000-8000-000000000001";
const patient = "10000000-0000-4000-8000-000000000002";
const provider = "10000000-0000-4000-8000-000000000003";
const secondPatient = "10000000-0000-4000-8000-000000000004";

async function seed() {
  if (process.env.ENABLE_TEST_FIXTURES !== "true")
    throw new Error(
      "Fixture seeding is limited to explicitly enabled test databases.",
    );
  const password = process.env.FIXTURE_PASSWORD;
  if (
    !password ||
    Buffer.byteLength(password) < 12 ||
    Buffer.byteLength(password) > 72
  )
    throw new Error("Set FIXTURE_PASSWORD to 12–72 bytes");
  const app = new MediLedger();
  const db: PrismaClient = app.db;
  try {
    const passwordHash = await hash(password, 12);
    for (const [id, name, mspId] of [
      ["hospital-a", "Aster Diagnostics", "Org1MSP"],
      ["hospital-b", "Harbor Medical", "Org2MSP"],
    ]) {
      await db.organization.upsert({
        where: { id },
        update: { status: "ACTIVE" },
        create: { id, name, mspId, status: "ACTIVE" },
      });
    }
    for (const [id, email, role, organizationId, department] of [
      [
        issuer,
        "issuer@mediledger.example",
        "ISSUER",
        "hospital-a",
        "Records administration",
      ],
      [patient, "patient@mediledger.example", "PATIENT", "hospital-a", null],
      [
        provider,
        "provider@mediledger.example",
        "PROVIDER",
        "hospital-b",
        "General medicine",
      ],
      [
        secondPatient,
        "patient-b@mediledger.example",
        "PATIENT",
        "hospital-a",
        null,
      ],
      [
        "10000000-0000-4000-8000-000000000005",
        "auditor@mediledger.example",
        "AUDITOR",
        "hospital-a",
        "Compliance",
      ],
      ...(app.mode === "PUBLIC_DEMO"
        ? ([
            [
              "10000000-0000-4000-8000-000000000006",
              "doctor@mediledger.example",
              "PROVIDER",
              "hospital-a",
              "Diagnostics",
            ],
          ] as const)
        : []),
    ] as const) {
      await db.user.upsert({
        where: { id },
        update: { department, active: true, verifiedAt: new Date() },
        create: {
          id,
          email,
          role,
          organizationId,
          department,
          passwordHash,
          verifiedAt: new Date(),
        },
      });
    }
    if (
      app.mode === "PUBLIC_DEMO" &&
      !(await db.documentMetadata.findFirst({
        where: { ready: true, ownerId: patient },
      }))
    ) {
      const buffer = fixture();
      await app.register(
        { id: issuer, role: "ISSUER", organization: "Org1MSP" },
        patient,
        {
          buffer,
          size: buffer.length,
          originalname: "synthetic-report.pdf",
        } as Express.Multer.File,
      );
    }
  } finally {
    await app.onModuleDestroy();
  }
}

void seed().catch((error: unknown) => {
  console.error(
    "Seeding failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  process.exitCode = 1;
});

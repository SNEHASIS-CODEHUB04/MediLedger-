import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { Actor, Mode, WorkspaceEvent } from "@mediledger/shared";

export class Workspaces {
  constructor(
    private readonly db: PrismaClient,
    private readonly mode: Mode,
  ) {}

  private require(actor: Actor, ...roles: Actor["role"][]) {
    if (!roles.includes(actor.role)) throw new ForbiddenException();
  }

  async staff(actor: Actor, offset: number) {
    this.require(actor, "ISSUER");
    const rows = await this.db.user.findMany({
      where: {
        organization: { mspId: actor.organization },
        role: { in: ["ISSUER", "PROVIDER"] },
      },
      orderBy: { id: "asc" },
      skip: offset,
      take: 21,
      select: {
        id: true,
        email: true,
        role: true,
        department: true,
        active: true,
      },
    });
    return {
      items: rows.slice(0, 20),
      next: rows.length === 21 ? offset + 20 : null,
    };
  }

  async setStaffActive(actor: Actor, id: string, active: boolean) {
    this.require(actor, "ISSUER");
    await this.db.$transaction(async (tx) => {
      const result = await tx.user.updateMany({
        where: {
          id,
          role: "PROVIDER",
          organization: { mspId: actor.organization },
        },
        data: { active },
      });
      if (!result.count) throw new NotFoundException("Provider unavailable");
      if (!active) await tx.session.deleteMany({ where: { userId: id } });
    });
  }

  async verificationHistory(actor: Actor, offset: number, recordId?: string) {
    this.require(actor, "PROVIDER");
    const rows = await this.db.verification.findMany({
      where: {
        actorId: actor.id,
        mode: this.mode,
        ...(recordId ? { recordId } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: offset,
      take: 21,
      select: { id: true, recordId: true, result: true, createdAt: true },
    });
    return {
      items: rows.slice(0, 20),
      next: rows.length === 21 ? offset + 20 : null,
    };
  }

  async audit(actor: Actor, offset: number, action?: string) {
    this.require(actor, "ISSUER", "AUDITOR");
    const scoped = actor.role === "ISSUER";
    const ledgerScope = scoped
      ? Prisma.sql`AND org."mspId" = ${actor.organization}`
      : Prisma.empty;
    const verificationScope = scoped
      ? Prisma.sql`AND v."organization" = ${actor.organization}`
      : Prisma.empty;
    const ledger =
      this.mode === "PUBLIC_DEMO"
        ? Prisma.sql`
      SELECT d.id AS "recordId", event.value->>'action' AS action, event.value->>'actor' AS actor,
        org."mspId" AS organization, (event.value->>'at')::timestamptz AS at,
        NULL::text AS "txId", 'SIMULATED' AS status
      FROM "Simulation" s JOIN "DocumentMetadata" d ON d.id = s.id
      JOIN "User" u ON u.id = d."issuerId" JOIN "Organization" org ON org.id = u."organizationId"
      CROSS JOIN LATERAL jsonb_array_elements(s.state->'history') AS event
      WHERE d.ready ${ledgerScope}
    `
        : Prisma.sql`
      SELECT d.id AS "recordId", t."functionName" AS action, t."submittedBy" AS actor,
        org."mspId" AS organization, t."createdAt" AT TIME ZONE 'UTC' AS at,
        t."txId" AS "txId", t."commitStatus" AS status
      FROM "FabricTransaction" t JOIN "DocumentMetadata" d ON d.id = t."recordId"
      JOIN "User" u ON u.id = d."issuerId" JOIN "Organization" org ON org.id = u."organizationId"
      WHERE d.ready ${ledgerScope}
    `;
    const filter = action ? Prisma.sql`WHERE action = ${action}` : Prisma.empty;
    const rows = await this.db.$queryRaw<WorkspaceEvent[]>`
      SELECT *, ${this.mode}::text AS mode FROM (
        ${ledger}
        UNION ALL
        SELECT v."recordId", 'VerifyDocumentHash', v."actorId", v.organization,
          v."createdAt" AT TIME ZONE 'UTC', NULL::text, v.result
        FROM "Verification" v WHERE v.mode = ${this.mode} ${verificationScope}
      ) events ${filter}
      ORDER BY at DESC, "recordId", action LIMIT 21 OFFSET ${offset}
    `;
    return {
      items: rows.slice(0, 20),
      next: rows.length === 21 ? offset + 20 : null,
    };
  }

  async overview(
    actor: Actor,
    visible: () => Promise<{
      records: number;
      activeGrants: number;
      recent: import("@mediledger/shared").RecordSummary[];
    }>,
  ) {
    const verificationScope = {
      mode: this.mode,
      ...(actor.role === "ISSUER"
        ? { organization: actor.organization }
        : actor.role === "PROVIDER"
          ? { actorId: actor.id }
          : {}),
    };
    const [summary, matched, mismatched] = await Promise.all([
      actor.role === "AUDITOR"
        ? { records: 0, activeGrants: 0, recent: [] }
        : actor.role === "ISSUER"
          ? this.db.documentMetadata
              .count({
                where: {
                  ready: true,
                  issuer: { organization: { mspId: actor.organization } },
                  ...(this.mode === "PUBLIC_DEMO"
                    ? { simulation: { isNot: null } }
                    : {
                        transactions: {
                          some: {
                            functionName: "RegisterRecord",
                            commitStatus: "COMMITTED",
                          },
                        },
                      }),
                },
              })
              .then(async (records) => ({ ...(await visible()), records }))
          : visible(),
      actor.role === "PATIENT"
        ? 0
        : this.db.verification.count({
            where: { ...verificationScope, result: "MATCH" },
          }),
      actor.role === "PATIENT"
        ? 0
        : this.db.verification.count({
            where: { ...verificationScope, result: "MISMATCH" },
          }),
    ]);
    return { ...summary, matched, mismatched };
  }

  recordVerification(actor: Actor, recordId: string, match: boolean) {
    return this.db.verification.create({
      data: {
        recordId,
        actorId: actor.id,
        organization: actor.organization,
        mode: this.mode,
        result: match ? "MATCH" : "MISMATCH",
      },
    });
  }
}

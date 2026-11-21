import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type PrismaClient, type Role } from "@prisma/client";
import { randomBytes, randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import type { Actor, Mode } from "@mediledger/shared";
import { Accounts, systemId } from "./accounts";
import { appendEvent, eventHash, lockIdentity } from "./security-log";

export const organizationStates = [
  "PENDING",
  "ACTIVE",
  "REJECTED",
  "INACTIVE",
] as const;
export const managedRoles = ["PATIENT", "PROVIDER", "ISSUER"] as const;
type ManagedRole = (typeof managedRoles)[number];
const unmanaged = () =>
  new NotFoundException("Managed account or organization unavailable.");
const userSelect = {
  id: true,
  email: true,
  role: true,
  active: true,
  verifiedAt: true,
  department: true,
  organization: { select: { id: true, name: true } },
} as const;

export class Administration {
  constructor(
    private readonly db: PrismaClient,
    private readonly mode: Mode,
    private readonly accounts: Accounts,
  ) {}

  private check(actor: Actor) {
    if (actor.role !== "AUDITOR") throw new ForbiddenException();
  }

  private change<T>(
    actor: Actor,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    this.check(actor);
    return this.db.$transaction(async (tx) => {
      await lockIdentity(tx);
      const current = await tx.user.findFirst({
        where: {
          id: actor.id,
          role: "AUDITOR",
          active: true,
          verifiedAt: { not: null },
          organization: { status: "ACTIVE" },
        },
      });
      if (!current) throw new ForbiddenException();
      return operation(tx);
    });
  }

  async stats(actor: Actor) {
    this.check(actor);
    const scope = { id: { not: systemId } };
    const [
      organizations,
      activeOrganizations,
      users,
      securityEvents,
      verifications,
      ledgerEvents,
      settings,
    ] = await Promise.all([
      this.db.organization.count({ where: scope }),
      this.db.organization.count({ where: { ...scope, status: "ACTIVE" } }),
      this.db.user.count(),
      this.db.securityEvent.count(),
      this.db.verification.count({ where: { mode: this.mode } }),
      this.mode === "LIVE_FABRIC"
        ? this.db.fabricTransaction.count({
            where: { record: { ready: true } },
          })
        : this.db.$queryRaw<
            { total: number }[]
          >`SELECT COALESCE(SUM(jsonb_array_length(s.state->'history')),0)::int AS total FROM "Simulation" s JOIN "DocumentMetadata" d ON d.id=s.id WHERE d.ready`.then(
            ([row]) => row.total,
          ),
      this.db.systemSettings.findUnique({ where: { id: 1 } }),
    ]);
    return {
      organizations,
      activeOrganizations,
      users,
      securityEvents,
      auditEvents: securityEvents + verifications + ledgerEvents,
      registrationOpen: settings?.registrationOpen ?? true,
    };
  }

  async organizations(actor: Actor, search: string, offset: number) {
    this.check(actor);
    const rows = await this.db.organization.findMany({
      where: {
        id: { not: systemId },
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { mspId: { contains: search, mode: "insensitive" } },
        ],
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: offset,
      take: 21,
      select: {
        id: true,
        name: true,
        mspId: true,
        status: true,
        createdAt: true,
      },
    });
    return this.page(rows, offset);
  }

  createOrganization(actor: Actor, name: string, mspId: string) {
    return this.change(actor, async (tx) => {
      if (
        mspId === "SYSTEM" ||
        (await tx.organization.findUnique({ where: { mspId } }))
      )
        throw new BadRequestException("This organization reference is in use.");
      const org = await tx.organization.create({
        data: { id: randomUUID(), name, mspId },
      });
      await appendEvent(tx, "ORGANIZATION_REGISTERED", actor.id, org.id);
      return org;
    });
  }

  setOrganization(
    actor: Actor,
    id: string,
    status: (typeof organizationStates)[number],
  ) {
    return this.change(actor, async (tx) => {
      const org =
        id === systemId
          ? null
          : await tx.organization.findUnique({ where: { id } });
      if (!org) throw unmanaged();
      const allowed: Record<string, string[]> = {
        PENDING: ["ACTIVE", "REJECTED"],
        ACTIVE: ["INACTIVE"],
        INACTIVE: ["ACTIVE"],
        REJECTED: ["PENDING"],
      };
      if (!allowed[org.status]?.includes(status))
        throw new BadRequestException("Invalid organization status change.");
      await tx.organization.update({ where: { id }, data: { status } });
      if (status !== "ACTIVE")
        await tx.session.deleteMany({
          where: { user: { organizationId: id } },
        });
      await appendEvent(
        tx,
        "ORGANIZATION_STATUS_CHANGED",
        actor.id,
        id,
        org.status + " → " + status,
      );
    });
  }

  async users(actor: Actor, search: string, offset: number) {
    this.check(actor);
    const rows = await this.db.user.findMany({
      where: {
        OR: [
          { email: { contains: search, mode: "insensitive" } },
          { organization: { name: { contains: search, mode: "insensitive" } } },
        ],
      },
      orderBy: [{ email: "asc" }, { id: "asc" }],
      skip: offset,
      take: 21,
      select: userSelect,
    });
    return this.page(rows, offset);
  }

  async invite(
    actor: Actor,
    email: string,
    organizationId: string,
    role: ManagedRole,
  ) {
    const passwordHash = await hash(randomBytes(32).toString("base64url"), 12);
    const delivery = await this.change(actor, async (tx) => {
      const org = await tx.organization.findFirst({
        where: { id: organizationId, status: "ACTIVE", NOT: { id: systemId } },
      });
      if (!org) throw unmanaged();
      if (await tx.user.findUnique({ where: { email } }))
        throw new BadRequestException("This email already has an account.");
      const user = await tx.user.create({
        data: {
          email,
          organizationId,
          role,
          passwordHash,
          mustSetPassword: true,
        },
      });
      await appendEvent(tx, "USER_INVITED", actor.id, user.id, role);
      return this.accounts.issue(tx, user, "INVITE");
    });
    await this.accounts.send(delivery);
  }

  setUser(
    actor: Actor,
    id: string,
    input: { active?: boolean; role?: ManagedRole; organizationId?: string },
  ) {
    return this.change(actor, async (tx) => {
      const user = await tx.user.findFirst({
        where: { id, role: { not: "AUDITOR" } },
      });
      if (!user) throw unmanaged();
      const role: Role = input.role ?? user.role;
      const organizationId = input.organizationId ?? user.organizationId;
      if (input.organizationId || input.role) {
        if (organizationId === systemId && role !== "PATIENT")
          throw new BadRequestException("Choose an approved organization.");
        if (
          organizationId !== systemId &&
          !(await tx.organization.findFirst({
            where: { id: organizationId, status: "ACTIVE" },
          }))
        )
          throw unmanaged();
      }
      if (
        (organizationId !== user.organizationId || role !== user.role) &&
        (await tx.documentMetadata.findFirst({
          where: { OR: [{ ownerId: id }, { issuerId: id }] },
        }))
      )
        throw new BadRequestException(
          "This account is bound to existing medical records.",
        );
      if (input.active === undefined && !input.role && !input.organizationId)
        throw new BadRequestException("No changes were supplied.");
      await tx.user.update({
        where: { id },
        data: { active: input.active, role, organizationId },
      });
      await tx.session.deleteMany({ where: { userId: id } });
      if (input.active === false)
        await tx.accountToken.deleteMany({ where: { userId: id } });
      await appendEvent(
        tx,
        "USER_ADMINISTRATION_CHANGED",
        actor.id,
        id,
        JSON.stringify({
          active: input.active,
          role: input.role,
          organizationId: input.organizationId,
        }),
      );
    });
  }

  settings(actor: Actor, registrationOpen: boolean) {
    return this.change(actor, async (tx) => {
      await tx.systemSettings.upsert({
        where: { id: 1 },
        create: { id: 1, registrationOpen },
        update: { registrationOpen },
      });
      await appendEvent(
        tx,
        "REGISTRATION_SETTING_CHANGED",
        actor.id,
        null,
        registrationOpen ? "OPEN" : "CLOSED",
      );
    });
  }

  async security(actor: Actor, action: string, offset: number) {
    this.check(actor);
    const rows = await this.db.securityEvent.findMany({
      where: action
        ? { action: { contains: action, mode: "insensitive" } }
        : {},
      orderBy: { id: "desc" },
      skip: offset,
      take: 21,
    });
    return this.page(rows, offset);
  }

  logExport(actor: Actor, offset: number) {
    return this.change(actor, (tx) =>
      appendEvent(tx, "AUDIT_EXPORTED", actor.id, null, "Offset " + offset),
    );
  }

  async verifyHistory(actor: Actor) {
    this.check(actor);
    let previous = "GENESIS";
    let id = 0;
    for (;;) {
      const rows = await this.db.securityEvent.findMany({
        where: { id: { gt: id } },
        orderBy: { id: "asc" },
        take: 250,
      });
      if (!rows.length) return { valid: true, checkedThrough: id };
      for (const row of rows) {
        if (row.previousHash !== previous || eventHash(row) !== row.hash)
          return { valid: false, checkedThrough: id };
        previous = row.hash;
        id = row.id;
      }
    }
  }

  private page<T>(rows: T[], offset: number) {
    return {
      items: rows.slice(0, 20),
      next: rows.length > 20 ? offset + 20 : null,
    };
  }
}

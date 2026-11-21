import { PrismaClient, Prisma } from "@prisma/client";
import type { Actor, AuditEvent } from "@mediledger/shared";
import { ConflictException, NotFoundException } from "@nestjs/common";

export type LedgerRecord = {
  id: string;
  digest: string;
  owner: string;
  issuer: string;
  grants: string[];
  history: AuditEvent[];
};

export interface LedgerPort {
  ping(): Promise<void>;
  register(
    actor: Actor,
    id: string,
    owner: string,
    digest: string,
  ): Promise<void>;
  read(actor: Actor, id: string): Promise<LedgerRecord>;
  consent(
    actor: Actor,
    id: string,
    provider: string,
    grant: boolean,
  ): Promise<void>;
  verify(actor: Actor, id: string, digest: string): Promise<boolean>;
}

export const ledgerPrincipal = (actor: Pick<Actor, "organization" | "id">) =>
  actor.organization + ":" + actor.id;

export const missing = () => new NotFoundException("Record unavailable");

export function selectMode(value: string | undefined) {
  if (value !== "PUBLIC_DEMO" && value !== "LIVE_FABRIC") {
    throw new Error("APP_MODE must be PUBLIC_DEMO or LIVE_FABRIC");
  }
  return value;
}

export class SimulatedLedgerAdapter implements LedgerPort {
  constructor(private readonly db: PrismaClient) {}

  async ping() {}

  private event(action: string, actor: Actor): AuditEvent {
    return {
      action,
      actor: actor.id,
      at: new Date().toISOString(),
      mode: "PUBLIC_DEMO",
      status: "SIMULATED",
    };
  }

  async register(actor: Actor, id: string, owner: string, digest: string) {
    if (actor.role !== "ISSUER") throw missing();
    const state: LedgerRecord = {
      id,
      digest,
      owner,
      issuer: ledgerPrincipal(actor),
      grants: [],
      history: [this.event("RegisterRecord", actor)],
    };
    await this.db.simulation.create({ data: { id, state } });
  }

  private async load(db: Prisma.TransactionClient, id: string) {
    const row = await db.simulation.findUnique({ where: { id } });
    if (!row) throw missing();
    return row.state as unknown as LedgerRecord;
  }

  async read(actor: Actor, id: string) {
    const record = await this.load(this.db, id);
    const principal = ledgerPrincipal(actor);
    if (
      !(actor.role === "PATIENT" && record.owner === principal) &&
      !(actor.role === "ISSUER" && record.issuer === principal) &&
      !(actor.role === "PROVIDER" && record.grants.includes(principal))
    )
      throw missing();
    return record;
  }

  async consent(actor: Actor, id: string, provider: string, grant: boolean) {
    try {
      await this.db.$transaction(
        async (tx) => {
          const state = await this.load(tx, id);
          if (
            actor.role !== "PATIENT" ||
            state.owner !== ledgerPrincipal(actor)
          )
            throw missing();
          if (state.grants.includes(provider) === grant)
            throw new ConflictException("Consent already has that status");
          state.grants = grant
            ? [...state.grants, provider]
            : state.grants.filter((id) => id !== provider);
          state.history.push(
            this.event(grant ? "GrantAccess" : "RevokeAccess", actor),
          );
          await tx.simulation.update({ where: { id }, data: { state } });
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      ) {
        throw new ConflictException(
          "Consent changed concurrently. Refresh and retry.",
        );
      }
      throw error;
    }
  }

  async verify(actor: Actor, id: string, digest: string) {
    return (await this.read(actor, id)).digest === digest;
  }
}

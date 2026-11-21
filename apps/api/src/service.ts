import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { PrismaClient, type DocumentMetadata } from "@prisma/client";
import { compare } from "bcryptjs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Actor, Mode } from "@mediledger/shared";
import { pdfDigest, PrivateFiles } from "./files";
import {
  missing,
  ledgerPrincipal,
  selectMode,
  SimulatedLedgerAdapter,
  type LedgerPort,
} from "./ledger";
import { FabricLedgerAdapter } from "./fabric";
import { Workspaces } from "./workspaces";

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const dummyHash =
  "$2b$12$zIWUBoYsqlu9YbgocQ7lrOJl/aRK/D5vh8bd.4nfY8nB7v3sYBp0.";

@Injectable()
export class MediLedger {
  readonly mode: Mode = selectMode(process.env.APP_MODE);
  readonly db = new PrismaClient();
  readonly ledger: LedgerPort =
    this.mode === "PUBLIC_DEMO"
      ? new SimulatedLedgerAdapter(this.db)
      : new FabricLedgerAdapter(this.db);
  readonly workspaces = new Workspaces(this.db, this.mode);
  readonly files = new PrivateFiles(process.env.FILE_STORAGE_ROOT ?? "");

  async onModuleDestroy() {
    await this.db.$disconnect();
  }

  async login(email: string, password: string) {
    const user = await this.db.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    const valid =
      Buffer.byteLength(password) <= 72 &&
      (await compare(password, user?.passwordHash ?? dummyHash));
    if (!valid || !user?.active)
      throw new UnauthorizedException("Invalid credentials");
    const token = randomBytes(32).toString("base64url");
    await this.db.$transaction([
      this.db.session.deleteMany({ where: { expiresAt: { lte: new Date() } } }),
      this.db.session.create({
        data: {
          hash: hashToken(token),
          userId: user.id,
          expiresAt: new Date(Date.now() + 1800_000),
        },
      }),
    ]);
    return { token };
  }

  async session(authorization: string | undefined) {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization ?? "");
    if (!match) throw new UnauthorizedException();
    const hash = hashToken(match[1]);
    const session = await this.db.session.findUnique({
      where: { hash },
      include: { user: { include: { organization: true } } },
    });
    if (!session?.user.active || session.expiresAt <= new Date())
      throw new UnauthorizedException();
    const { user } = session;
    const actor: Actor = {
      id: user.id,
      role: user.role,
      organization: user.organization.mspId,
    };
    return {
      actor,
      hash,
      name: user.organization.name,
      email: user.email,
      department: user.department,
    };
  }

  async logout(authorization: string | undefined) {
    const { hash } = await this.session(authorization);
    await this.db.session.deleteMany({ where: { hash } });
  }

  async directory(actor: Actor) {
    const role =
      actor.role === "ISSUER"
        ? "PATIENT"
        : actor.role === "PATIENT"
          ? "PROVIDER"
          : null;
    if (!role) return [];
    return this.db.user.findMany({
      where: {
        role,
        ...(role === "PATIENT" ? { active: true } : {}),
        ...(role === "PATIENT"
          ? { organization: { mspId: actor.organization } }
          : {}),
      },
      select: {
        id: true,
        active: true,
        organization: { select: { name: true } },
      },
      orderBy: { id: "asc" },
      take: 100,
    });
  }

  async register(actor: Actor, ownerId: string, file?: Express.Multer.File) {
    if (actor.role !== "ISSUER") throw missing();
    const owner = await this.db.user.findFirst({
      where: {
        id: ownerId,
        role: "PATIENT",
        active: true,
        organization: { mspId: actor.organization },
      },
    });
    if (!owner) throw missing();
    const digest = pdfDigest(file);
    const pdf = file!;
    const id = randomUUID();
    const filename = pdf.originalname
      .replace(/[^a-zA-Z0-9_.-]/g, "_")
      .slice(-100);
    await this.db.documentMetadata.create({
      data: {
        id,
        ownerId: owner.id,
        issuerId: actor.id,
        filename,
        sizeBytes: pdf.size,
      },
    });
    await this.files.put(id, pdf.buffer);
    await this.ledger.register(
      actor,
      id,
      ledgerPrincipal({ id: owner.id, organization: actor.organization }),
      digest,
    );
    const ready = await this.db.documentMetadata.update({
      where: { id },
      data: { ready: true },
    });
    return this.summary(ready, actor.organization);
  }

  private summary(row: DocumentMetadata, issuer: string) {
    return {
      id: row.id,
      filename: row.filename,
      createdAt: row.createdAt.toISOString(),
      issuer,
      patientRef: row.ownerId,
    };
  }

  async authorized(actor: Actor, id: string) {
    if (actor.role === "AUDITOR") throw missing();
    const row = await this.db.documentMetadata.findFirst({
      where: { id, ready: true },
      include: {
        issuer: { include: { organization: true } },
        owner: { include: { organization: true } },
      },
    });
    if (!row) throw missing();
    const state = await this.ledger.read(actor, id);
    if (
      ledgerPrincipal({
        id: row.ownerId,
        organization: row.owner.organization.mspId,
      }) !== state.owner ||
      ledgerPrincipal({
        id: row.issuerId,
        organization: row.issuer.organization.mspId,
      }) !== state.issuer
    )
      throw new ServiceUnavailableException("Record references disagree");
    return { summary: this.summary(row, row.issuer.organization.name), state };
  }

  async list(actor: Actor, cursor?: string, search?: string) {
    if (actor.role === "AUDITOR") throw missing();
    // Scan past inaccessible rows without exposing their identifiers.
    const visible = [];
    let after = cursor;
    while (visible.length <= 20) {
      const rows = await this.db.documentMetadata.findMany({
        where: {
          ready: true,
          ...(search
            ? {
                OR: [
                  { filename: { contains: search, mode: "insensitive" } },
                  { ownerId: { contains: search, mode: "insensitive" } },
                  {
                    issuer: {
                      organization: {
                        name: { contains: search, mode: "insensitive" },
                      },
                    },
                  },
                ],
              }
            : {}),
          ...(actor.role === "PATIENT"
            ? { ownerId: actor.id }
            : actor.role === "ISSUER"
              ? { issuerId: actor.id }
              : {}),
          ...(after ? { id: { gt: after } } : {}),
          ...(actor.role === "PROVIDER" && this.mode === "PUBLIC_DEMO"
            ? {
                simulation: {
                  state: {
                    path: ["grants"],
                    array_contains: [ledgerPrincipal(actor)],
                  },
                },
              }
            : {}),
        },
        orderBy: { id: "asc" },
        take: 21,
        include: { issuer: { include: { organization: true } } },
      });
      const items = await Promise.all(
        rows.map(async (row) => {
          try {
            await this.ledger.read(actor, row.id);
            return this.summary(row, row.issuer.organization.name);
          } catch (error) {
            if (error instanceof NotFoundException) return null;
            throw error;
          }
        }),
      );
      visible.push(...items.filter((item) => item !== null));
      if (rows.length < 21) break;
      after = rows.at(-1)?.id;
    }
    const items = visible.slice(0, 20);
    return {
      items,
      next: visible.length > 20 ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async overview(actor: Actor) {
    return this.workspaces.overview(actor, async () => {
      let cursor: string | undefined;
      let records = 0;
      let activeGrants = 0;
      let recent: ReturnType<MediLedger["summary"]>[] = [];
      do {
        const page = await this.list(actor, cursor);
        records += page.items.length;
        recent = [...recent, ...page.items]
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 5);
        if (actor.role === "PATIENT") {
          const grants = await Promise.all(
            page.items.map((row) => this.ledger.read(actor, row.id)),
          );
          activeGrants += grants.reduce(
            (count, record) => count + record.grants.length,
            0,
          );
        }
        cursor = page.next ?? undefined;
      } while (cursor);
      return { records, activeGrants, recent };
    });
  }

  async consent(actor: Actor, id: string, provider: string, grant: boolean) {
    const { state } = await this.authorized(actor, id);
    if (actor.role !== "PATIENT" || state.owner !== ledgerPrincipal(actor))
      throw missing();
    const user = await this.db.user.findFirst({
      where: {
        id: provider,
        role: "PROVIDER",
        ...(grant ? { active: true } : {}),
      },
      include: { organization: true },
    });
    if (!user) throw new NotFoundException("Provider unavailable");
    await this.ledger.consent(
      actor,
      id,
      ledgerPrincipal({ id: user.id, organization: user.organization.mspId }),
      grant,
    );
  }

  async verify(actor: Actor, id: string, file?: Express.Multer.File) {
    if (actor.role !== "PROVIDER") throw missing();
    await this.authorized(actor, id);
    const match = await this.ledger.verify(actor, id, pdfDigest(file));
    await this.workspaces.recordVerification(actor, id, match);
    return { result: match ? "MATCH" : "MISMATCH", mode: this.mode };
  }
}

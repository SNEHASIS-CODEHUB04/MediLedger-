import {
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import nodemailer from "nodemailer";
import type { Prisma, PrismaClient } from "@prisma/client";
import { appendEvent, lockIdentity } from "./security-log";

export const systemId = "mediledger-control-plane";
export function systemOrganization(tx: Prisma.TransactionClient) {
  return tx.organization.upsert({
    where: { id: systemId },
    update: {},
    create: {
      id: systemId,
      name: "MediLedger account registry",
      mspId: "SYSTEM",
      status: "ACTIVE",
    },
  });
}

export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function validatePassword(password: string) {
  if (password.length < 12 || Buffer.byteLength(password) > 72)
    throw new BadRequestException(
      "Use a password between 12 characters and 72 UTF-8 bytes.",
    );
}

type Purpose = "VERIFY" | "RESET" | "INVITE";
type Delivery = { email: string; token: string; purpose: Purpose };

export class Accounts {
  constructor(private readonly db: PrismaClient) {}

  private mailConfiguration() {
    const { SMTP_URL, SMTP_FROM, WEB_ORIGIN } = process.env;
    if (!SMTP_URL || !SMTP_FROM || !WEB_ORIGIN)
      throw new ServiceUnavailableException(
        "Account email is unavailable. Contact the operator.",
      );
    return {
      transport: nodemailer.createTransport(SMTP_URL),
      from: SMTP_FROM,
      origin: WEB_ORIGIN,
    };
  }

  async send(delivery: Delivery) {
    const { transport, from, origin } = this.mailConfiguration();
    const uri = new URL(
      delivery.purpose === "VERIFY" ? "/confirm-email/" : "/reset-password/",
      origin,
    );
    uri.hash = "token=" + delivery.token;
    const action =
      delivery.purpose === "VERIFY"
        ? "Verify your email"
        : delivery.purpose === "INVITE"
          ? "Accept your invitation"
          : "Reset your password";
    try {
      await transport.sendMail({
        from,
        to: delivery.email,
        subject: action + " · MediLedger",
        text:
          action +
          " using this one-time link:\n" +
          uri +
          "\nIf you did not request this, you can ignore this email.",
      });
    } catch {
      throw new ServiceUnavailableException(
        "Account email could not be delivered. Try again later.",
      );
    } finally {
      transport.close();
    }
  }

  async issue(
    tx: Prisma.TransactionClient,
    user: { id: string; email: string },
    purpose: Purpose,
  ): Promise<Delivery> {
    const token = randomBytes(32).toString("base64url");
    await tx.accountToken.deleteMany({ where: { userId: user.id, purpose } });
    await tx.accountToken.create({
      data: {
        hash: hashToken(token),
        userId: user.id,
        purpose,
        expiresAt: new Date(
          Date.now() + (purpose === "RESET" ? 30 : 1440) * 60_000,
        ),
      },
    });
    return { email: user.email, token, purpose };
  }

  async signup(email: string, password: string) {
    validatePassword(password);
    this.mailConfiguration().transport.close();
    const passwordHash = await hash(password, 12);
    const delivery = await this.db.$transaction(async (tx) => {
      await lockIdentity(tx);
      if (
        (await tx.systemSettings.findUnique({ where: { id: 1 } }))
          ?.registrationOpen === false
      )
        throw new BadRequestException("Public registration is closed.");
      if (await tx.user.findUnique({ where: { email } })) return;
      const org = await systemOrganization(tx);
      const user = await tx.user.create({
        data: { email, passwordHash, role: "PATIENT", organizationId: org.id },
      });
      await appendEvent(tx, "ACCOUNT_SIGNED_UP", user.id);
      return this.issue(tx, user, "VERIFY");
    });
    if (delivery) await this.send(delivery);
  }

  async recover(email: string, purpose: "VERIFY" | "RESET") {
    this.mailConfiguration().transport.close();
    const delivery = await this.db.$transaction(async (tx) => {
      await lockIdentity(tx);
      const user = await tx.user.findUnique({ where: { email } });
      if (
        !user?.active ||
        (purpose === "VERIFY" && (user.verifiedAt || user.mustSetPassword))
      )
        return;
      if (purpose === "RESET" && !user.verifiedAt && !user.mustSetPassword)
        return;
      return this.issue(
        tx,
        user,
        purpose === "RESET" && user.mustSetPassword ? "INVITE" : purpose,
      );
    });
    if (delivery) {
      try {
        await this.send(delivery);
      } catch {
        /* Keep account recovery responses uniform. */
      }
    }
  }

  async consume(token: string, password?: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new BadRequestException("This link is invalid or expired.");
    if (password !== undefined) validatePassword(password);
    const passwordHash =
      password === undefined ? undefined : await hash(password, 12);
    await this.db.$transaction(async (tx) => {
      await lockIdentity(tx);
      const entry = await tx.accountToken.findUnique({
        where: { hash: hashToken(token) },
        include: { user: true },
      });
      if (
        !entry ||
        !entry.user.active ||
        entry.expiresAt <= new Date() ||
        (passwordHash === undefined
          ? entry.purpose !== "VERIFY" || entry.user.mustSetPassword
          : !["RESET", "INVITE"].includes(entry.purpose))
      ) {
        throw new BadRequestException("This link is invalid or expired.");
      }
      await tx.user.update({
        where: { id: entry.userId },
        data:
          passwordHash === undefined
            ? { verifiedAt: new Date() }
            : {
                passwordHash,
                verifiedAt: entry.user.verifiedAt ?? new Date(),
                mustSetPassword: false,
              },
      });
      await tx.accountToken.deleteMany({ where: { userId: entry.userId } });
      if (passwordHash !== undefined)
        await tx.session.deleteMany({ where: { userId: entry.userId } });
      await appendEvent(
        tx,
        passwordHash === undefined ? "EMAIL_VERIFIED" : "PASSWORD_SET",
        entry.userId,
      );
    });
  }
}

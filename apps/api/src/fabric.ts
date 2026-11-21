import { readFile } from "node:fs/promises";
import { createPrivateKey } from "node:crypto";
import { join } from "node:path";
import { Client, credentials } from "@grpc/grpc-js";
import { connect, signers, type Contract } from "@hyperledger/fabric-gateway";
import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import type { Actor } from "@mediledger/shared";
import type { PrismaClient } from "@prisma/client";
import { missing, type LedgerPort, type LedgerRecord } from "./ledger";

export class FabricLedgerAdapter implements LedgerPort {
  private readonly channel: string;
  private readonly chaincode: string;
  private readonly identities: string;

  constructor(private readonly db: PrismaClient) {
    this.channel = this.required("FABRIC_CHANNEL");
    this.chaincode = this.required("FABRIC_CHAINCODE");
    this.identities = this.required("FABRIC_IDENTITY_ROOT");
  }

  private required(name: string) {
    const value = process.env[name];
    if (!value) throw new Error(name + " is required in LIVE_FABRIC");
    return value;
  }

  private async withContract<T>(
    actor: Actor,
    operation: (contract: Contract) => Promise<T>,
  ) {
    let client: Client | undefined;
    let gateway: ReturnType<typeof connect> | undefined;
    try {
      if (
        !/^[0-9a-f-]{36}$/.test(actor.id) ||
        !/^(Org1MSP|Org2MSP)$/.test(actor.organization)
      )
        throw new Error("Invalid identity");
      // Evaluate and confirm commits through the same demo peer.
      // Sign with the caller's own MSP and certificate.
      const prefix = "FABRIC_ORG1MSP_";
      const folder = join(this.identities, actor.id);
      const [tls, certificate, key] = await Promise.all([
        readFile(this.required(prefix + "TLS")),
        readFile(join(folder, "cert.pem")),
        readFile(join(folder, "key.pem")),
      ]);
      client = new Client(
        this.required(prefix + "ENDPOINT"),
        credentials.createSsl(tls),
        {
          "grpc.ssl_target_name_override": this.required(prefix + "HOST"),
        },
      );
      const deadline = () => ({ deadline: Date.now() + 8000 });
      gateway = connect({
        client,
        identity: { mspId: actor.organization, credentials: certificate },
        signer: signers.newPrivateKeySigner(createPrivateKey(key)),
        evaluateOptions: deadline,
        endorseOptions: deadline,
        submitOptions: deadline,
        commitStatusOptions: deadline,
      });
      return await operation(
        gateway.getNetwork(this.channel).getContract(this.chaincode),
      );
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      const diagnostics = error as {
        details?: Array<{ message?: string }> | string;
        message?: string;
      };
      const messages = Array.isArray(diagnostics.details)
        ? diagnostics.details.map((detail) => detail.message).join(" ")
        : (diagnostics.details ?? "") + " " + (diagnostics.message ?? "");
      if (messages.includes("MEDILEDGER_RECORD_UNAVAILABLE")) throw missing();
      if (messages.includes("MEDILEDGER_CONFLICT"))
        throw new ConflictException("Ledger state already changed");
      throw new ServiceUnavailableException(
        "Fabric unavailable or commit could not be confirmed",
      );
    } finally {
      gateway?.close();
      client?.close();
    }
  }

  async ping() {
    const user = await this.db.user.findFirst({
      where: { role: "ISSUER" },
      include: { organization: true },
    });
    if (!user)
      throw new ServiceUnavailableException(
        "Fabric probe identity unavailable",
      );
    await this.withContract(
      { id: user.id, role: user.role, organization: user.organization.mspId },
      (contract) => contract.evaluateTransaction("Ping"),
    );
  }

  private async submit(
    actor: Actor,
    id: string,
    action: string,
    args: string[],
  ) {
    await this.withContract(actor, async (contract) => {
      const transaction = await contract.submitAsync(action, {
        arguments: [id, ...args],
      });
      const status = await transaction.getStatus();
      if (!status.successful) {
        throw new ConflictException(
          "Fabric rejected transaction " +
            transaction.getTransactionId() +
            " with validation code " +
            status.code,
        );
      }
      await this.db.fabricTransaction.create({
        data: {
          txId: transaction.getTransactionId(),
          recordId: id,
          functionName: action,
          submittedBy: actor.id,
          commitStatus: "COMMITTED",
        },
      });
    });
  }

  register(actor: Actor, id: string, owner: string, digest: string) {
    return this.submit(actor, id, "RegisterRecord", [owner, digest]);
  }

  async read(actor: Actor, id: string): Promise<LedgerRecord> {
    const result = await this.withContract(actor, (contract) =>
      contract
        .newProposal("ReadRecord", {
          arguments: [id],
          endorsingOrganizations: ["Org1MSP"],
        })
        .evaluate(),
    );
    return JSON.parse(Buffer.from(result).toString("utf8"));
  }

  consent(actor: Actor, id: string, provider: string, grant: boolean) {
    return this.submit(actor, id, grant ? "GrantAccess" : "RevokeAccess", [
      provider,
    ]);
  }

  async verify(actor: Actor, id: string, digest: string) {
    const result = await this.withContract(actor, (contract) =>
      contract
        .newProposal("VerifyDocumentHash", {
          arguments: [id, digest],
          endorsingOrganizations: ["Org1MSP"],
        })
        .evaluate(),
    );
    const value = Buffer.from(result).toString("utf8");
    if (value !== "true" && value !== "false")
      throw new ServiceUnavailableException(
        "Fabric returned an invalid verification result",
      );
    return value === "true";
  }
}

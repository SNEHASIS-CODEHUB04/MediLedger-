const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { pdfDigest, PrivateFiles } = require("../dist/files");
const { selectMode, SimulatedLedgerAdapter } = require("../dist/ledger");
const { FabricLedgerAdapter } = require("../dist/fabric");

const upload = (source, originalname = "report.pdf") => {
  const buffer = Buffer.from(source);
  return { buffer, size: buffer.length, originalname };
};

test("digest comes from bytes and detects a one-byte change", () => {
  const file = upload("%PDF-1.4\nA\n%%EOF\n");
  const tampered = upload("%PDF-1.4\nB\n%%EOF\n");
  assert.equal(
    pdfDigest(file),
    createHash("sha256").update(file.buffer).digest("hex"),
  );
  assert.notEqual(pdfDigest(file), pdfDigest(tampered));
});

test("rejects invalid upload envelopes and storage paths", () => {
  assert.throws(() => pdfDigest(upload("%PDF-1.4\n%%EOF", "report.exe")));
  assert.throws(() => pdfDigest(upload("plain text")));
  assert.throws(() => pdfDigest(upload("%PDF-1.4")));
  assert.throws(() =>
    pdfDigest({ ...upload("%PDF-1.4\n%%EOF"), size: 5242881 }),
  );
  assert.throws(() => new PrivateFiles("test-private").get("../../outside"));
});

test("mode selection requires an explicit supported value", () => {
  assert.throws(() => selectMode(undefined));
  assert.throws(() => selectMode("simulation"));
  assert.equal(selectMode("PUBLIC_DEMO"), "PUBLIC_DEMO");
  assert.equal(selectMode("LIVE_FABRIC"), "LIVE_FABRIC");
});

test("live identity failure produces 503", async () => {
  const names = [
    "FABRIC_CHANNEL",
    "FABRIC_CHAINCODE",
    "FABRIC_IDENTITY_ROOT",
    "FABRIC_ORG1MSP_TLS",
  ];
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) process.env[name] = "missing-test-resource";
    const adapter = new FabricLedgerAdapter({});
    await assert.rejects(
      adapter.read(
        {
          id: "10000000-0000-4000-8000-000000000001",
          organization: "Org1MSP",
          role: "ISSUER",
        },
        "unused",
      ),
      (error) => error.getStatus() === 503,
    );
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("a simulated event carries an explicit label without a Fabric transaction ID", async () => {
  let state;
  const adapter = new SimulatedLedgerAdapter({
    simulation: {
      create: async (row) => {
        state = row.data.state;
      },
    },
  });
  await adapter.register(
    { id: "issuer", role: "ISSUER", organization: "Org1MSP" },
    "record",
    "owner",
    "digest",
  );
  assert.equal(state.history[0].status, "SIMULATED");
  assert.equal(state.history[0].mode, "PUBLIC_DEMO");
  assert.equal(state.history[0].txId, undefined);
});

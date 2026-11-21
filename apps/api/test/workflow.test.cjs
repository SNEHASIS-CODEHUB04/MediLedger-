const { test } = require("node:test");
const assert = require("node:assert/strict");

const url = process.env.MEDILEDGER_TEST_API;
const password = process.env.FIXTURE_PASSWORD;
const mode = process.env.MEDILEDGER_TEST_MODE ?? "PUBLIC_DEMO";
const { fixture: fixtureBytes } = require("../dist/fixture");
const post = (value) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(value),
});

async function api(path, token, opts = {}) {
  const headers = new Headers(opts.headers);
  if (token) headers.set("Authorization", "Bearer " + token);
  const response = await fetch(url + path, { ...opts, headers });
  assert.equal(response.headers.get("X-MediLedger-Mode"), mode);
  return response;
}

async function login(account) {
  const response = await api(
    "/auth/login",
    "",
    post({ email: account + "@mediledger.example", password }),
  );
  assert.equal(response.status, 200);
  return (await response.json()).token;
}

function upload(bytes, subject) {
  const form = new FormData();
  if (subject) form.set("subject", subject);
  form.set(
    "file",
    new Blob([bytes], { type: "application/pdf" }),
    "synthetic-workflow.pdf",
  );
  return { method: "POST", body: form };
}

test(
  "PostgreSQL consent and file integrity workflow",
  { skip: !url ? "Set MEDILEDGER_TEST_API to a disposable seeded API" : false },
  async () => {
    const health = await api("/health");
    assert.deepEqual(await health.json(), {
      mode,
      database: true,
      ledger: mode === "LIVE_FABRIC" ? "AVAILABLE" : "SIMULATED",
    });
    const issuer = await login("issuer");
    const patient = await login("patient");
    const other = await login("patient-b");
    const provider = await login("provider");
    const patientId = (await (await api("/users/me", patient)).json()).id;
    const providerId = (await (await api("/users/me", provider)).json()).id;
    const original = fixtureBytes();
    if (mode === "PUBLIC_DEMO") {
      const fixtureResponse = await api("/records", patient);
      const fixture = (await fixtureResponse.json()).items.find(
        (record) => record.filename === "synthetic-report.pdf",
      );
      assert.ok(fixture);
      const seedPdf = await api(
        "/records/" + fixture.id + "/document",
        patient,
      );
      assert.deepEqual(Buffer.from(await seedPdf.arrayBuffer()), original);
    }
    const changed = Buffer.from(original);
    const textIndex = changed.indexOf("synthetic report");
    assert.ok(textIndex > 0);
    changed[textIndex] = 83;
    assert.equal(
      (await api("/records", provider, upload(original, patientId))).status,
      404,
    );
    assert.equal(
      (await api("/records", issuer, upload(Buffer.from("bad"), patientId)))
        .status,
      400,
    );
    const registered = await api(
      "/records",
      issuer,
      upload(original, patientId),
    );
    assert.equal(registered.status, 201, await registered.clone().text());
    const id = (await registered.json()).id;
    const path = "/records/" + id;
    const grant = post({ subject: providerId });
    assert.equal((await api(path + "/document")).status, 401);
    for (const suffix of ["", "/document", "/history"]) {
      assert.equal((await api(path + suffix, other)).status, 404);
      assert.equal((await api(path + suffix, provider)).status, 404);
    }
    assert.deepEqual(
      (await (await api("/patients/me/records", other)).json()).items,
      [],
    );
    assert.equal((await api(path + "/grants", other, grant)).status, 404);
    assert.equal(
      (
        await api(
          path + "/grants",
          patient,
          post({ subject: providerId, role: "ISSUER" }),
        )
      ).status,
      400,
    );
    assert.equal((await api(path + "/grants", patient, grant)).status, 204);
    assert.ok(
      (await (await api("/records", provider)).json()).items.some(
        (record) => record.id === id,
      ),
    );
    const download = await api(path + "/document", provider);
    assert.equal(download.status, 200);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), original);
    for (const [bytes, result] of [
      [original, "MATCH"],
      [changed, "MISMATCH"],
    ]) {
      const verification = await api(path + "/verify", provider, upload(bytes));
      assert.deepEqual(await verification.json(), {
        result,
        mode,
      });
    }
    assert.equal(
      (await api(path + "/grants/" + providerId, other, { method: "DELETE" }))
        .status,
      404,
    );
    assert.equal(
      (await api(path + "/grants/" + providerId, patient, { method: "DELETE" }))
        .status,
      204,
    );
    assert.equal((await api(path + "/document", provider)).status, 404);
    assert.equal(
      (await api(path + "/verify", provider, upload(original))).status,
      404,
    );
    assert.ok(
      !(await (await api("/records", provider)).json()).items.some(
        (record) => record.id === id,
      ),
    );
    const history = await (await api(path + "/history", patient)).json();
    assert.deepEqual(
      history.map((event) => event.action),
      ["RegisterRecord", "GrantAccess", "RevokeAccess"],
    );
    assert.ok(
      history.every(
        (event) =>
          event.mode === mode &&
          (mode === "LIVE_FABRIC"
            ? event.status === "COMMITTED" && /^[a-f0-9]{64}$/.test(event.txId)
            : event.status === "SIMULATED" && !("txId" in event)),
      ),
    );
    for (const token of [issuer, patient, other, provider]) {
      assert.equal(
        (await api("/auth/logout", token, { method: "POST" })).status,
        204,
      );
      assert.equal((await api("/users/me", token)).status, 401);
    }
  },
);

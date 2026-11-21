const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fixture } = require("../dist/fixture");

const base = process.env.MEDILEDGER_TEST_API;
const mode = process.env.MEDILEDGER_TEST_MODE ?? "PUBLIC_DEMO";
const password = process.env.FIXTURE_PASSWORD;
const body = (value, method = "POST") => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(value),
});
async function request(path, token, options = {}) {
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", "Bearer " + token);
  return fetch(base + path, { ...options, headers });
}
async function login(account) {
  const response = await request(
    "/auth/login",
    "",
    body({ email: account + "@mediledger.example", password }),
  );
  assert.equal(response.status, 200, await response.clone().text());
  return (await response.json()).token;
}
async function data(path, token) {
  const response = await request(path, token);
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
function upload(subject) {
  const form = new FormData();
  if (subject) form.set("subject", subject);
  form.set(
    "file",
    new Blob([fixture()], { type: "application/pdf" }),
    "workspace-test.pdf",
  );
  return { method: "POST", body: form };
}

test(
  "role workspaces preserve audit privacy, consent and organization boundaries",
  { skip: !base },
  async () => {
    const demo = await request("/auth/demo", "", body({ account: "auditor" }));
    if (mode === "LIVE_FABRIC") assert.equal(demo.status, 404);
    else if (demo.status === 200) {
      const { token } = await demo.json();
      assert.equal((await data("/users/me", token)).role, "AUDITOR");
      await request("/auth/logout", token, { method: "POST" });
    } else assert.equal(demo.status, 404);
    const [issuer, patient, provider, auditor] = await Promise.all(
      ["issuer", "patient", "provider", "auditor"].map(login),
    );
    const patientId = (await data("/users/me", patient)).id;
    const providerId = (await data("/users/me", provider)).id;
    assert.equal((await request("/workspace/audit", patient)).status, 403);
    assert.equal((await request("/workspace/audit", provider)).status, 403);
    assert.equal((await request("/workspace/staff", auditor)).status, 403);
    assert.equal(
      (
        await request(
          "/workspace/staff/" + providerId,
          issuer,
          body({ active: false }, "PATCH"),
        )
      ).status,
      404,
    );
    const staff = (await data("/workspace/staff", issuer)).items;
    assert.ok(
      staff.every((member) => member.email !== "provider@mediledger.example"),
    );

    if (mode === "PUBLIC_DEMO") {
      const doctor = staff.find(
        (member) => member.email === "doctor@mediledger.example",
      );
      assert.ok(doctor?.active);
      const doctorToken = await login("doctor");
      const path = "/workspace/staff/" + doctor.id;
      try {
        assert.equal(
          (await request(path, issuer, body({ active: false }, "PATCH")))
            .status,
          204,
        );
        assert.equal((await request("/users/me", doctorToken)).status, 401);
        assert.equal(
          (
            await request(
              "/auth/login",
              "",
              body({ email: doctor.email, password }),
            )
          ).status,
          401,
        );
      } finally {
        assert.equal(
          (await request(path, issuer, body({ active: true }, "PATCH"))).status,
          204,
        );
      }
      assert.equal((await request("/users/me", doctorToken)).status, 401);
    }

    const response = await request("/records", issuer, upload(patientId));
    assert.equal(response.status, 201, await response.clone().text());
    const { id } = await response.json();
    const path = "/records/" + id;
    for (const suffix of ["", "/document", "/history"])
      assert.equal((await request(path + suffix, auditor)).status, 404);
    assert.equal((await request("/records", auditor)).status, 404);
    assert.equal(
      (await request(path + "/grants", auditor, body({ subject: providerId })))
        .status,
      404,
    );
    assert.equal(
      (await request(path + "/verify", provider, upload())).status,
      404,
    );
    assert.equal(
      (await request(path + "/grants", patient, body({ subject: providerId })))
        .status,
      204,
    );
    try {
      const records = await data(
        "/records?search=" + patientId.slice(-8),
        provider,
      );
      assert.ok(
        records.items.some(
          (record) => record.id === id && record.patientRef === patientId,
        ),
      );
      const verified = await request(path + "/verify", provider, upload());
      assert.equal(verified.status, 200);
      assert.equal((await verified.json()).result, "MATCH");
      assert.ok(
        (await data("/workspace/verifications", provider)).items.some(
          (record) => record.recordId === id && record.result === "MATCH",
        ),
      );
      const events = (
        await data("/workspace/audit?action=VerifyDocumentHash", auditor)
      ).items;
      assert.ok(
        events.some(
          (event) =>
            event.recordId === id &&
            event.status === "MATCH" &&
            event.organization === "Org2MSP" &&
            event.txId === null &&
            event.mode === mode,
        ),
      );
      assert.ok(
        events.every(
          (event) => !("filename" in event) && !("patientRef" in event),
        ),
      );
      assert.ok(
        !(
          await data("/workspace/audit?action=VerifyDocumentHash", issuer)
        ).items.some((event) => event.recordId === id),
      );
      const registrations = (
        await data("/workspace/audit?action=RegisterRecord", auditor)
      ).items;
      const registration = registrations.find((event) => event.recordId === id);
      assert.ok(registration);
      if (mode === "LIVE_FABRIC")
        assert.match(registration.txId, /^[0-9a-f]{64}$/);
      else {
        assert.equal(registration.txId, null);
        assert.equal(registration.status, "SIMULATED");
      }
      const metrics = await data("/workspace/overview", patient);
      assert.ok(
        metrics.records > 0 &&
          metrics.activeGrants > 0 &&
          metrics.recent.length > 0,
      );
    } finally {
      assert.equal(
        (
          await request(path + "/grants/" + providerId, patient, {
            method: "DELETE",
          })
        ).status,
        204,
      );
    }
    assert.equal((await request(path + "/document", provider)).status, 404);
    for (const token of [issuer, patient, provider, auditor])
      await request("/auth/logout", token, { method: "POST" });
  },
);

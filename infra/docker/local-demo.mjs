import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const config = new URL(".env.local-stack", root);
const origin = "http://127.0.0.1:8080";
const argumentsForCompose = [
  "compose",
  "--project-name",
  "mediledger-local",
  "--env-file",
  ".env.local-stack",
  "-f",
  "infra/docker/public-demo.yaml",
  "-f",
  "infra/docker/local-demo.yaml",
];
const command = process.argv[2] ?? "start";
if (command !== "start" && command !== "stop") {
  console.error("Usage: node infra/docker/local-demo.mjs [start|stop]");
  process.exit(1);
}

if (command === "start") {
  const databasePassword = randomBytes(24).toString("hex");
  try {
    writeFileSync(
      config,
      [
        "POSTGRES_PASSWORD=" + databasePassword,
        "HOSTED_DATABASE_URL=postgresql://mediledger:" +
          databasePassword +
          "@postgres:5432/mediledger",
        "FIXTURE_PASSWORD=mediledger-local-demo",
        "WEB_ORIGIN=" + origin,
        "",
      ].join("\n"),
      { flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
}

const result = spawnSync(
  "docker",
  [
    ...argumentsForCompose,
    ...(command === "start" ? ["up", "--build", "-d"] : ["stop"]),
  ],
  { cwd: root, stdio: "inherit" },
);

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
if (command === "stop") process.exit(0);

for (let attempt = 0; attempt < 30; attempt++) {
  try {
    const response = await fetch(origin + "/api/health", {
      signal: AbortSignal.timeout(1500),
    });
    if (response.ok && (await response.json()).ledger === "SIMULATED") {
      console.log("MediLedger is running at " + origin);
      process.exit(0);
    }
  } catch {
    // nginx and the API can start at different times.
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

console.error("MediLedger did not become ready. Recent container logs:");
spawnSync("docker", [...argumentsForCompose, "logs", "--tail", "30"], {
  cwd: root,
  stdio: "inherit",
});
process.exitCode = 1;

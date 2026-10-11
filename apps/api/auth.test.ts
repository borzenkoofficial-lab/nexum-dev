import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hashPassword, validateEmail, validateName, verifyPassword } from "./auth.js";

const authDirectory = fileURLToPath(new URL(".", import.meta.url));

function importAuthInProduction(secret: string | null, authEnabled = "true") {
  const env = {
    ...process.env,
    NODE_ENV: "production",
    NEXUM_AUTH_ENABLED: authEnabled,
  };
  if (secret === null) {
    delete env.NEXUM_AUTH_SECRET;
  } else {
    env.NEXUM_AUTH_SECRET = secret;
  }

  return spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", "await import('./auth.ts')"],
    {
      cwd: authDirectory,
      env,
      encoding: "utf8",
      timeout: 10_000,
    },
  );
}

test("production auth fails at startup when the secret is missing or too short", () => {
  const missing = importAuthInProduction(null);
  assert.notEqual(missing.status, 0, "missing production secret must stop startup");
  assert.match(missing.stderr, /NEXUM_AUTH_SECRET must be configured/);

  const tooShort = importAuthInProduction("short-secret");
  assert.notEqual(tooShort.status, 0, "short production secret must stop startup");
  assert.match(tooShort.stderr, /NEXUM_AUTH_SECRET must be configured/);
});

test("production auth starts with a secret of at least 32 characters", () => {
  const valid = importAuthInProduction("ci-only-test-secret-at-least-32-characters");
  assert.equal(valid.status, 0, valid.stderr || valid.stdout);
});

test("production auth cannot be disabled", () => {
  const disabled = importAuthInProduction("ci-only-test-secret-at-least-32-characters", "false");
  assert.notEqual(disabled.status, 0, "production startup must fail when auth is disabled");
  assert.match(disabled.stderr, /NEXUM_AUTH_ENABLED must be true in production/);
});

test("validateEmail accepts normal addresses and rejects whitespace", () => {
  assert.equal(validateEmail(" User@example.com "), "user@example.com");
  assert.throws(() => validateEmail("user @example.com"));
  assert.throws(() => validateEmail("user@example"));
});

test("validateName collapses repeated whitespace", () => {
  assert.equal(validateName("  Semen   Borzenko  "), "Semen Borzenko");
  assert.throws(() => validateName("   "));
});

test("password hash round-trip works", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert.equal(await verifyPassword("correct horse battery staple", hash), true);
  assert.equal(await verifyPassword("wrong password", hash), false);
});

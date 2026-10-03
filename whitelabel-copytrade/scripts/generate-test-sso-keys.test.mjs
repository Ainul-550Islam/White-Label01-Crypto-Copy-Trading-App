/**
 * Tests for the test-only SAML key generator (run: `node --test scripts/`).
 *
 * The generator replaces committed fixture keys, so these tests pin the
 * properties the SSO specs and the release rules depend on: a complete,
 * matching, correctly dated set; no key material on stdout or stderr; no
 * deletion of a directory the script did not create; a clear refusal without
 * OpenSSL; and the generated directory staying out of version control.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_OUT_DIR,
  GENERATED_FILES,
  KeyGenerationError,
  MARKER_FILE,
  generateTestSsoKeys,
  verifyGeneratedSet,
} from "./generate-test-sso-keys.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts", "generate-test-sso-keys.mjs");
const opensslAvailable =
  spawnSync("openssl", ["version"], { stdio: "ignore" }).status === 0;

function scratch() {
  const base = mkdtempSync(join(tmpdir(), "wlct-sso-keys-"));
  return { base, out: join(base, "sso-test-keys") };
}

test(
  "generates a complete, matching, correctly dated set",
  { skip: !opensslAvailable && "openssl not installed" },
  () => {
    const { base, out } = scratch();
    try {
      const files = generateTestSsoKeys({ outDir: out });
      assert.deepEqual(files, [...GENERATED_FILES]);
      for (const file of GENERATED_FILES)
        assert.ok(existsSync(join(out, file)), `${file} exists`);
      assert.ok(existsSync(join(out, MARKER_FILE)), "marker exists");
      verifyGeneratedSet(out);

      const idp = new X509Certificate(readFileSync(join(out, "idp.cert.pem")));
      assert.match(idp.subject, /CN=wlct-test-idp/);
      assert.ok(
        Date.parse(idp.validTo) > Date.now() + 50 * 365 * 24 * 3600 * 1000,
        "idp certificate is long-lived",
      );
      const expired = new X509Certificate(
        readFileSync(join(out, "expired.cert.pem")),
      );
      assert.equal(
        new Date(expired.validFrom).toISOString(),
        "2020-01-01T00:00:00.000Z",
      );
      assert.equal(
        new Date(expired.validTo).toISOString(),
        "2021-01-01T00:00:00.000Z",
      );
      if (process.platform !== "win32") {
        assert.equal(
          statSync(join(out, "idp.key.pem")).mode & 0o077,
          0,
          "private keys are not group/world readable",
        );
      }
      // Different signers really are different keys.
      assert.notEqual(
        readFileSync(join(out, "idp.cert.pem"), "utf8"),
        readFileSync(join(out, "attacker.cert.pem"), "utf8"),
      );
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  },
);

test(
  "every run produces fresh keys and replaces only its own directory",
  { skip: !opensslAvailable && "openssl not installed" },
  () => {
    const { base, out } = scratch();
    try {
      generateTestSsoKeys({ outDir: out });
      const first = readFileSync(join(out, "idp.key.pem"), "utf8");
      generateTestSsoKeys({ outDir: out });
      const second = readFileSync(join(out, "idp.key.pem"), "utf8");
      assert.notEqual(first, second, "a second run generates a new key");
      // No temp directories are left behind next to the output.
      const leftovers = readdirSync(base);
      assert.deepEqual(leftovers, ["sso-test-keys"]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  },
);

test("refuses to replace a directory it did not create, and deletes nothing", () => {
  const { base, out } = scratch();
  try {
    mkdirSync(out);
    writeFileSync(join(out, "precious.txt"), "not yours");
    assert.throws(
      () => generateTestSsoKeys({ outDir: out }),
      (error) => error instanceof KeyGenerationError && error.exitCode === 3,
    );
    assert.equal(readFileSync(join(out, "precious.txt"), "utf8"), "not yours");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("refuses an output directory with any other name", () => {
  const base = mkdtempSync(join(tmpdir(), "wlct-sso-keys-"));
  try {
    assert.throws(
      () => generateTestSsoKeys({ outDir: join(base, "fixtures") }),
      (error) => error instanceof KeyGenerationError && error.exitCode === 64,
    );
    assert.equal(existsSync(join(base, "fixtures")), false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("without OpenSSL it fails clearly (exit 2) and writes nothing", () => {
  const { base, out } = scratch();
  try {
    const result = spawnSync(process.execPath, [SCRIPT, "--out", out], {
      encoding: "utf8",
      env: { ...process.env, PATH: join(base, "no-such-bin") },
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /OpenSSL is required/);
    assert.equal(existsSync(out), false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test(
  "the CLI never prints key material",
  { skip: !opensslAvailable && "openssl not installed" },
  () => {
    const { base, out } = scratch();
    try {
      const result = spawnSync(process.execPath, [SCRIPT, "--out", out], {
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      const printed = `${result.stdout}\n${result.stderr}`;
      assert.doesNotMatch(
        printed,
        /BEGIN (RSA |EC )?PRIVATE KEY|BEGIN CERTIFICATE|MII[A-Za-z0-9+/]{20}/,
      );
      assert.match(result.stdout, /idp\.key\.pem/);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  },
);

test("the default output directory is git-ignored and outside every source tree", () => {
  assert.equal(
    DEFAULT_OUT_DIR,
    join(ROOT, "apps", "api", ".generated", "sso-test-keys"),
  );
  const ignored = spawnSync(
    "git",
    ["check-ignore", "-q", join(DEFAULT_OUT_DIR, "idp.key.pem")],
    { cwd: ROOT },
  );
  if (ignored.error || ignored.status === 128) return; // not a git checkout (e.g. extracted archive)
  assert.equal(
    ignored.status,
    0,
    "apps/api/.generated/ must be listed in .gitignore",
  );
  assert.doesNotMatch(DEFAULT_OUT_DIR, /[\\/]src[\\/]/);
});

test("no private key is committed anywhere in the repository", () => {
  const listed = spawnSync("git", ["ls-files", "-z"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (listed.error || listed.status !== 0) return; // not a git checkout
  const offenders = [];
  for (const file of listed.stdout.split("\0").filter(Boolean)) {
    if (!/\.(pem|key|p12|pfx)$/i.test(file)) continue;
    const full = join(ROOT, file);
    if (!existsSync(full)) continue;
    if (/PRIVATE KEY/.test(readFileSync(full, "utf8"))) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});

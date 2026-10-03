#!/usr/bin/env node
/**
 * Generates the TEST-ONLY SAML signing material used by the API's SSO specs.
 *
 *   node scripts/generate-test-sso-keys.mjs            write apps/api/.generated/sso-test-keys/
 *   node scripts/generate-test-sso-keys.mjs --out DIR  write DIR (its last segment must be
 *                                                      "sso-test-keys")
 *
 * Why generated and not committed: the repository and its release archive must
 * never contain a private key, not even a test one. Secret scanners cannot tell
 * a test key from a real one, and an allowlist for one is a habit nobody should
 * learn. The API's jest globalSetup (apps/api/test/sso-test-keys.global-setup.js)
 * runs this script before every test run, so a plain `npm test` works without a
 * manual step and every run verifies against freshly generated keys.
 *
 * What it writes (deterministic file names, fresh keys every run):
 *
 *   idp.key.pem / idp.cert.pem            the "configured" IdP signing pair
 *                                         (self-signed, valid for 100 years)
 *   attacker.key.pem / attacker.cert.pem  an unknown signer; the specs require every
 *                                         response it signs to be rejected
 *   spenc.key.pem / spenc.cert.pem        the service provider's encryption pair: the
 *                                         IdP encrypts assertions to spenc.cert.pem and
 *                                         the SP decrypts with spenc.key.pem (encrypted
 *                                         assertion specs)
 *   expired.key.pem / expired.cert.pem    a certificate valid only during 2020;
 *                                         configuration validation must ignore it
 *   .wlct-generated-test-keys             marker: this directory belongs to this script
 *
 * Safety rules, each one enforced below:
 *   - OpenSSL must be on PATH; without it the script exits 2 with an explanation.
 *     It never falls back to a hard-coded key and never lets a test skip.
 *   - Private key material is never printed: OpenSSL output is captured, and only
 *     file names are logged.
 *   - Everything is generated in a sibling temp directory and verified (each key
 *     matches its certificate, the expired certificate really is expired) before
 *     it replaces the output directory, so a failed run leaves no half-written set.
 *   - An existing output directory is replaced only when it carries the marker file.
 *     Any other directory is refused (exit 3): the script deletes nothing it did not
 *     create.
 *   - Running it repeatedly is safe; each run replaces the previous set.
 *
 * Exit codes: 0 generated; 1 generation or verification failed; 2 OpenSSL missing;
 * 3 refused to replace a directory this script does not own; 64 bad arguments.
 */

import { spawnSync } from "node:child_process";
import { X509Certificate, createPrivateKey } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Where the API specs read the keys from (git-ignored, never packaged). */
export const DEFAULT_OUT_DIR = join(
  ROOT,
  "apps",
  "api",
  ".generated",
  "sso-test-keys",
);
/** The only directory name this script will write to or replace. */
export const OUT_DIR_NAME = "sso-test-keys";
/** Marker that proves a directory was created by this script. */
export const MARKER_FILE = ".wlct-generated-test-keys";

/** Self-signed pairs created with `openssl req -x509`. */
const CURRENT_PAIRS = [
  { name: "idp", subject: "/CN=wlct-test-idp/O=WLCT TEST ONLY" },
  { name: "attacker", subject: "/CN=wlct-test-attacker/O=WLCT TEST ONLY" },
  { name: "spenc", subject: "/CN=wlct-test-sp-encryption/O=WLCT TEST ONLY" },
];

/** The expired pair: validity fixed to calendar year 2020. */
const EXPIRED_PAIR = {
  name: "expired",
  subject: "/CN=wlct-test-expired/O=WLCT TEST ONLY",
  startDate: "20200101000000Z",
  endDate: "20210101000000Z",
};

/** Every file a complete set contains (the specs read a subset of these). */
export const GENERATED_FILES = Object.freeze([
  "idp.key.pem",
  "idp.cert.pem",
  "attacker.key.pem",
  "attacker.cert.pem",
  "spenc.key.pem",
  "spenc.cert.pem",
  "expired.key.pem",
  "expired.cert.pem",
]);

export class KeyGenerationError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.name = "KeyGenerationError";
    this.exitCode = exitCode;
  }
}

/**
 * Runs openssl with captured output. stdout and stderr are never echoed: key
 * generation can print progress, and nothing from this process may carry key
 * material. On failure only the first lines of stderr are surfaced.
 */
function runOpenssl(args, cwd, opensslBin) {
  const result = spawnSync(opensslBin, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw new KeyGenerationError(
      `could not run ${opensslBin}: ${result.error.message}`,
      1,
    );
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || "")
      .split("\n")
      .filter((line) => line.trim() && !line.includes("PRIVATE KEY"))
      .slice(0, 6)
      .join("\n");
    throw new KeyGenerationError(
      `openssl ${args[0]} failed (exit ${result.status}):\n${detail}`,
      1,
    );
  }
}

/** Returns the OpenSSL version line, or throws exit-code 2 when OpenSSL is unavailable. */
export function checkOpenssl(opensslBin = "openssl") {
  const result = spawnSync(opensslBin, ["version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    throw new KeyGenerationError(
      "OpenSSL is required to generate the test-only SAML keys used by the API SSO specs, " +
        `but "${opensslBin} version" could not run` +
        (result.error
          ? ` (${result.error.code || result.error.message})`
          : ` (exit ${result.status})`) +
        ". Install OpenSSL (Linux: the openssl package; macOS: preinstalled or Homebrew; " +
        "Windows: Git for Windows ships it) and make sure it is on PATH.",
      2,
    );
  }
  return String(result.stdout).trim();
}

/** Minimal `openssl ca` configuration: the portable way to issue a certificate with past dates. */
function caConfig() {
  return [
    "[ ca ]",
    "default_ca = test_ca",
    "",
    "[ test_ca ]",
    "dir = .",
    "database = ./index.txt",
    "new_certs_dir = ./issued",
    "serial = ./serial",
    "default_md = sha256",
    "policy = policy_any",
    "unique_subject = no",
    "copy_extensions = none",
    "email_in_dn = no",
    "",
    "[ policy_any ]",
    "commonName = supplied",
    "organizationName = optional",
    "",
    "[ v3_test ]",
    "basicConstraints = critical,CA:TRUE",
    "subjectKeyIdentifier = hash",
    "",
  ].join("\n");
}

function generateCurrentPair(workDir, pair, opensslBin) {
  runOpenssl(
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      `${pair.name}.key.pem`,
      "-out",
      `${pair.name}.cert.pem`,
      "-days",
      "36500",
      "-subj",
      pair.subject,
      "-sha256",
    ],
    workDir,
    opensslBin,
  );
}

function generateExpiredPair(workDir, pair, opensslBin) {
  const caDir = join(workDir, ".ca");
  mkdirSync(join(caDir, "issued"), { recursive: true });
  writeFileSync(join(caDir, "index.txt"), "");
  writeFileSync(join(caDir, "serial"), "1000\n");
  writeFileSync(join(caDir, "ca.cnf"), caConfig());
  runOpenssl(
    [
      "req",
      "-new",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(workDir, `${pair.name}.key.pem`),
      "-out",
      join(caDir, `${pair.name}.csr`),
      "-subj",
      pair.subject,
      "-sha256",
    ],
    caDir,
    opensslBin,
  );
  runOpenssl(
    [
      "ca",
      "-batch",
      "-selfsign",
      "-config",
      "ca.cnf",
      "-keyfile",
      join(workDir, `${pair.name}.key.pem`),
      "-in",
      `${pair.name}.csr`,
      "-out",
      join(workDir, `${pair.name}.cert.pem`),
      "-startdate",
      pair.startDate,
      "-enddate",
      pair.endDate,
      "-extensions",
      "v3_test",
      "-notext",
    ],
    caDir,
    opensslBin,
  );
  rmSync(caDir, { recursive: true, force: true });
}

/** Every key must match its certificate; the expired certificate must lie entirely in the past. */
export function verifyGeneratedSet(dir, nowMs = Date.now()) {
  for (const file of GENERATED_FILES) {
    if (!existsSync(join(dir, file)) || statSync(join(dir, file)).size === 0) {
      throw new KeyGenerationError(
        `generated set is incomplete: ${file} is missing or empty`,
        1,
      );
    }
  }
  for (const name of ["idp", "attacker", "spenc", "expired"]) {
    const cert = new X509Certificate(
      readFileSync(join(dir, `${name}.cert.pem`)),
    );
    const key = createPrivateKey(readFileSync(join(dir, `${name}.key.pem`)));
    if (!cert.checkPrivateKey(key)) {
      throw new KeyGenerationError(
        `${name}.key.pem does not match ${name}.cert.pem`,
        1,
      );
    }
    const validTo = Date.parse(cert.validTo);
    if (name === "expired") {
      if (!(validTo < nowMs)) {
        throw new KeyGenerationError("expired.cert.pem is not expired", 1);
      }
    } else if (!(Date.parse(cert.validFrom) <= nowMs && validTo > nowMs)) {
      throw new KeyGenerationError(
        `${name}.cert.pem is not currently valid`,
        1,
      );
    }
  }
}

/**
 * Generates a fresh set into `outDir`, replacing a previous set this script created.
 * Returns the list of files written (names only).
 */
export function generateTestSsoKeys({
  outDir = DEFAULT_OUT_DIR,
  opensslBin = "openssl",
} = {}) {
  const target = resolve(outDir);
  if (basename(target) !== OUT_DIR_NAME) {
    throw new KeyGenerationError(
      `refusing to write to ${target}: the output directory must be named "${OUT_DIR_NAME}"`,
      64,
    );
  }
  if (existsSync(target) && !existsSync(join(target, MARKER_FILE))) {
    throw new KeyGenerationError(
      `refusing to replace ${target}: it exists but was not created by this script (no ${MARKER_FILE})`,
      3,
    );
  }
  checkOpenssl(opensslBin);

  const parent = dirname(target);
  mkdirSync(parent, { recursive: true });
  const work = mkdtempSync(join(parent, `.${OUT_DIR_NAME}.tmp-`));
  try {
    for (const pair of CURRENT_PAIRS)
      generateCurrentPair(work, pair, opensslBin);
    generateExpiredPair(work, EXPIRED_PAIR, opensslBin);
    writeFileSync(
      join(work, MARKER_FILE),
      "Generated by scripts/generate-test-sso-keys.mjs. TEST ONLY - never commit, never configure for a tenant.\n",
    );
    for (const file of GENERATED_FILES) {
      if (file.endsWith(".key.pem")) chmodSync(join(work, file), 0o600);
    }
    verifyGeneratedSet(work);

    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    renameSync(work, target);
  } catch (error) {
    rmSync(work, { recursive: true, force: true });
    throw error;
  }
  return [...GENERATED_FILES];
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") {
      const value = argv[i + 1];
      if (!value) throw new KeyGenerationError("--out needs a directory", 64);
      options.outDir = value;
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new KeyGenerationError(`unknown argument: ${arg}`, 64);
    }
  }
  return options;
}

export function main(argv, log = console.log, logError = console.error) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      log(
        "usage: node scripts/generate-test-sso-keys.mjs [--out <dir>/sso-test-keys]",
      );
      return 0;
    }
    const outDir = options.outDir ?? DEFAULT_OUT_DIR;
    const files = generateTestSsoKeys({ outDir });
    log(
      `generated test-only SSO keys in ${resolve(outDir)}: ${files.join(", ")}`,
    );
    return 0;
  } catch (error) {
    const code = error instanceof KeyGenerationError ? error.exitCode : 1;
    logError(`generate-test-sso-keys: ${error.message}`);
    return code;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2));
}

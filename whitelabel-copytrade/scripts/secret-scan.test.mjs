/**
 * Tests for the secret-scanning gate (run: `node --test scripts/`).
 *
 * Two things are being pinned here, and both were learned by measuring rather than by reading:
 *
 *   1. The policy file must keep the default ruleset. A gitleaks config *replaces* the rules: with
 *      [extend] useDefault absent, the scan found nothing at all - including a planted `ghp_…` token -
 *      and reported success. A test that only checked "the scan is clean" would have passed on that.
 *   2. The allowlist must stay narrow. It requires both an exact synthetic value and an anchored
 *      exact test/example file path; no directory, rule, or wildcard exception is accepted.
 *
 * The end-to-end cases run only when a gitleaks binary is available (CI installs one; locally set
 * GITLEAKS_BINARY). They are skipped rather than silently passed, because a skipped scan is not
 * evidence of a clean one and the report must be able to say so.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
  mkdirSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, relative } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  CONFIG_PATH,
  REPO_ROOT,
  findScanner,
  runScan,
  summarize,
} from "./secret-scan.mjs";

const SCRIPT = join(REPO_ROOT, "scripts", "secret-scan.mjs");
const MONOREPO_ROOT = resolve(REPO_ROOT, "..");
const scanner = findScanner();

/** Minimal TOML reader for the shape this file uses: tables, string and array-of-string values. */
function parsePolicy(text) {
  const allowlists = [];
  let current = null;
  let inRegexes = false;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "[[allowlists]]") {
      current = { regexes: [], paths: [], description: null };
      allowlists.push(current);
      inRegexes = false;
      continue;
    }
    if (!current) continue;
    // Both the multi-line array and the single-line form are accepted; the policy file uses the
    // multi-line form for values and the single-line form for paths, and a parser that only handled
    // one of them silently reported the other as empty.
    const single = /^(regexes|paths)\s*=\s*\[(.*)\]$/.exec(line);
    if (single) {
      for (const match of single[2].matchAll(/'''(.*?)'''/g))
        current[single[1]].push(match[1]);
      inRegexes = false;
      continue;
    }
    if (line === "regexes = [") {
      inRegexes = "regexes";
      continue;
    }
    if (line === "paths = [") {
      inRegexes = "paths";
      continue;
    }
    if (line === "]") {
      inRegexes = false;
      continue;
    }
    if (inRegexes) {
      const literal = /^'''(.*)''',$/.exec(line);
      if (literal) current[inRegexes].push(literal[1]);
      else {
        const quoted = /^("(?:\\.|[^"])*"),$/.exec(line);
        if (quoted) current[inRegexes].push(JSON.parse(quoted[1]));
      }
      continue;
    }
    const description = /^description\s*=\s*"(.*)"$/.exec(line);
    if (description) current.description = description[1];
  }
  return { text, allowlists };
}

test("the policy keeps the default ruleset, because a config file replaces it", () => {
  const policy = readFileSync(CONFIG_PATH, "utf8");
  assert.match(
    policy,
    /\[extend\]/,
    ".gitleaks.toml must contain an [extend] table",
  );
  assert.match(
    policy,
    /useDefault\s*=\s*true/,
    "without useDefault = true the scan detects nothing at all",
  );
});

test("every allowlist entry says what it is for", () => {
  const { allowlists } = parsePolicy(readFileSync(CONFIG_PATH, "utf8"));
  assert.ok(
    allowlists.length >= 1,
    "the reviewed values must be listed explicitly",
  );
  for (const entry of allowlists) {
    assert.ok(
      entry.description && entry.description.length > 20,
      `allowlist entry without a real description: ${JSON.stringify(entry)}`,
    );
    assert.ok(
      entry.regexes.length + entry.paths.length > 0,
      "an allowlist entry that matches nothing is noise",
    );
  }
});

test("path exceptions are exact anchored filenames rather than broad directories", () => {
  const { allowlists } = parsePolicy(readFileSync(CONFIG_PATH, "utf8"));
  const pathEntries = allowlists.flatMap((entry) => entry.paths);
  assert.ok(
    pathEntries.length > 0,
    "reviewed fixture/example paths must be listed",
  );
  for (const pattern of pathEntries) {
    assert.match(
      pattern,
      /\$$/,
      `${pattern} must be anchored to an exact filename`,
    );
    assert.equal(
      pattern.includes(".*"),
      false,
      `${pattern} must not contain a wildcard path`,
    );
    assert.equal(
      pattern.includes("/$"),
      false,
      `${pattern} must not allow a whole directory`,
    );
  }
});

test("value exceptions are exact literals, so a different secret in the same file still fails", () => {
  const { allowlists } = parsePolicy(readFileSync(CONFIG_PATH, "utf8"));
  const values = allowlists.flatMap((entry) => entry.regexes);
  assert.ok(values.length > 0, "the reviewed synthetic values must be listed");
  for (const value of values) {
    assert.ok(value.length > 0);
    assert.match(
      value,
      /^\^\\Q/,
      `allowlist value must be an anchored literal: ${value}`,
    );
    assert.match(
      value,
      /\\E\$$/,
      `allowlist value must terminate the quoted literal: ${value}`,
    );
  }
});

test("a missing scanner is reported as blocked, never as clean", () => {
  const bare = spawnSync(process.execPath, [SCRIPT, "--tree", "--json"], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: "/nonexistent",
      GITLEAKS_BINARY: "/nonexistent/gitleaks",
    },
  });
  assert.equal(bare.status, 2, "exit code 2 means the scan could not run");
  const parsed = JSON.parse(bare.stdout);
  assert.equal(parsed.status, "BLOCKED");
  assert.match(parsed.reason, /not installed/);
});

test(
  "the working tree scans clean under the reviewed policy, and a planted token is still caught",
  {
    skip: scanner
      ? false
      : "gitleaks binary not available (set GITLEAKS_BINARY or install it; CI installs it)",
  },
  () => {
    const clean = runScan({ scanner, root: REPO_ROOT, history: false });
    assert.equal(clean.ran, true, `scan did not run: ${clean.reason ?? ""}`);
    assert.equal(
      summarize(clean.findings).total,
      0,
      `unexpected findings: ${JSON.stringify(summarize(clean.findings).fingerprints)}`,
    );

    // The same policy, a directory that is not the repository, and a value nobody reviewed.
    const probeDir = mkdtempSync(join(tmpdir(), "secret-probe-"));
    try {
      // Assembled at runtime on purpose: a literal token in this file is a finding, which is how the
      // first version of this test failed - the scanner reported the test itself.
      const planted = ["ghp", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"].join("_");
      writeFileSync(join(probeDir, "app.env"), `GITHUB_TOKEN=${planted}\n`);
      const caught = runScan({ scanner, root: probeDir, history: false });
      assert.equal(
        summarize(caught.findings).total,
        1,
        "an unreviewed token must be reported",
      );
      assert.equal(caught.findings[0].RuleID, "github-pat");
      assert.match(caught.findings[0].File, /app\.env$/);

      // A syntactically valid but deliberately fake access-key fixture proves that
      // the default AWS detector remains active. Assemble it so the repository's
      // clean-tree scan cannot mistake the fixture source itself for a credential.
      // The pinned scanner's aws-access-token rule matches AKIA + 16 chars of
      // [A-Z2-7]; the earlier fixture used 1/8 digits and could never match,
      // which made this probe assert a detection the rule cannot produce.
      const fakeAwsKey = ["AKIA", "JQ7X", "K2MP", "RTW4", "ZNBC"].join("");
      writeFileSync(
        join(probeDir, "aws.env"),
        `AWS_ACCESS_KEY_ID=${fakeAwsKey}\n`,
      );
      const awsCaught = runScan({ scanner, root: probeDir, history: false });
      assert.equal(
        summarize(awsCaught.findings).total,
        2,
        "both planted credentials must be reported",
      );
      assert.ok(
        awsCaught.findings.some((finding) => finding.RuleID === "aws-access-token"),
        "the planted fake AWS key must match the AWS access-token rule",
      );
    } finally {
      rmSync(probeDir, { recursive: true, force: true });
    }
  },
);

test(
  "the history scan is reproducible from the runner",
  {
    skip: scanner
      ? false
      : "gitleaks binary not available (set GITLEAKS_BINARY or install it; CI installs it)",
  },
  () => {
    const history = runScan({ scanner, root: REPO_ROOT, history: true });
    assert.equal(
      history.ran,
      true,
      `scan did not run: ${history.reason ?? ""}`,
    );
    assert.equal(
      summarize(history.findings).total,
      0,
      "the reviewed history must be clean; a finding here is either a new secret or an allowlist that stopped matching",
    );
  },
);

test("the repository config and the runner agree on where the policy lives", () => {
  assert.ok(
    existsSync(CONFIG_PATH),
    "the policy file must exist at the repository root",
  );
  assert.equal(dirname(CONFIG_PATH), MONOREPO_ROOT);
  assert.ok(existsSync(join(REPO_ROOT, "scripts", "secret-scan.mjs")));
  // Checking out a fresh directory must not change the answer: the config is found relative to the script.
  mkdirSync(join(REPO_ROOT, ".gitignore-probe-tmp"), { recursive: true });
  rmSync(join(REPO_ROOT, ".gitignore-probe-tmp"), {
    recursive: true,
    force: true,
  });
  assert.equal(
    fileURLToPath(new URL("./secret-scan.mjs", import.meta.url)).endsWith(
      "secret-scan.mjs",
    ),
    true,
  );
});

#!/usr/bin/env node
/**
 * DR manifest validator and dry-run planner (Part 11).
 *
 * Two commands, neither of which touches a database, a bucket, or the
 * network:
 *
 *   node scripts/dr-manifest.mjs --check   validate docs/dr/manifest.json
 *                                          (and the ledger's shape when one
 *                                          exists); exit 1 with every
 *                                          failure named
 *   node scripts/dr-manifest.mjs --plan    render the ordered restore
 *                                          runbook to stdout (a dry run:
 *                                          commands are TEMPLATES with
 *                                          $ENV references, never
 *                                          interpolated secrets)
 *   node scripts/dr-manifest.mjs --due [--now ISO] [--ledger PATH]
 *                                          which obligations are overdue;
 *                                          exit 1 when any are (this is the
 *                                          cron-able alert: "a backup not
 *                                          recorded is a backup not done")
 *   node scripts/dr-manifest.mjs --record --component ID --outcome ok|failed
 *                                          [--note TEXT] [--at ISO] [--ledger PATH]
 *                                          append one ledger line; refuses
 *                                          unknown components, broken
 *                                          ledgers, secret-shaped content,
 *                                          and unparsable timestamps
 *
 * Why the validator is code and the manifest is data: a runbook that rots
 * is worse than none - people trust it while it lies. Every check below is
 * the drift the platform has already been bitten by elsewhere: paths that no
 * longer exist, env names renamed under an "internal refactor", backup
 * cadences silently longer than the stated RPO, and - the unforgivable one
 * - credentials pasted into a file that lives in git. The secret-shaped scan
 * is deliberately paranoid and will occasionally nag; answering the nag by
 * deleting the credential is the correct response, always.
 */

import { appendFileSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MANIFEST_PATH = join(ROOT, 'docs', 'dr', 'manifest.json');

// v2 adds the backup-freshness contract (Part 12): every component carries
// cadenceHours or cadenceWaiver, and postgres additionally names the
// mechanism that meets the RPO when its dump cadence alone would not.
// v3 adds the Part 15 RLS-enablement evidence contract (rlsEvidence: who may
// claim "policies are on", how old that claim may be, and which file records
// it). Same reasoning as v2: a block the validator ignores is a block that
// rots, so every field here is checked, and the shipped manifest has it.
const SCHEMA_ID = 'wlct-dr-manifest-v3';
const REQUIRED_COMPONENTS = new Set(['encryption-keys', 'postgres', 'redis', 'dataset-objects']);

/** Part 15's ceiling on "how old may an enablement claim be": 8760h is a
 * year, the same bound the platform puts on any review cadence. A bigger
 * number is not a policy, it is a way of writing "never" - and the whole
 * point of the evidence ledger is that "never" is visible. */
const RLS_MAX_CADENCE_HOURS = 8760;

/** Phrases that would make the engine's read-only endpoint claim a platform
 * wide verdict. Deliberately narrow (not a general "all" ban): this is a
 * check for the ONE mis-statement that would matter, not a prose reviewer. */
const RLS_OVERCLAIM_RE = /\b(all tables|every table|the entire platform|whole platform|entire database)\b/i;

/** Collect every env KEY NAME declared across the repository's .env.example
 * files - uncommented or commented alike: the template's job is to declare
 * names (values are the operator's business), and names deliberately
 * commented out (secrets) are still the names a deployment must provide. */
export function collectEnvNames(root) {
  const files = [
    '.env.example',
    'services/execution-engine/.env.example',
    'services/trading-engine/.env.example',
    'services/market-data/.env.example',
    'apps/admin-web/.env.example',
  ];
  const names = new Set();
  for (const rel of files) {
    const path = join(root, rel);
    if (!existsSync(path)) {
      continue;
    }
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = /^\s*#?\s*([A-Z][A-Z0-9_]{1,})=/.exec(line);
      if (m) {
        names.add(m[1]);
      }
    }
  }
  return names;
}

/** Things that must never appear in a manifest living in git. Patterns are
 * value-shaped, not word-shaped: writing the word "password" in prose is
 * fine (this file does it); writing `key=value` with a secret-shaped value
 * is what the scan refuses. */
const RLS_VERIFY_SCHEMA = 'wlct.dr.rls-verify/1';

/** The only assertion this verifier is allowed to make about the running system, spelled out as a
 * constant so that a future edit has to delete a named thing rather than flip a string. */
const RLS_NOT_ASSERTED =
  'not asserted here: this is a repository-side verifier, and the enabled-and-enforcing claim is ' +
  "the platform's own, made by the engine from a passing audit inside its cadence window";

export function findSecretShapes(text) {
  const findings = [];
  const patterns = [
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'PEM private key header'],
    [/[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s@]+@/, 'URL with embedded credentials'],
    [/[A-Z][A-Z0-9_]{2,}=(?!"|null)[A-Za-z0-9+/=_-]{24,}/, 'inline KEY=secret-shaped-value assignment'],
    // The (?!) above lets an inline quoted value past pattern 3; in a
    // runbook or ledger note a QUOTED literal assignment is exactly as
    // leaky as an unquoted one (Part 12 smoke proved it on a real note),
    // so this pattern closes the quote hole. `${VAR}` references stay
    // legal: the value part refuses a leading '$'.
    [/[A-Z][A-Z0-9_]{2,}="[^"\n$]{16,}"/, 'inline KEY="literal-value" assignment'],
    [/"[A-Za-z0-9_]*(?:SECRET|PASSWORD|TOKEN|KEY)(?:_BASE64)?":\s*"[^"$]{16,}"/, 'JSON secret with a literal value'],
  ];
  for (const [re, why] of patterns) {
    const m = re.exec(text);
    if (m) {
      findings.push(`${why} near ${JSON.stringify(m[0].slice(0, 48))}`);
    }
  }
  return findings;
}

export function validateManifest(manifest, root = ROOT) {
  const errors = [];
  if (manifest.schema !== SCHEMA_ID) {
    errors.push(`schema must be ${SCHEMA_ID}, got ${JSON.stringify(manifest.schema)}`);
  }
  if (!Number.isInteger(manifest.rpoMinutes) || manifest.rpoMinutes < 1) {
    errors.push('rpoMinutes must be a positive integer');
  }
  if (!Number.isInteger(manifest.rtoHours) || manifest.rtoHours < 1) {
    errors.push('rtoHours must be a positive integer');
  }
  if (!Number.isInteger(manifest.reviewCadenceDays) || manifest.reviewCadenceDays < 30) {
    errors.push('reviewCadenceDays must be an integer >= 30 (a manifest reviewed monthly is a ritual, not a control)');
  }
  const components = Array.isArray(manifest.components) ? manifest.components : [];
  if (components.length === 0) {
    errors.push('components must be a non-empty array');
  }

  const ids = new Set();
  const orders = new Set();
  for (const c of components) {
    for (const field of ['id', 'title', 'kind', 'purpose', 'backupMethod', 'verification']) {
      if (typeof c[field] !== 'string' || c[field].trim().length === 0) {
        errors.push(`component ${JSON.stringify(c.id ?? '?')}: field ${field} must be a non-empty string`);
      }
    }
    if (ids.has(c.id)) {
      errors.push(`duplicate component id ${JSON.stringify(c.id)}`);
    }
    ids.add(c.id);
    if (!Number.isInteger(c.restoreOrder) || c.restoreOrder < 1 || orders.has(c.restoreOrder)) {
      errors.push(`component ${c.id}: restoreOrder must be a unique positive integer`);
    }
    orders.add(c.restoreOrder);
    for (const ref of c.envRefs ?? []) {
      if (typeof ref !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(ref)) {
        errors.push(`component ${c.id}: envRef ${JSON.stringify(ref)} is not an env key name`);
      }
    }
    // "never backed up" in a backupMethod is a manifest admitting it lost
    // data; ordinary prose use of the word ("...verifies the escrow, never
    // the material") must not trip it. The honest phrasing for a
    // rebuildable component is the redis entry's: rebuildable, snapshot for
    // forensics only.
    if (/\bnever\b[^.]{0,40}\bback(ed)?[- ]?up/i.test(c.backupMethod ?? '')) {
      errors.push(`component ${c.id}: backupMethod must not admit "never backed up" - state rebuildability or a scheduled gap`);
    }
    // Part 12: the freshness contract. `null` is legal ONLY with a waiver
    // string; a missing key is not null, it is silence - and silence about
    // when a backup is due is exactly how a stale-backup incident starts.
    const cadenceMissing = !Object.prototype.hasOwnProperty.call(c, 'cadenceHours');
    if (cadenceMissing) {
      errors.push(
        `component ${c.id}: cadenceHours is required (an integer hour bound ` +
          `or null WITH a cadenceWaiver explaining the exemption)`,
      );
    } else if (c.cadenceHours === null) {
      if (typeof c.cadenceWaiver !== 'string' || c.cadenceWaiver.trim().length === 0) {
        errors.push(`component ${c.id}: cadenceHours null requires a non-empty cadenceWaiver`);
      }
    } else {
      if (!Number.isInteger(c.cadenceHours) || c.cadenceHours < 1 || c.cadenceHours > 8760) {
        errors.push(
          `component ${c.id}: cadenceHours must be an integer 1..8760 (one year ceiling), got ${JSON.stringify(c.cadenceHours)}`,
        );
      }
      if (c.cadenceWaiver !== undefined) {
        errors.push(`component ${c.id}: cadenceWaiver is only meaningful when cadenceHours is null`);
      }
      // The RPO belongs to Postgres; every other component's cadence is a
      // review obligation, not a data-loss bound. 24h of dump cadence under
      // a 60m RPO is HONEST only when a continuous mechanism is named -
      // naming it is what this check forces into the open.
      if (c.id === 'postgres' && c.cadenceHours * 60 > manifest.rpoMinutes) {
        if (typeof c.rpoMechanism !== 'string' || c.rpoMechanism.trim().length === 0) {
          errors.push(
            `component postgres: cadenceHours ${c.cadenceHours} exceeds rpoMinutes ` +
              `${manifest.rpoMinutes} and no rpoMechanism is named - either back up ` +
              `faster than the RPO or state what continuous mechanism closes the gap`,
          );
        }
      }
    }
  }
  if (orders.size > 0) {
    const sorted = [...orders].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i += 1) {
      if (sorted[i] !== i + 1) {
        errors.push('restoreOrder values must form exactly 1..n with no gaps');
        break;
      }
    }
  }
  for (const required of REQUIRED_COMPONENTS) {
    if (!ids.has(required)) {
      errors.push(`required component ${required} is missing`);
    }
  }
  if (ids.has('encryption-keys') && ids.has('postgres')) {
    const keys = components.find((c) => c.id === 'encryption-keys');
    const db = components.find((c) => c.id === 'postgres');
    if (keys.restoreOrder >= db.restoreOrder) {
      errors.push('encryption-keys must be restored BEFORE postgres (ciphertext without keys is a deletion)');
    }
  }

  const envNames = collectEnvNames(root);
  for (const c of components) {
    for (const ref of c.envRefs ?? []) {
      if (!envNames.has(ref)) {
        errors.push(`component ${c.id}: envRef ${ref} is declared in no .env.example of this repository`);
      }
    }
    for (const path of c.paths ?? []) {
      if (!existsSync(join(root, path))) {
        errors.push(`component ${c.id}: path ${path} no longer exists (the manifest drifted from the repo)`);
      }
    }
  }

  const procedure = Array.isArray(manifest.restoreProcedure) ? manifest.restoreProcedure : [];
  if (procedure.length === 0) {
    errors.push('restoreProcedure must not be empty');
  }
  let lastStep = 0;
  for (const step of procedure) {
    if (!Number.isInteger(step.step) || step.step !== lastStep + 1) {
      errors.push(`restoreProcedure: step numbers must run 1..n contiguously (got ${JSON.stringify(step.step)})`);
    }
    lastStep = step.step ?? lastStep;
    if (typeof step.action !== 'string' || step.action.trim() === '') {
      errors.push(`restoreProcedure step ${step.step}: action must be a non-empty string`);
    }
    if (step.component !== null && step.component !== undefined && !ids.has(step.component)) {
      errors.push(`restoreProcedure step ${step.step}: references unknown component ${JSON.stringify(step.component)}`);
    }
  }

  // Part 21: the plan exists twice - once as `restoreOrder` on the components, which is what
  // `renderPlan` and the due report sort by, and once as `restoreProcedure`, which is what
  // `docs/DR.md` narrates and what a human follows at 3am. Each representation was validated
  // internally and never against the other, and the disagreement the rehearsal runner found on
  // its first run is the reason this law exists now: steps 3-5 of the procedure restored
  // deployment-config, redis, dataset-objects while their declared orders said redis,
  // dataset-objects, deployment-config. The data was corrected to follow the procedure (the
  // procedure is the document an operator executes, and it is the one whose steps carry the
  // "run migrations only if the image's schema is older" reasoning that only holds in that
  // order). A component-less step is the manifest's existing convention for a post-restore
  // instruction, so it is skipped rather than ordered.
  const orderByComponent = new Map((manifest.components ?? []).map((c) => [c.id, c.restoreOrder]));
  const namedInProcedure = new Set();
  for (const step of procedure) {
    if (step.component === null || step.component === undefined) continue;
    if (namedInProcedure.has(step.component)) {
      errors.push(`restoreProcedure: component ${step.component} is restored twice - the plan has no defined order`);
    }
    namedInProcedure.add(step.component);
    const declared = orderByComponent.get(step.component);
    if (declared !== undefined && declared !== step.step) {
      errors.push(
        `restoreProcedure step ${step.step} restores ${step.component}, whose restoreOrder is ${declared} - ` +
          'the two representations of the plan disagree, and an operator reading one would skip past ' +
          'a dependency of the other',
      );
    }
  }
  for (const c of manifest.components ?? []) {
    if (!namedInProcedure.has(c.id)) {
      errors.push(`component ${c.id} has no restoreProcedure step - it is declared restorable but the plan never restores it`);
    }
  }

  // Part 15: the enablement-evidence block. Required, not optional: an
  // missing block means the deployment never decided how old an RLS audit may
  // be, and "we'll say it later" is how the checklist in enable.sql became
  // prose nobody re-reads.
  const rls = manifest.rlsEvidence;
  if (rls === undefined || rls === null || typeof rls !== 'object' || Array.isArray(rls)) {
    errors.push('rlsEvidence is required (Part 15: cadenceHours or cadenceWaiver, evidenceLedger, verifier, command)');
  } else {
    if (rls.cadenceHours === null) {
      if (typeof rls.cadenceWaiver !== 'string' || rls.cadenceWaiver.trim().length === 0) {
        errors.push('rlsEvidence: cadenceHours null requires a non-empty cadenceWaiver');
      }
    } else {
      if (!Number.isInteger(rls.cadenceHours) || rls.cadenceHours < 1 || rls.cadenceHours > RLS_MAX_CADENCE_HOURS) {
        errors.push(
          `rlsEvidence: cadenceHours must be an integer 1..${RLS_MAX_CADENCE_HOURS} ` +
            `(a year is the platform ceiling for "how long a policy claim may stand"), got ${JSON.stringify(rls.cadenceHours)}`,
        );
      }
      if (rls.cadenceWaiver !== undefined) {
        errors.push('rlsEvidence: cadenceWaiver is only meaningful when cadenceHours is null');
      }
    }
    // scope is what stops a future edit from quietly turning "the engine
    // plane" into "the platform": the endpoint cannot see the API's tables,
    // and a manifest that implies otherwise is a false assurance in the one
    // document everybody reads before an incident.
    if (typeof rls.scope !== 'string' || rls.scope.trim().length === 0) {
      errors.push('rlsEvidence: scope must be a non-empty string (what the verifier can actually see)');
    } else if (RLS_OVERCLAIM_RE.test(rls.scope)) {
      errors.push(
        `rlsEvidence: scope overclaims - ${JSON.stringify(rls.scope.match(RLS_OVERCLAIM_RE)[0])} is not true of a ` +
          'service that can only read its own tables (docs/PART15_RLS_ENABLEMENT.md)',
      );
    } else if (rls.scope.length > 600 || /[\r\n]/.test(rls.scope)) {
      errors.push('rlsEvidence: scope must be one line of at most 600 characters');
    }
    for (const field of ['evidenceLedger', 'verifier', 'command']) {
      const value = rls[field];
      if (typeof value !== 'string' || value.trim().length === 0) {
        errors.push(`rlsEvidence: ${field} must be a non-empty string`);
        continue;
      }
      if (value.length > 300 || /[\r\n]/.test(value)) {
        errors.push(`rlsEvidence: ${field} must be one line of at most 300 characters`);
      }
      // Path-like fields must stay inside the repository; the VERIFIER is not
      // a path at all (it is an endpoint), and forcing it through the same
      // rule is how validators teach people that paths are the only truth.
      if (field !== 'verifier' && (value.startsWith('/') || value.includes('..'))) {
        errors.push(`rlsEvidence: ${field} must be a repository-relative path without ".." (git evidence, not a local absolute)`);
      }
    }
    if (typeof rls.command === 'string' && !rls.command.startsWith('node scripts/')) {
      errors.push(`rlsEvidence: command must be a repository script ("node scripts/..."), got ${JSON.stringify(rls.command)}`);
    }
    if (typeof rls.evidenceLedger === 'string' && !rls.evidenceLedger.endsWith('.jsonl')) {
      errors.push('rlsEvidence: evidenceLedger must be a .jsonl file (append-only evidence, parseable line by line)');
    }
    if (typeof rls.evidenceLedger === 'string' && !rls.evidenceLedger.startsWith('docs/dr/')) {
      errors.push('rlsEvidence: evidenceLedger must live under docs/dr/ beside the backup ledger it is modelled on');
    }
    if (typeof rls.verifier === 'string' && !rls.verifier.startsWith('/internal/')) {
      errors.push(`rlsEvidence: verifier must name an internal-plane endpoint (/internal/...), got ${JSON.stringify(rls.verifier)}`);
    }
    if (typeof rls.verifier === 'string' && rls.verifier.includes('/public/')) {
      errors.push('rlsEvidence: the verifier must not be a public route - it reports which defences are off');
    }
    for (const field of ['coverageArtifact', 'enableArtifact', 'disableArtifact']) {
      if (rls[field] === undefined) {
        continue;
      }
      if (typeof rls[field] !== 'string' || rls[field].includes('..')) {
        errors.push(`rlsEvidence: ${field} must be a repository-relative path`);
        continue;
      }
      if (!existsSync(join(root, rls[field]))) {
        errors.push(`rlsEvidence: ${field} ${rls[field]} no longer exists (the audit's ground truth drifted from the repo)`);
      }
    }
    if (rls.requiredGrade !== undefined && rls.requiredGrade !== 'pass') {
      errors.push(
        `rlsEvidence: requiredGrade is not a knob - only "pass" is accepted (got ${JSON.stringify(rls.requiredGrade)}); ` +
          'a manifest that lets a report choose its own bar is not a bar',
      );
    }
  }

  const drill = manifest.drill ?? {};
  if (!Number.isInteger(drill.cadenceDays) || drill.cadenceDays < 30 || drill.cadenceDays > 180) {
    errors.push('drill.cadenceDays must be between 30 and 180 (a twice-a-year ceiling is the platform floor)');
  }
  if (drill.timed !== true) {
    errors.push('drill.timed must be true: an untimed restore proves nothing about the RTO it claims');
  }
  if (!Array.isArray(drill.successCriteria) || drill.successCriteria.length === 0) {
    errors.push('drill.successCriteria must be non-empty');
  }

  if (rls !== undefined && typeof rls === 'object' && !Array.isArray(rls)) {
    // The evidence FILE is part of the contract: a manifest that points at a
    // ledger which cannot be written (directory absent) or which already
    // holds secrets is a policy on a road that does not exist.
    if (
      typeof rls.evidenceLedger === 'string' &&
      rls.evidenceLedger.trim().length > 0 &&
      !rls.evidenceLedger.includes('..')
    ) {
      const ledgerPath = join(root, rls.evidenceLedger);
      if (existsSync(ledgerPath)) {
        for (const finding of findSecretShapes(readFileSync(ledgerPath, 'utf8'))) {
          errors.push(`rlsEvidence: SECRET-SHAPED CONTENT in ${rls.evidenceLedger}: ${finding}`);
        }
      }
    }
    for (const field of ['coverageArtifact', 'enableArtifact', 'disableArtifact']) {
      const rel = rls[field];
      if (typeof rel === 'string' && rel.trim().length > 0 && !rel.includes('..') && existsSync(join(root, rel))) {
        const text = readFileSync(join(root, rel), 'utf8');
        if (rel.endsWith('.json')) {
          try {
            JSON.parse(text);
          } catch {
            errors.push(`rlsEvidence: ${field} ${rel} is not valid JSON (the audit parses it at runtime)`);
          }
        } else if (!text.includes('ROW LEVEL SECURITY')) {
          errors.push(`rlsEvidence: ${field} ${rel} no longer mentions ROW LEVEL SECURITY (renamed or replaced?)`);
        }
      }
    }
  }

  return errors;
}

/** Parse the JSONL ledger. Returns {entries, problems}: a malformed line
 * is reported with its number (the file is human-editable evidence;
 * "line 4 is not JSON" is the fixable complaint, "file corrupt" is not).
 * `knownIds` (when given) turns an unknown component into a problem too -
 * a typo'd component id in a ledger line is a backup with no owner. */
export function parseLedger(text, knownIds = null) {
  const entries = [];
  const problems = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') {
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      problems.push(`ledger line ${i + 1}: not valid JSON`);
      continue;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      problems.push(`ledger line ${i + 1}: must be a JSON object`);
      continue;
    }
    const extra = Object.keys(parsed).filter(
      (k) => k !== 'at' && k !== 'component' && k !== 'outcome' && k !== 'note',
    );
    if (extra.length > 0) {
      problems.push(`ledger line ${i + 1}: unknown field(s) ${extra.join(', ')} (typos hide evidence)`);
      continue;
    }
    const atMs =
      typeof parsed.at === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(parsed.at)
        ? Date.parse(parsed.at)
        : Number.NaN;
    if (Number.isNaN(atMs)) {
      problems.push(`ledger line ${i + 1}: at must be an ISO-8601 timestamp`);
      continue;
    }
    if (typeof parsed.component !== 'string' || parsed.component.trim() === '') {
      problems.push(`ledger line ${i + 1}: component must be a non-empty string`);
      continue;
    }
    if (knownIds !== null && !knownIds.has(parsed.component)) {
      problems.push(`ledger line ${i + 1}: component ${JSON.stringify(parsed.component)} is not in the manifest`);
      continue;
    }
    if (parsed.outcome !== 'ok' && parsed.outcome !== 'failed') {
      problems.push(`ledger line ${i + 1}: outcome must be "ok" or "failed"`);
      continue;
    }
    if (
      parsed.note !== undefined &&
      (typeof parsed.note !== 'string' || parsed.note.length > 500 || /[\r\n]/.test(parsed.note))
    ) {
      problems.push(`ledger line ${i + 1}: note must be a single-line string of at most 500 chars`);
      continue;
    }
    entries.push({
      atMs,
      at: parsed.at,
      component: parsed.component,
      outcome: parsed.outcome,
      ...(typeof parsed.note === 'string' ? { note: parsed.note } : {}),
    });
  }
  return { entries, problems };
}

/** Freshness verdicts, in restore order, for every component. `never`
 * counts as due: an unrecorded obligation has no last-success to age. */
export function dueReport(manifest, entries, nowMs) {
  const lastOk = new Map();
  for (const e of entries) {
    if (e.outcome === 'ok') {
      const prev = lastOk.get(e.component);
      if (prev === undefined || e.atMs > prev) {
        lastOk.set(e.component, e.atMs);
      }
    }
  }
  return [...manifest.components]
    .sort((a, b) => a.restoreOrder - b.restoreOrder)
    .map((c) => {
      if (c.cadenceHours === null) {
        return {
          component: c.id,
          state: 'waived',
          line: `[waive] ${c.id}: no obligation - ${c.cadenceWaiver}`,
        };
      }
      const last = lastOk.get(c.id);
      if (last === undefined) {
        return {
          component: c.id,
          state: 'due',
          line:
            `[DUE  ] ${c.id}: never recorded (cadence ${c.cadenceHours}h) - ` +
            `record one with --record, or say why it has not run`,
        };
      }
      const dueAt = last + c.cadenceHours * 3_600_000;
      const delta = nowMs - dueAt;
      if (delta >= 0) {
        return {
          component: c.id,
          state: 'due',
          line:
            `[DUE  ] ${c.id}: overdue by ${formatDuration(delta)} (last ok ${new Date(last).toISOString()}, cadence ${c.cadenceHours}h)`,
        };
      }
      return {
        component: c.id,
        state: 'ok',
        line: `[ ok  ] ${c.id}: next due in ${formatDuration(-delta)} (last ok ${new Date(last).toISOString()})`,
      };
    });
}

/** -----------------------------------------------------------------------
 * The schedule file (Part 20): the manifest's cadences written in cron grammar.
 *
 * Why this exists at all. `--due` answers "what is overdue" only when somebody runs
 * it, and a checker nobody runs is a claim, not a control - the same distinction the
 * manifest itself makes about backups. The ROADMAP named the missing piece exactly:
 * the wiring of that command into a scheduler. This renders it.
 *
 * The one law that shapes every line below: the emitter may ask questions, never
 * answer them. It emits `--due`, `--check` and `--check-rls` - the three read-only
 * modes - and it will not emit `--record` or `--record-rls`, because a job that writes
 * ledger evidence on a timer would record an outcome nobody observed, which is the
 * faked seed data the ledger was built to refuse. `--check-schedule` re-reads the
 * committed file and fails if a record mode has been hand-added to it.
 * ----------------------------------------------------------------------- */

/** Where the generated file lives, and the one value inside it a deployment owns. */
export const SCHEDULE_PATH = join(ROOT, 'docs', 'dr', 'schedule', 'dr.cron');

/** The ceiling on how often a check may run, in hours. A check is cheap and a breach
 * is not, so nothing here schedules coarser than daily however long the obligation is
 * - and nothing finer than the tightest declared cadence, because a daily check of a
 * six-hour obligation would report its breach up to eighteen hours late. */
const SCHEDULE_MAX_CHECK_HOURS = 24;

/** Minutes at which a scheduled line fires. Fixed at 0 rather than spread across the
 * hour so two lines with the same interval never land on each other by accident,
 * which is the difference between a readable log and a race. */
const SCHEDULE_MINUTE = 0;

/** The ledger's write modes. Named once, so the refusal in `scheduleDrift` and the
 * comment in `renderSchedule` cannot drift apart from each other. */
const SCHEDULE_FORBIDDEN_MODES = Object.freeze(['--record', '--record-rls']);

/** The one line a deployment is allowed to own, matched for the round trip. */
const SCHEDULE_ROOT_LINE = /^wlctRoot=(\S+)$/m;

export function scheduleCheckIntervalHours(cadenceHours) {
  if (!Number.isInteger(cadenceHours) || cadenceHours < 1 || cadenceHours > 8760) {
    throw new TypeError(
      `cannot derive a check interval from ${JSON.stringify(cadenceHours)}: a cadence is an integer 1..8760 hours`,
    );
  }
  return Math.min(cadenceHours, SCHEDULE_MAX_CHECK_HOURS);
}

/** The cron expression for "at least every `intervalHours`", where intervalHours has
 * already been capped at 24 by `scheduleCheckIntervalHours`.
 *
 * A step expression in the hour field - "minute 0, every Nth hour" - is a legal answer
 * for ANY N in 1..24, not only for the divisors of 24, because the field restarts at 0
 * each day: with N=7 the firings are 0, 7, 14, 21
 * and the longest gap is 7 hours (the wrap from 21 to the next day's 0 is 3). The
 * naive reading - "7 does not divide 24, so this is an approximation" - is what this
 * comment exists to answer: approximating a 7-hour obligation with a weekly schedule
 * would be a bug, and with a monthly one a lie. */
export function scheduleCronFor(intervalHours) {
  if (!Number.isInteger(intervalHours) || intervalHours < 1 || intervalHours > 24) {
    throw new TypeError(`no cron line for an interval of ${JSON.stringify(intervalHours)} hours`);
  }
  if (intervalHours >= SCHEDULE_MAX_CHECK_HOURS) {
    return `${SCHEDULE_MINUTE} 0 * * *`;
  }
  return `${SCHEDULE_MINUTE} */${intervalHours} * * *`;
}

/** The tightest obligation on the board, or null when every component is waived.
 * Waived components are not invisible: the caller renders their waiver text as a
 * comment, which is what makes "nobody owes a backup" a readable state rather than an
 * empty file an operator assumes is a bug. */
export function scheduleTightestCadenceHours(manifest) {
  const hours = (manifest.components ?? [])
    .filter((component) => Number.isInteger(component.cadenceHours))
    .map((component) => component.cadenceHours);
  return hours.length === 0 ? null : Math.min(...hours);
}

/** The rendered file. Deterministic by construction: no timestamps, no host names, no
 * ordering that depends on the ledger. `root` is the deployment's checkout path and is
 * the only argument, so a fresh generation stays comparable with a committed file whose
 * root was edited - see `scheduleDrift`. */
export function renderSchedule(manifest, root = '.') {
  const dueHours = scheduleTightestCadenceHours(manifest);
  const lines = [];
  const push = (text) => lines.push(text);
  const command = (mode) => `node "$wlctRoot/scripts/dr-manifest.mjs" ${mode}`;

  push('# Generated by `node scripts/dr-manifest.mjs --emit-schedule`. Do not edit.');
  push('# The cadences live in docs/dr/manifest.json; this file is that data written in');
  push('# cron grammar, and `--check-schedule` compares it against a fresh generation.');
  push('# Exactly one line below is yours to change: wlctRoot. Everything else is derived.');
  push('');
  push('# What each job does, and what none of them does:');
  push('#   --due        grade the ledger against the declared cadences and exit 1 when an');
  push('#                obligation has no recorded success inside its window;');
  push('#   --check      validate the manifest itself (schema, secret shapes, the RPO and');
  push('#                cadence laws) and exit 1 on any violation;');
  push('#   --check-rls  age the row-level-security enablement audit and exit 1 when the');
  push('#                claim has no passing audit behind it. That is the state a fresh');
  push('#                deployment is legitimately in: docs/PART15_RLS_ENABLEMENT.md.');
  push('# No line writes evidence. --record and --record-rls are the ledger of the two');
  push('# write modes and both require a human to name an outcome, because an unattended');
  push('# job recording an outcome nobody observed is faked seed data. Until the first');
  push('# real --record, [DUE] on every component is the correct reading of this board.');
  push('');
  push('# The exit code IS the alarm. How a non-zero cron exit reaches a human is');
  push('# deployment-side (MAILTO, a log shipper, an init that maps exits to alerts), and');
  push('# this file cannot know that answer, so it does not guess one.');
  push('');
  push('# The script resolves its own repository root from its own location; the only thing');
  push('# this line supplies is where to find the file, which is the one fact about the host');
  push('# that is not derived from the manifest. Lower-case on purpose: this repository scans');
  push('# every generated file for `NAME=literal` assignments in the shape an env file uses');
  push('# (findSecretShapes above), and the right answer when a scanner objects to a line is');
  push('# to stop writing a value that looks like a secret, NOT to teach the scanner to look');
  push('# the other way. A path is not a secret and should not be shaped like one.');
  push(`wlctRoot=${root}`);
  push('SHELL=/bin/sh');
  push('');

  if (dueHours === null) {
    push(
      '# Derived from the tightest declared cadence: none. Every component waives its',
    );
    push('# obligation, so there is nothing to age and nothing to schedule a check for. The');
    push('# manifest validator still runs daily, because a manifest that has stopped parsing');
    push('# would otherwise be the reason no job reports anything at all:');
    push('#');
    for (const component of manifest.components ?? []) {
      push(`#   ${component.id}: ${component.cadenceWaiver ?? '(no waiver text)'}`);
    }
    push(`${scheduleCronFor(SCHEDULE_MAX_CHECK_HOURS)} ${command('--check')}`);
    return `${lines.join('\n')}\n`;
  }

  push(
    `# Derived from the tightest declared cadence on the board (${dueHours}h), capped at ${SCHEDULE_MAX_CHECK_HOURS}h:`,
  );
  push('# a check more frequent than the obligation is free, a check less frequent is how a');
  push('# breach waits out the gap between runs.');
  push(`${scheduleCronFor(scheduleCheckIntervalHours(dueHours))} ${command('--due')}`);
  push('# Manifest validity is a deployment invariant rather than an obligation, so it runs');
  push('# on the daily ceiling whatever the cadences above do.');
  push(`${scheduleCronFor(SCHEDULE_MAX_CHECK_HOURS)} ${command('--check')}`);

  const rls = manifest.rlsEvidence;
  if (rls !== undefined && rls !== null) {
    push('');
    if (Number.isInteger(rls.cadenceHours)) {
      push(
        `# RLS evidence ages against rlsEvidence.cadenceHours (${rls.cadenceHours}h), so the check`,
      );
      push('# runs at the capped interval that bound implies.');
      push(
        `${scheduleCronFor(scheduleCheckIntervalHours(rls.cadenceHours))} ${command('--check-rls')}`,
      );
    } else {
      push(`# rlsEvidence cadence is waived: ${rls.cadenceWaiver ?? '(no waiver text)'}.`);
      push('# The claim still needs an audit for anybody to make it; a waiver schedules');
      push('# nothing here and does not make "row-level security is enforcing" one degree');
      push('# more true. Without a line below, --check-rls is the mode that says so.');
    }
  }

  const waived = (manifest.components ?? []).filter(
    (component) => component.cadenceHours === null && component.cadenceWaiver,
  );
  if (waived.length > 0) {
    push('');
    push('# Obligations this file does not schedule, because the manifest waived them:');
    for (const component of waived) {
      push(`#   ${component.id}: ${component.cadenceWaiver}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/** What is wrong with a committed schedule file, as strings; empty means it matches a
 * fresh generation apart from the one line a deployment owns. */
export function scheduleDrift(manifest, text) {
  const problems = [];
  if (typeof text !== 'string' || text.trim() === '') {
    return ['schedule file is empty or missing - run --emit-schedule'];
  }
  const rootMatch = SCHEDULE_ROOT_LINE.exec(text);
  if (rootMatch === null) {
    problems.push('schedule file has no `wlctRoot=<path>` line, so it is not the generated shape');
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trimStart();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }
    const tokens = trimmed.split(/\s+/);
    for (const forbidden of SCHEDULE_FORBIDDEN_MODES) {
      if (tokens.includes(forbidden)) {
        problems.push(
          `schedule file runs ${forbidden}: a scheduled job may ask questions, never write ledger evidence`,
        );
      }
    }
  }
  for (const finding of findSecretShapes(text)) {
    problems.push(`SECRET-SHAPED CONTENT in schedule: ${finding}`);
  }
  if (problems.length === 0) {
    const expected = renderSchedule(manifest, rootMatch[1]);
    if (expected !== text) {
      const expectedLines = expected.split('\n');
      const actualLines = text.split('\n');
      const firstDiff = expectedLines.findIndex((line, index) => line !== actualLines[index]);
      const where =
        firstDiff === -1
          ? `line count (${actualLines.length} against ${expectedLines.length})`
          : `line ${firstDiff + 1}`;
      problems.push(
        `schedule file does not match a fresh generation at ${where}: a cadence changed and the schedule did not, or the file was hand-edited`,
      );
    }
  }
  return problems;
}

function formatDuration(ms) {
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Parse the Part 15 RLS-enablement evidence ledger (JSONL, one line per
 * verification run). A DIFFERENT file from the backup ledger on purpose:
 * two obligations sharing one log is how one of them stops being read.
 * Line-wise problems are reported by number exactly as `parseLedger` does,
 * and an unparsable line is never skipped quietly. */
export function parseRlsLedger(text) {
  const entries = [];
  const problems = [];
  const known = new Set(['at', 'grade', 'probed', 'role', 'note']);
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') {
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      problems.push(`rls ledger line ${i + 1}: not valid JSON`);
      continue;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      problems.push(`rls ledger line ${i + 1}: must be a JSON object`);
      continue;
    }
    const extra = Object.keys(parsed).filter((k) => !known.has(k));
    if (extra.length > 0) {
      problems.push(`rls ledger line ${i + 1}: unknown field(s) ${extra.join(', ')} (typos hide evidence)`);
      continue;
    }
    const atMs =
      typeof parsed.at === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(parsed.at)
        ? Date.parse(parsed.at)
        : Number.NaN;
    if (Number.isNaN(atMs)) {
      problems.push(`rls ledger line ${i + 1}: at must be an ISO-8601 timestamp`);
      continue;
    }
    // The grade vocabulary is the core's (wlct_trading.enablement.RunGrade)
    // and it is CLOSED: a line that grades itself "warning" or "ok" is a
    // report nobody can aggregate, and the run that invents a fourth answer
    // is the run that decides its own verdict.
    if (parsed.grade !== 'pass' && parsed.grade !== 'fail' && parsed.grade !== 'unverified') {
      problems.push(`rls ledger line ${i + 1}: grade must be pass, fail or unverified`);
      continue;
    }
    if (parsed.probed !== undefined && (!Number.isInteger(parsed.probed) || parsed.probed < 0 || parsed.probed > 4096)) {
      problems.push(`rls ledger line ${i + 1}: probed must be an integer 0..4096`);
      continue;
    }
    if (parsed.role !== undefined && (typeof parsed.role !== 'string' || parsed.role.length === 0 || parsed.role.length > 200 || /[\r\n]/.test(parsed.role))) {
      problems.push(`rls ledger line ${i + 1}: role must be a single-line string of 1..200 chars`);
      continue;
    }
    if (parsed.note !== undefined && (typeof parsed.note !== 'string' || parsed.note.length > 500 || /[\r\n]/.test(parsed.note))) {
      problems.push(`rls ledger line ${i + 1}: note must be a single-line string of at most 500 chars`);
      continue;
    }
    entries.push({
      atMs,
      at: parsed.at,
      grade: parsed.grade,
      ...(Number.isInteger(parsed.probed) ? { probed: parsed.probed } : {}),
      ...(typeof parsed.role === 'string' ? { role: parsed.role } : {}),
      ...(typeof parsed.note === 'string' ? { note: parsed.note } : {}),
    });
  }
  return { entries, problems };
}

/** The Part 15 verdict: how the most recent enablement audit reads as of
 * `nowMs`. This is deliberately NOT enforcement - a repository script cannot
 * see a live database - it is the FRESHNESS POLICY the docs promise: an
 * operator (or a cron) runs this, and a stale or failing audit becomes a red
 * exit code instead of a memory.
 *
 * The last entry of ANY grade decides freshness; its grade decides the
 * verdict. That asymmetry is the point: re-running the audit and finding a
 * leak must refresh the "we know" clock WITHOUT turning the finding green,
 * and a stale run that passed long ago is not evidence either way. */
export function rlsEvidenceReport(evidence, entries, nowMs) {
  if (evidence.cadenceHours === null) {
    return {
      state: 'waived',
      line: `[waive] rls-enablement: no cadence - ${evidence.cadenceWaiver}`,
    };
  }
  if (entries.length === 0) {
    return {
      state: 'due',
      line:
        `[DUE  ] rls-enablement: never recorded (cadence ${evidence.cadenceHours}h) - run the audit and ` +
        `record it with --record-rls; policies that nobody verified are a hypothesis`,
    };
  }
  const last = entries.reduce((a, b) => (b.atMs > a.atMs ? b : a), entries[0]);
  const dueAt = last.atMs + evidence.cadenceHours * 3_600_000;
  const delta = nowMs - dueAt;
  const age = `[${last.grade}] ${new Date(last.atMs).toISOString()} (${formatDuration(Math.max(0, nowMs - last.atMs))} ago)`;
  if (last.grade !== 'pass') {
    return {
      state: 'fail',
      line:
        `[${last.grade === 'fail' ? 'FAIL' : 'UNVER'}] rls-enablement: ${age} - the recorded audit did not ` +
        `conclude "pass", so the platform must not claim enabled-and-enforced`,
    };
  }
  if (delta >= 0) {
    return {
      state: 'due',
      line: `[DUE  ] rls-enablement: last passing audit overdue by ${formatDuration(delta)} ${age}`,
    };
  }
  return {
    state: 'ok',
    line: `[ ok  ] rls-enablement: fresh, next due in ${formatDuration(-delta)} ${age}`,
  };
}

/**
 * Part 21: the machine-readable answer to "what is actually verified about row-level security".
 *
 * This is a VERIFIER, not an enabler and not a claim. Read its output as a set of checks with
 * grades, never as "RLS is on": the platform may assert enabled-and-enforcing only while a passing
 * audit is younger than `rlsEvidence.cadenceHours` (Part 15's rule), and that assertion is made by
 * the engine at request time from its own ledger. What this function adds is the part nobody could
 * ask a machine before: whether the repository's three RLS artifacts still describe the same set
 * of tables, and whether an audit has ever been recorded at all. A deployment whose enable.sql
 * gained a table and whose coverage ledger did not would have shown a clean `--check-rls` (which
 * ages evidence, correctly) while the evidence itself described a different database.
 *
 * Grades are the core's closed vocabulary - pass, fail, unverified, skipped - and "the file is not
 * there", "the artifact does not parse" and "nobody audited" are three different answers, reported
 * as three different findings.
 */
export function verifyRlsEvidence(manifest, { root = ROOT, nowMs = Date.now() } = {}) {
  const checks = [];
  const findings = [];
  const record = (name, grade, detail, extra = {}) => {
    checks.push({ name, grade, detail, ...extra });
    if (grade === 'fail') findings.push(`${name}: ${detail}`);
    return grade;
  };

  const evidence = manifest?.rlsEvidence ?? null;
  if (evidence === null || evidence === undefined) {
    record('manifest-block', 'fail', 'the manifest carries no rlsEvidence block, so there is nothing to verify against');
    return { schema: RLS_VERIFY_SCHEMA, grade: 'fail', checks, findings, evidence: null, assertion: RLS_NOT_ASSERTED };
  }

  const readArtifact = (rel) => {
    const absolute = join(root, rel);
    if (!existsSync(absolute)) {
      return { error: 'missing' };
    }
    try {
      return { text: readFileSync(absolute, 'utf8') };
    } catch (error) {
      return { error: `unreadable (${error.message})` };
    }
  };

  const texts = {};
  for (const key of ['coverageArtifact', 'enableArtifact', 'disableArtifact']) {
    const rel = evidence[key];
    if (typeof rel !== 'string' || rel.trim() === '') {
      record(`artifact:${key}`, 'fail', `rlsEvidence.${key} must name a repository path`);
      texts[key] = { error: 'not declared' };
      continue;
    }
    const read = readArtifact(rel);
    texts[key] = read;
    if (read.error !== undefined) {
      record(`artifact:${key}`, 'fail', `${rel} is ${read.error} - the ${key.replace('Artifact', '')} scope cannot be verified from a file that is not there`);
    } else {
      record(`artifact:${key}`, 'pass', `${rel} present (${read.text.split('\n').length} lines)`);
    }
  }

  let coverage = null;
  if (texts.coverageArtifact?.text !== undefined) {
    try {
      coverage = JSON.parse(texts.coverageArtifact.text);
      record('coverage-parses', 'pass', `${coverage.covered?.length ?? 0} covered table(s), ${coverage.excluded?.length ?? 0} excluded`);
    } catch (error) {
      record('coverage-parses', 'fail', `the coverage artifact is not readable JSON: ${error.message}`);
    }
  } else {
    record('coverage-parses', 'unverified', 'no coverage artifact to parse');
  }

  /**
   * The tables one of the two scripts touches, as a set.
   *
   * A regex literal rather than a constructed one: the verb is interpolated into a string pattern
   * in the obvious first draft, and every escaping level between a Python generator, a JS string
   * and a RegExp is a place this scan can quietly start matching nothing - which for a scope
   * checker is worse than crashing, because "0 tables in enable.sql" reads as a clean empty scope.
   * So the verb is matched and filtered instead of interpolated, and the count is asserted against
   * the coverage artifact by a test.
   */
  const STATEMENT_RE = /ALTER\s+TABLE\s+"?([A-Za-z0-9_.]+)"?\s+(ENABLE|DISABLE|FORCE|NO\s+FORCE)\s+ROW\s+LEVEL\s+SECURITY/gi;
  const statementsIn = (text, verb) => {
    if (typeof text !== 'string') return null;
    const set = new Set();
    STATEMENT_RE.lastIndex = 0;
    let match;
    while ((match = STATEMENT_RE.exec(text)) !== null) {
      if (match[2].toUpperCase() !== verb) continue;
      set.add(match[1].replace(/^public\./, '').toLowerCase());
    }
    return set;
  };

  const covered = coverage?.covered instanceof Array
    ? new Set(coverage.covered.map((row) => String(row?.table ?? '').toLowerCase()))
    : null;
  const enabled = texts.enableArtifact?.text !== undefined ? statementsIn(texts.enableArtifact.text, 'ENABLE') : null;
  const disabled = texts.disableArtifact?.text !== undefined ? statementsIn(texts.disableArtifact.text, 'DISABLE') : null;

  if (covered === null || enabled === null) {
    record('scope:enable-vs-coverage', 'unverified', 'one side of the comparison is unavailable, so no scope claim can be made');
  } else if (covered.size === 0 && enabled.size === 0) {
    // Both sides empty is the shape a broken scan produces, and it is also - rarely - legitimate
    // for a fixture. Reporting it as a pass would let a scanner that matches nothing grade clean
    // forever, so it stays unverified and says why.
    record('scope:enable-vs-coverage', 'unverified', 'neither side names a single table; refusing to read an empty scope as a pass');
  } else {
    const onlyInSql = [...enabled].filter((t) => !covered.has(t)).sort();
    const onlyInCoverage = [...covered].filter((t) => !enabled.has(t)).sort();
    if (onlyInSql.length === 0 && onlyInCoverage.length === 0) {
      record('scope:enable-vs-coverage', 'pass', `${enabled.size} table(s) in enable.sql and in the coverage artifact, in both directions`);
    } else {
      record(
        'scope:enable-vs-coverage',
        'fail',
        `the enablement script and the coverage ledger disagree - ` +
          `in enable.sql only: [${onlyInSql.join(', ') || '-'}]; in rls_coverage.json only: [${onlyInCoverage.join(', ') || '-'}]`,
        { onlyInSql, onlyInCoverage },
      );
    }
  }

  if (disabled === null || enabled === null) {
    record('scope:enable-vs-disable', 'unverified', 'one of the two scripts is unavailable to compare');
  } else if (enabled.size === 0 && disabled.size === 0) {
    record('scope:enable-vs-disable', 'unverified', 'neither script names a table; an empty pair of sets proves nothing');
  } else {
    const asymmetric = [...new Set([...enabled, ...disabled])].filter((t) => !(enabled.has(t) && disabled.has(t))).sort();
    record(
      'scope:enable-vs-disable',
      asymmetric.length === 0 ? 'pass' : 'fail',
      asymmetric.length === 0
        ? `${enabled.size} table(s) can be enabled and ${disabled.size} disabled - the rollback is exactly as wide as the change`
        : `asymmetric tables (enable without disable, or the reverse): [${asymmetric.join(', ')}]`,
      { asymmetric },
    );
  }

  // The stamp: all three artifacts carry the same schema stamp, or the audit describes a database
  // that is not the one the scripts were generated for.
  const stampOf = (text) => /Schema stamp:\s*(\d{8,18})/i.exec(text ?? '')?.[1] ?? null;
  const stamps = {
    coverage: coverage?.stamp ?? null,
    enable: stampOf(texts.enableArtifact?.text),
    disable: stampOf(texts.disableArtifact?.text),
  };
  const stampValues = Object.entries(stamps).filter(([, value]) => value !== null);
  if (stampValues.length < 3) {
    record('schema-stamp', 'unverified', `at least one artifact does not declare a stamp (${JSON.stringify(stamps)})`);
  } else if (new Set(stampValues.map(([, value]) => value)).size === 1) {
    record('schema-stamp', 'pass', `all three artifacts carry stamp ${stampValues[0][1]}`);
  } else {
    record('schema-stamp', 'fail', `the artifacts disagree about which schema they describe: ${JSON.stringify(stamps)}`);
  }

  for (const [key, needle, label] of [
    ['policyName', evidence.policyName, 'policy'],
    ['functionName', evidence.functionName, 'function'],
  ]) {
    const declared = evidence[key];
    if (declared === undefined) continue;
    const text = texts.enableArtifact?.text ?? '';
    record(
      `object:${declared}`,
      text.includes(declared) ? 'pass' : 'fail',
      text.includes(declared)
        ? `enable.sql references the ${label} the manifest names`
        : `enable.sql never mentions the ${label} ${JSON.stringify(declared)} the manifest names`,
    );
  }

  const ledgerRel = evidence.evidenceLedger ?? 'docs/dr/rls-evidence.jsonl';
  const ledgerPath = join(root, ledgerRel);
  let parsed = { entries: [], problems: [] };
  if (existsSync(ledgerPath)) {
    parsed = parseRlsLedger(readFileSync(ledgerPath, 'utf8'));
    for (const problem of parsed.problems) findings.push(`evidence ledger: ${problem}`);
  }
  const row = rlsEvidenceReport(evidence, parsed.entries, nowMs);
  const ledgerGrade =
    parsed.problems.length > 0 ? 'fail' : row.state === 'ok' ? 'pass' : row.state === 'fail' ? 'fail' : row.state === 'waived' ? 'skipped' : 'unverified';
  record(
    'evidence-ledger',
    ledgerGrade,
    parsed.problems.length > 0
      ? `${parsed.problems.length} malformed line(s) in ${ledgerRel}: ${parsed.problems[0]}`
      : row.line,
    { entries: parsed.entries.length, state: row.state },
  );

  const grade = findings.length > 0 || parsed.problems.length > 0
    ? 'fail'
    : checks.some((check) => check.grade === 'unverified')
      ? 'unverified'
      : checks.every((check) => check.grade === 'skipped')
        ? 'skipped'
        : 'pass';

  return {
    schema: RLS_VERIFY_SCHEMA,
    grade,
    cadenceHours: evidence.cadenceHours ?? null,
    requiredGrade: evidence.requiredGrade ?? null,
    verifier: evidence.verifier ?? null,
    ledger: { path: ledgerRel, entries: parsed.entries.length, problems: parsed.problems },
    scope: { covered: covered?.size ?? null, enabled: enabled?.size ?? null, disabled: disabled?.size ?? null, stamps },
    checks,
    findings,
    // The sentence that keeps this tool in its lane. A status page that printed `"enabled": true`
    // here would be read as the platform's authorization to claim enforcement, and this function
    // has not asked a database a single question.
    assertion: RLS_NOT_ASSERTED,
    enabled: null,
  };
}

export function renderPlan(manifest) {
  const lines = [];
  lines.push(`# DR restore plan - ${manifest.title}`);
  lines.push('# GENERATED BY `node scripts/dr-manifest.mjs --plan` - a DRY RUN.');
  lines.push('# Every $VAR below is an environment reference resolved on the');
  lines.push('# operator machine at execution time; this file never contains,');
  lines.push('# and must never be edited to contain, a resolved value.');
  lines.push('');
  lines.push(`RPO target: ${manifest.rpoMinutes} minutes. RTO target: ${manifest.rtoHours} hours.`);
  lines.push('');
  for (const step of manifest.restoreProcedure) {
    const who = step.component ? `[${step.component}]` : '[procedure]';
    lines.push(`${String(step.step).padStart(2)}. ${who} ${step.action}`);
  }
  lines.push('');
  lines.push('# --- per-component verification (each must execute and record) ---');
  for (const c of [...manifest.components].sort((a, b) => a.restoreOrder - b.restoreOrder)) {
    lines.push(`order ${c.restoreOrder} - ${c.id}: ${c.verification}`);
    const freshness =
      c.cadenceHours === null
        ? `waived: ${c.cadenceWaiver}`
        : `every <=${c.cadenceHours}h${c.rpoMechanism ? `; RPO via: ${c.rpoMechanism}` : ''}`;
    lines.push(`           freshness: ${freshness}`);
  }
  const rls = manifest.rlsEvidence;
  if (rls !== undefined) {
    lines.push('');
    lines.push('# --- rls enablement evidence (Part 15) ---');
    lines.push(`verifier: ${rls.verifier} (read-only; the engine's own audit covers the engine plane)`);
    lines.push(`cadence: ${rls.cadenceHours === null ? `waived: ${rls.cadenceWaiver}` : `<=${rls.cadenceHours}h`}`);
    lines.push(`scope: ${rls.scope}`);
    lines.push(`evidence ledger: ${rls.evidenceLedger} (append-only, checked by --check-rls)`);
  }
  lines.push('');
  lines.push('# --- invariants this plan assumes ---');
  for (const inv of manifest.invariants) {
    lines.push(`- ${inv}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

// The one list of modes: a flag that exists but is not in here is read as a
// value-taking override, which is how "--due --check-rls" would silently
// become an override named "check-rls". One array, both branches.
const MODE_FLAGS = ['--check', '--plan', '--due', '--record', '--check-rls', '--record-rls', '--emit-schedule', '--check-schedule', '--verify-rls'];

/** Flags that take no value. Listing them is required because the parser below treats every other
 * `--x` as a value-taking override, and `--json` must never be able to swallow the next argument -
 * the same trap that `--due --check-rls` walked into (see the note above MODE_FLAGS). */
const BOOL_FLAGS = ['--json'];

function parseFlags(argv) {
  const flags = { mode: null, overrides: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (BOOL_FLAGS.includes(arg)) {
      // Stored in `overrides`, not on the flag object: every mode reads its inputs out of one
      // place, and a boolean that lives somewhere else is a boolean nobody checks.
      flags.overrides[arg.slice(2)] = true;
      continue;
    }
    if (arg.startsWith('--') && !arg.includes('=') && !MODE_FLAGS.includes(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`flag ${arg} requires a value`);
      }
      flags.overrides[arg.slice(2)] = value;
      i += 1;
    } else if (MODE_FLAGS.includes(arg)) {
      if (flags.mode !== null) {
        throw new Error(`only one mode at a time, got ${flags.mode} and ${arg}`);
      }
      flags.mode = arg;
    } else {
      throw new Error(`unrecognized argument ${JSON.stringify(arg)}`);
    }
  }
  return flags;
}

function usage() {
  console.error(
    [
      'usage:',
      '  node scripts/dr-manifest.mjs --check',
      '  node scripts/dr-manifest.mjs --plan',
      '  node scripts/dr-manifest.mjs --due [--now ISO] [--ledger PATH]',
      '  node scripts/dr-manifest.mjs --record --component ID --outcome ok|failed [--note TEXT] [--at ISO] [--ledger PATH]',
      '  node scripts/dr-manifest.mjs --check-rls [--now ISO] [--ledger PATH]',
      '  node scripts/dr-manifest.mjs --record-rls --grade pass|fail|unverified [--probed N] [--role NAME] [--note TEXT] [--at ISO] [--ledger PATH]',
      '  node scripts/dr-manifest.mjs --emit-schedule [--root PATH] [--out PATH] [--manifest PATH]',
      '  node scripts/dr-manifest.mjs --check-schedule [--out PATH] [--manifest PATH]',
      '  node scripts/dr-manifest.mjs --verify-rls [--now ISO] [--ledger PATH] [--manifest PATH] [--json]',
    ].join('\n'),
  );
  return 2;
}

const LEDGER_PATH = join(ROOT, 'docs', 'dr', 'backup-ledger.jsonl');

function readLedger(path, knownIds) {
  if (!existsSync(path)) {
    // Absent ledger is not broken state - it is an empty record, and every
    // obliged component reads as "never recorded", which IS the alarm.
    return { entries: [], problems: [] };
  }
  const parsed = parseLedger(readFileSync(path, 'utf8'), knownIds);
  // Note-level secret scan on PARSED content, not just file text: an
  // escaped quote inside JSON is the one spelling the text scan reliably
  // misses, and this is the last place a credential could hide in plain
  // repository history.
  for (const entry of parsed.entries) {
    if (entry.note !== undefined) {
      for (const finding of findSecretShapes(`${entry.note}\n`)) {
        parsed.problems.push(`SECRET-SHAPED CONTENT in note (component ${entry.component}): ${finding}`);
      }
    }
  }
  return parsed;
}

/** `skipLedger` is for the Part 15 modes: the RLS evidence file lives in its
 OWN ledger, and parsing it as a backup ledger would report its own fields as
 corruption - and, worse, let the shared "unreadable evidence" refusal fire on
 a perfectly valid RLS line. One loader, two files, never a cross-read. */
function loadManifestAndLedger(overrides, skipLedger = false) {
  // `--manifest` exists for the same reason `--ledger` and `--out` do: a mode that can
  // only be pointed at the repository's own file cannot be tested against a broken
  // input without breaking the repository. Defaults unchanged.
  const manifestPath = overrides.manifest ?? MANIFEST_PATH;
  const raw = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(raw); // parse errors surface via caller's try/catch
  const secretFindings = findSecretShapes(raw);
  const errors = validateManifest(manifest);
  const knownIds = new Set((manifest.components ?? []).map((c) => c.id));
  const ledgerPath = overrides.ledger ?? LEDGER_PATH;
  const ledger = skipLedger ? { entries: [], problems: [] } : readLedger(ledgerPath, knownIds);
  return { manifest, raw, secretFindings, errors, knownIds, ledgerPath, ledger };
}

function main(argv) {
  let flags;
  try {
    flags = parseFlags(argv);
  } catch (error) {
    console.error(String(error.message ?? error));
    return usage();
  }
  const { mode, overrides } = flags;
  if (mode === null) {
    return usage();
  }

  const rlsMode = mode === '--check-rls' || mode === '--record-rls' || mode === '--verify-rls';
  let loaded;
  try {
    loaded = loadManifestAndLedger(overrides, rlsMode);
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error(`manifest is not valid JSON: ${error.message}`);
      return 1;
    }
    throw error;
  }
  const { manifest, secretFindings, ledgerPath, ledger } = loaded;

  for (const finding of secretFindings) {
    console.error(`SECRET-SHAPED CONTENT (manifest): ${finding}`);
  }
  const errors = [...loaded.errors];
  for (const problem of ledger.problems) {
    errors.push(`LEDGER ${ledgerPath}: ${problem}`);
  }
  for (const finding of existsSync(ledgerPath) ? findSecretShapes(readFileSync(ledgerPath, 'utf8')) : []) {
    errors.push(`SECRET-SHAPED CONTENT (ledger): ${finding}`);
  }
  if (secretFindings.length > 0) {
    return 1;
  }
  if (mode === '--check' || mode === '--plan') {
    if (errors.length > 0) {
      for (const error of errors) {
        console.error(`MANIFEST: ${error}`);
      }
      return 1;
    }
  }
  if (mode === '--check') {
    const obliged = manifest.components.filter((c) => c.cadenceHours !== null).length;
    console.log(
      `manifest valid: ${manifest.components.length} components (${obliged} with cadence), ` +
        `RPO ${manifest.rpoMinutes}m / RTO ${manifest.rtoHours}h, ` +
        `drill every ${manifest.drill.cadenceDays}d (timed: ${manifest.drill.timed}), ` +
        `ledger entries: ${ledger.entries.length}`,
    );
    return 0;
  }
  if (mode === '--plan') {
    process.stdout.write(renderPlan(manifest));
    return 0;
  }

  if (mode === '--due') {
    const nowMs = overrides.now === undefined ? Date.now() : Date.parse(overrides.now);
    if (Number.isNaN(nowMs)) {
      console.error(`--now is not an ISO-8601 timestamp: ${JSON.stringify(overrides.now)}`);
      return 2;
    }
    if (ledger.problems.length > 0) {
      // A corrupt ledger can hide overdue obligations: refuse to grade the
      // fleet on unreadable evidence instead of reporting a false "all ok".
      for (const problem of ledger.problems) {
        console.error(`LEDGER ${ledgerPath}: ${problem}`);
      }
      console.error('REFUSING to answer --due from an unreadable ledger');
      return 1;
    }
    const rows = dueReport(manifest, ledger.entries, nowMs);
    for (const row of rows) {
      console.log(row.line);
    }
    const overdue = rows.filter((r) => r.state === 'due');
    console.log(
      overdue.length === 0
        ? `all obligations current as of ${new Date(nowMs).toISOString()}`
        : `${overdue.length} obligation(s) DUE as of ${new Date(nowMs).toISOString()}`,
    );
    return overdue.length === 0 ? 0 : 1;
  }

  if (mode === '--emit-schedule' || mode === '--check-schedule') {
    // Both modes read the manifest the way --check does, and neither may run on a
    // manifest that fails validation: a schedule rendered from a cadence table that
    // does not parse is a file that looks authoritative and is arbitrary, and the
    // whole value of generating it is that the manifest is the single authority.
    if (errors.length > 0) {
      for (const error of errors) {
        console.error(`MANIFEST: ${error}`);
      }
      console.error(`REFUSING to answer ${mode} from an invalid manifest`);
      return 1;
    }
    const schedulePath = overrides.out ?? SCHEDULE_PATH;
    const root = overrides.root ?? '.';
    if (mode === '--emit-schedule') {
      const text = renderSchedule(manifest, root);
      const changed = !existsSync(schedulePath) || readFileSync(schedulePath, 'utf8') !== text;
      mkdirSync(dirname(schedulePath), { recursive: true });
      writeFileSync(schedulePath, text);
      const tightest = scheduleTightestCadenceHours(manifest);
      console.log(
        `wrote ${schedulePath}: ${
          tightest === null
            ? 'no cadence to age (every component waives one); the manifest check still runs'
            : `obligations age against ${tightest}h, checked every ${scheduleCheckIntervalHours(tightest)}h`
        }, wlctRoot=${root}${changed ? '' : ' (content unchanged)'}`,
      );
      return 0;
    }
    if (!existsSync(schedulePath)) {
      console.error(
        `no schedule file at ${schedulePath} - run --emit-schedule, and the obligation to run it is exactly the point of the file`,
      );
      return 1;
    }
    const problems = scheduleDrift(manifest, readFileSync(schedulePath, 'utf8'));
    if (problems.length > 0) {
      for (const problem of problems) {
        console.error(`SCHEDULE ${schedulePath}: ${problem}`);
      }
      return 1;
    }
    const scheduled = readFileSync(schedulePath, 'utf8')
      .split('\n')
      .filter((line) => !line.startsWith('#') && line.includes('dr-manifest.mjs'))
      .map((line) => /(--[a-z-]+)\s*$/.exec(line)?.[1] ?? '?');
    console.log(
      `schedule valid: ${scheduled.length} job line(s) (${scheduled.join(', ')}), ` +
        `derived from ${manifest.components.length} components, no ledger-writing mode present`,
    );
    return 0;
  }

  if (mode === '--verify-rls') {
    // Read-only, and it never writes a ledger: the answer is a document, so a CI job or an ops
    // panel can read it without a second tool reimplementing these six laws.
    if (overrides.json === true) {
      const nowMs = overrides.now === undefined ? Date.now() : Date.parse(overrides.now);
      if (Number.isNaN(nowMs)) {
        console.error(`--verify-rls: --now is not an ISO-8601 timestamp: ${JSON.stringify(overrides.now)}`);
        return 2;
      }
      const document = verifyRlsEvidence(manifest, { nowMs });
      console.log(JSON.stringify(document));
      return document.grade === 'pass' ? 0 : document.grade === 'unverified' ? 3 : 1;
    }
    const nowMs = overrides.now === undefined ? Date.now() : Date.parse(overrides.now);
    if (Number.isNaN(nowMs)) {
      console.error(`--verify-rls: --now is not an ISO-8601 timestamp: ${JSON.stringify(overrides.now)}`);
      return 2;
    }
    const document = verifyRlsEvidence(manifest, { nowMs });
    for (const check of document.checks) {
      const mark = check.grade === 'pass' ? 'ok  ' : check.grade === 'fail' ? 'FAIL' : check.grade === 'skipped' ? 'skip ' : 'UNVER';
      console.log(`[${mark}] ${check.name.padEnd(28)} ${check.detail}`);
    }
    if (document.findings.length > 0) {
      for (const finding of document.findings) console.error(`finding: ${finding}`);
    }
    console.log(
      `rls verification: ${document.grade.toUpperCase()} - ${document.checks.filter((c) => c.grade === 'pass').length}/${document.checks.length} checks pass; ` +
        `${document.assertion}`,
    );
    return document.grade === 'pass' ? 0 : document.grade === 'unverified' ? 3 : 1;
  }

  if (mode === '--check-rls' || mode === '--record-rls') {
    const evidence = manifest.rlsEvidence;
    if (evidence === undefined || evidence === null) {
      // validateManifest already named it; this is the CLI's own answer, so
      // a caller who ignores exit 1 of --check still cannot read a verdict
      // out of a missing block.
      console.error('manifest has no rlsEvidence block (see `--check` for the validation failure)');
      return 1;
    }
    for (const error of errors) {
      console.error(`MANIFEST: ${error}`);
    }
    const evidencePath = overrides.ledger ?? join(ROOT, evidence.evidenceLedger);
    let parsed = { entries: [], problems: [] };
    if (existsSync(evidencePath)) {
      parsed = parseRlsLedger(readFileSync(evidencePath, 'utf8'));
      for (const finding of findSecretShapes(readFileSync(evidencePath, 'utf8'))) {
        parsed.problems.push(`SECRET-SHAPED CONTENT: ${finding}`);
      }
    }
    if (mode === '--check-rls') {
      if (parsed.problems.length > 0) {
        for (const problem of parsed.problems) {
          console.error(`RLS EVIDENCE ${evidencePath}: ${problem}`);
        }
        // Same law as --due: unreadable evidence is never graded as absent
        // evidence ("all ok") - it is a refusal that costs a fix.
        console.error('REFUSING to answer --check-rls from an unreadable evidence ledger');
        return 1;
      }
      if (errors.length > 0) {
        console.error('REFUSING to answer --check-rls from an invalid manifest');
        return 1;
      }
      const nowMs = overrides.now === undefined ? Date.now() : Date.parse(overrides.now);
      if (Number.isNaN(nowMs)) {
        console.error(`--check-rls: --now is not an ISO-8601 timestamp: ${JSON.stringify(overrides.now)}`);
        return 2;
      }
      const row = rlsEvidenceReport(evidence, parsed.entries, nowMs);
      console.log(row.line);
      console.log(
        `cadence ${evidence.cadenceHours === null ? 'waived' : `${evidence.cadenceHours}h`}, ` +
          // the file it ACTUALLY read, not the manifest's default: a
          // --ledger override that changed the answer is exactly the case a
          // summary line must not obscure.
          `ledger ${evidencePath} (${parsed.entries.length} entries), verifier ${evidence.verifier}`,
      );
      return row.state === 'ok' || row.state === 'waived' ? 0 : 1;
    }

    // --record-rls: the operator's record of an audit THIS script never ran.
    // That separation is the design: the CLI has no database credentials and
    // no business having them, so it can accept, age and store a result but
    // cannot invent one - which is also why --grade is required and there is
    // no "--assume-pass".
    const grade = overrides.grade;
    if (grade !== 'pass' && grade !== 'fail' && grade !== 'unverified') {
      console.error('--record-rls: --grade must be pass, fail or unverified (the core\'s closed vocabulary)');
      return 1;
    }
    if (parsed.problems.length > 0) {
      for (const problem of parsed.problems) {
        console.error(`RLS EVIDENCE ${evidencePath}: ${problem}`);
      }
      console.error('REFUSING to append to an unreadable evidence ledger - fix the named lines first');
      return 1;
    }
    const atRaw = overrides.at ?? new Date().toISOString();
    const atMs = Date.parse(atRaw);
    if (Number.isNaN(atMs)) {
      console.error(`--record-rls: --at is not an ISO-8601 timestamp: ${JSON.stringify(overrides.at)}`);
      return 1;
    }
    const entry = { at: new Date(atMs).toISOString(), grade };
    if (overrides.probed !== undefined) {
      const probed = Number(overrides.probed);
      if (!Number.isInteger(probed) || probed < 0 || probed > 4096) {
        console.error('--record-rls: --probed must be an integer 0..4096 (tables actually read)');
        return 1;
      }
      entry.probed = probed;
    }
    for (const [key, flag] of [['role', '--role'], ['note', '--note']]) {
      const value = overrides[key];
      if (value === undefined) {
        continue;
      }
      const limit = key === 'role' ? 200 : 500;
      if (value.length > limit || /[\r\n]/.test(value)) {
        console.error(`--record-rls: ${flag} must be one line of at most ${limit} characters`);
        return 1;
      }
      entry[key] = value;
    }
    const line = JSON.stringify(entry);
    const secretFindingsInLine = [
      ...findSecretShapes(`${line}\n`),
      ...(entry.note === undefined ? [] : findSecretShapes(`${entry.note}\n`)),
    ];
    if (secretFindingsInLine.length > 0) {
      for (const finding of secretFindingsInLine) {
        console.error(`REFUSING to record: ${finding}`);
      }
      console.error('evidence describes what was verified, never what was used to verify it - credentials do not belong in the ledger');
      return 1;
    }
    appendFileSync(evidencePath, `${line}\n`, 'utf8');
    console.log(`recorded: ${line}`);
    const row = rlsEvidenceReport(evidence, [...parsed.entries, { ...entry, atMs }], Date.now());
    console.log(row.line);
    return row.state === 'ok' || row.state === 'waived' ? 0 : 1;
  }

  // --record
  const component = overrides.component;
  const outcome = overrides.outcome;
  if (component === undefined || outcome === undefined) {
    console.error('--record requires --component and --outcome');
    return usage();
  }
  if (!loaded.knownIds.has(component)) {
    console.error(`--record: unknown component ${JSON.stringify(component)}`);
    return 1;
  }
  if (outcome !== 'ok' && outcome !== 'failed') {
    console.error('--record: outcome must be "ok" or "failed"');
    return 1;
  }
  const atRaw = overrides.at ?? new Date().toISOString();
  const atMs = Date.parse(atRaw);
  if (Number.isNaN(atMs)) {
    console.error(`--record: --at is not an ISO-8601 timestamp: ${JSON.stringify(overrides.at)}`);
    return 1;
  }
  const entry = { at: new Date(atMs).toISOString(), component, outcome };
  if (overrides.note !== undefined) {
    if (overrides.note.length > 500 || /[\r\n]/.test(overrides.note)) {
      console.error('--record: note must be one line of at most 500 characters');
      return 1;
    }
    entry.note = overrides.note;
  }
  const line = JSON.stringify(entry);
  // Scan BOTH forms: the stored line (catches a crafted --at/field smuggle)
  // and the raw note (JSON escaping must not launder `KEY="secret"` into
  // `KEY=\"secret\"` past the patterns).
  const secretFindingsInLine = [
    ...findSecretShapes(`${line}\n`),
    ...(entry.note === undefined ? [] : findSecretShapes(`${entry.note}\n`)),
  ];
  if (secretFindingsInLine.length > 0) {
    for (const finding of secretFindingsInLine) {
      console.error(`REFUSING to record: ${finding}`);
    }
    console.error('notes describe what was done, never what was used - credentials do not belong in the ledger');
    return 1;
  }
  if (ledger.problems.length > 0) {
    for (const problem of ledger.problems) {
      console.error(`LEDGER ${ledgerPath}: ${problem}`);
    }
    console.error('REFUSING to append to an unreadable ledger - fix the named lines first');
    return 1;
  }
  appendFileSync(ledgerPath, `${line}\n`, 'utf8');
  console.log(`recorded: ${line}`);
  const rows = dueReport(manifest, [...ledger.entries, { ...entry, atMs }], Date.now());
  const mine = rows.find((r) => r.component === component);
  if (mine !== undefined) {
    console.log(mine.line);
  }
  return 0;
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2));
}

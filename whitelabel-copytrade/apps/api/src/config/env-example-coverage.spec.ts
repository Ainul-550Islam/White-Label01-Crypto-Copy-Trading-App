/**
 * The environment schema and `.env.example` are one promise in two files, so they are
 * checked against each other rather than trusted separately.
 *
 * `packages/config/src/env.schema.ts` is the single source of truth for what the API and
 * the worker will boot with: an unlisted name is ignored, a listed name is validated, and
 * `apps/api/src/config/env.validation.ts` aborts the process when the two disagree with
 * reality. `.env.example` is the only place an operator learns those names exist. A part
 * that adds a schema key and forgets the example file has therefore shipped a knob nobody
 * can find - and a part that documents a name nobody reads has shipped a lie in the file
 * people copy into production. Both directions are asserted here, in the house style of
 * `infrastructure/prisma/rls-coverage.spec.ts`: re-derive the truth from the source at
 * test time instead of importing a snapshot of it that could itself drift.
 *
 * The third check exists because of what this audit actually found. `health.service.ts`
 * reads `process.env.GIT_COMMIT_SHA` directly, outside the schema - a legitimate exception,
 * since a build stamp is not a deployment knob - except that nothing in the repository set
 * it and no file named it, so `GET /v1/health` was reporting `commit: "unknown"` for a
 * reason nobody could look up. An exception that is written down is a design; an exception
 * that is only coded is how that happened.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..', '..', '..', '..');

const SCHEMA_SOURCE = 'packages/config/src/env.schema.ts';
const EXAMPLE_SOURCE = '.env.example';
const MODULE_SOURCE = 'apps/api/src/config/app-config.module.ts';
const VALIDATION_SOURCE = 'apps/api/src/config/env.validation.ts';
const READ_ROOTS = ['apps/api/src', 'apps/worker/src', 'services/notification-service/src'];

const read = (relative: string): string => readFileSync(join(repoRoot, relative), 'utf8');

/** The keys the schema declares: top-level UPPER_SNAKE members of its object literal. */
function declaredKeys(source: string): string[] {
  return [...source.matchAll(/^ {4}([A-Z][A-Z0-9_]+)\s*:/gm)].map((match) => String(match[1]));
}

/** Assignments an operator actually gets: a name at column zero, not a commented mention. */
function activeAssignments(example: string): string[] {
  return [...example.matchAll(/^([A-Z][A-Z0-9_]{2,})=/gm)].map((match) => String(match[1]));
}

function walkFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist') {
        walkFiles(join(directory, entry.name), found);
      }
      continue;
    }
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      found.push(join(directory, entry.name));
    }
  }
  return found;
}

/**
 * Every `process.env.NAME` read outside `packages/config`.
 *
 * Spec files are skipped on purpose: a test that assigns an env var to build a fixture is
 * describing a scenario, not adding to the deployment surface, and forcing documentation for
 * those would bury the case this check exists for.
 */
function directEnvironmentReads(): Set<string> {
  const names = new Set<string>();
  for (const root of READ_ROOTS) {
    const absolute = join(repoRoot, root);
    if (!exists(absolute)) {
      continue;
    }
    for (const file of walkFiles(absolute)) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) {
        names.add(String(match[1]));
      }
    }
  }
  return names;
}

function exists(path: string): boolean {
  try {
    readdirSync(path);
    return true;
  } catch {
    return false;
  }
}

describe('environment schema and .env.example', () => {
  const schema = read(SCHEMA_SOURCE);
  const example = read(EXAMPLE_SOURCE);
  const keys = declaredKeys(schema);
  const assigned = activeAssignments(example);

  it('declares enough keys that this check cannot pass by scanning nothing', () => {
    expect(keys.length).toBeGreaterThanOrEqual(200);
    expect(assigned.length).toBeGreaterThanOrEqual(200);
  });

  it('names every key the schema declares', () => {
    const undocumented = keys.filter((key) => !example.includes(key));
    expect(undocumented).toEqual([]);
  });

  it('assigns each name at most once, because two answers is no answer', () => {
    const counts = new Map<string, number>();
    for (const name of assigned) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const duplicated = [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name);
    // dotenv honours the first value of a repeated key and docker compose's env_file
    // honours the last, so a name written twice in one file is a setting whose value
    // depends on which loader read it. Three names were, and two carried different values.
    expect(duplicated).toEqual([]);
  });

  it('documents or declares every name read straight off process.env', () => {
    const undeclared = [...directEnvironmentReads()].filter(
      (name) => !keys.includes(name) && !example.includes(name),
    );
    expect(undeclared).toEqual([]);
  });

  it('is wired to the boot path it claims to police', () => {
    // If `validate: validateEnvironment` were dropped from the module, every assertion
    // above would still pass while the schema stopped mattering: a parity test on a seam
    // has to check the seam is installed.
    expect(read(MODULE_SOURCE)).toContain('validate: validateEnvironment');
    expect(read(VALIDATION_SOURCE)).toContain('validateEnv(raw)');
  });
});

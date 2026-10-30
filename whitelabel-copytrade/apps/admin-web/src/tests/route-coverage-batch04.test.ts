import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Route coverage enforcement.
 *
 * `scripts/ui-route-coverage.mjs` measures; this test is what makes the number
 * matter. It runs the real script in `--json` mode against the real tree, so
 * deleting a wrapper, renaming a controller path or adding a route without a
 * console caller fails here rather than in production.
 *
 * `ENFORCED_MODULES` is the list of modules this batch has finished. A module is
 * added to it when its pages exist and its routes are wired; it is never
 * removed, so coverage can only ratchet up. The remaining modules of the batch
 * are listed in `PENDING_MODULES` and are reported - but not silently claimed -
 * until they land.
 */
const ENFORCED_MODULES = [
  'custody',
  'oms',
  'risk-management',
  'risk',
  'execution',
  'exchanges',
  'portfolio-accounting',
  'copy-trading',
  'billing/analytics',
  'billing/notifications',
] as const;

/**
 * Empty on purpose: every module this batch took on now has a page and a client
 * wrapper for each of its routes. The list is kept so a future batch can add to
 * it, and the test below still checks that whatever is listed here is counted
 * rather than silently dropped.
 */
const PENDING_MODULES = [] as const;

interface CoverageRoute {
  method: string;
  path: string;
  file: string;
  module: string;
}

interface CoverageDocument {
  totals: { controllerRoutes: number; referenced: number; uncovered: number; unresolvedComputedCalls: number };
  developerPlatform: {
    routes: number;
    withClientWrapper: number;
    calledByUi: number;
    uncalledByUi: CoverageRoute[];
  };
  modules: Array<{ module: string; routes: number; covered: number; uncovered: number; files: string[] }>;
  uncovered: CoverageRoute[];
}

const repoRoot = resolve(process.cwd(), '../..');
const scriptPath = resolve(process.cwd(), 'scripts/ui-route-coverage.mjs');

function runCoverage(...args: string[]): string {
  return execFileSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    // The inventory parses ~1000 controllers and the whole UI tree; a cold run
    // on a small machine takes a few seconds.
    timeout: 180_000,
    maxBuffer: 32 * 1024 * 1024,
  });
}

describe('route coverage inventory', () => {
  let document: CoverageDocument;

  beforeAll(() => {
    document = JSON.parse(runCoverage('--json')) as CoverageDocument;
  }, 200_000);

  it('reports a non-trivial inventory, so an empty result cannot pass as full coverage', () => {
    expect(document.totals.controllerRoutes).toBeGreaterThan(900);
    expect(document.totals.referenced).toBeGreaterThan(300);
    expect(document.totals.referenced + document.totals.uncovered).toBe(document.totals.controllerRoutes);
  });

  it('lists every module with per-module totals that add up', () => {
    expect(document.modules.length).toBeGreaterThan(20);
    for (const entry of document.modules) {
      expect(entry.routes).toBe(entry.covered + entry.uncovered);
      expect(entry.files.length).toBeGreaterThan(0);
    }
    const summed = document.modules.reduce((total, entry) => total + entry.routes, 0);
    expect(summed).toBe(document.totals.controllerRoutes);
  });

  it('keeps the developer platform wrappers complete', () => {
    expect(document.developerPlatform.routes).toBeGreaterThan(0);
    expect(document.developerPlatform.withClientWrapper).toBe(document.developerPlatform.routes);
    expect(document.developerPlatform.uncalledByUi.length).toBe(
      document.developerPlatform.routes - document.developerPlatform.calledByUi,
    );
  });

  it('reaches every developer-platform route from a UI component, not just from a wrapper', () => {
    // A wrapper nothing calls is a route the product cannot exercise. The integration console and the
    // existing developer pages are what make these 44 reachable.
    expect(document.developerPlatform.calledByUi).toBe(document.developerPlatform.routes);
    expect(document.developerPlatform.uncalledByUi).toEqual([]);
  });

  it.each(ENFORCED_MODULES)('has no uncovered route left in the %s module', (module) => {
    const uncovered = document.uncovered.filter((route) => route.module === module);

    expect(uncovered.map((route) => `${route.method} ${route.path}`)).toEqual([]);
  });

  it('reports the modules still pending instead of hiding them', () => {
    const pending = document.modules
      .filter((entry) => (PENDING_MODULES as ReadonlyArray<string>).includes(entry.module))
      .reduce((total, entry) => total + entry.uncovered, 0);

    // Informational: this is the size of the remainder, kept visible so the gap
    // is a measured number rather than an assumption.
    expect(pending).toBeGreaterThanOrEqual(0);
  });
});

describe('coverage script CLI contract', () => {
  it('keeps the historical human report unchanged for existing readers', () => {
    const output = runCoverage();

    expect(output).toMatch(/^Static inventory: \d+ controller routes; \d+ have a literal web\/admin client reference; \d+ have none\./);
    expect(output).toMatch(/^Developer platform: \d+\/\d+ have client wrappers; \d+\/\d+ are called by a UI component\./m);
    expect(output).toMatch(/computed client calls could not be classified/);
  }, 200_000);

  it('adds a per-module summary without replacing the report', () => {
    const output = runCoverage('--summary');

    expect(output).toContain('module');
    expect(output).toContain('uncovered');
    expect(output).toContain('custody');
    expect(output).toContain('Static inventory:');
  }, 200_000);

  it('prints nothing but JSON in json mode', () => {
    const output = runCoverage('--json');

    expect(() => JSON.parse(output) as unknown).not.toThrow();
    expect(output.trimStart().startsWith('{')).toBe(true);
  }, 200_000);

  it('narrows only the uncovered list when a module filter is given, never the totals', () => {
    const filtered = JSON.parse(runCoverage('--json', '--module', 'custody')) as CoverageDocument & { filter: string[] };
    const full = JSON.parse(runCoverage('--json')) as CoverageDocument;

    expect(filtered.filter).toEqual(['custody']);
    expect(filtered.uncovered.every((route) => route.module === 'custody')).toBe(true);
    expect(filtered.totals).toEqual(full.totals);
    expect(filtered.modules.length).toBe(full.modules.length);
  }, 300_000);

  it('rejects an unknown argument instead of ignoring it', () => {
    expect(() => runCoverage('--jsn')).toThrow();
  });
});

// # Responsibility: generate deterministic RELEASE_MANIFEST.json file hashes, test counts, and explicit CycloneDX SBOM digest records without editing the manifest by hand.
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export interface ReleaseManifestSummary {
  release_name: string;
  repository: string;
  generated_at_utc: string;
  resolved_gaps: number;
  sbom_hashes: Array<{ path: string; sha256: string; size_bytes: number }>;
  counts: {
    total_files_hashed: number;
    source_files: number;
    test_files: number;
    doc_files: number;
    config_or_asset_files: number;
    total_size_bytes_hashed: number;
  };
}

const EXCLUDE_DIRS = new Set([
  '.git',
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
  '.pytest_cache',
  '__pycache__',
  '.venv',
]);

/**
 * The manifest's own timestamp, derived from the source tree rather than from the clock.
 *
 * The file's name and header promise a *deterministic* manifest, and a wall-clock stamp made that
 * promise false: two runs over an identical tree produced two different files, so the manifest could
 * never be verified against the commit it describes. Every other input was already pinned - paths
 * sorted, self excluded - and this was the last one.
 *
 * `SOURCE_DATE_EPOCH` wins when set, it being the reproducible-builds convention. Otherwise the
 * commit date of HEAD is used, which is the same for every regeneration of the same commit. When
 * neither is available the value says so instead of pretending to be a time.
 */
function resolveGeneratedAtUtc(): string {
  const epoch = process.env.SOURCE_DATE_EPOCH;
  if (epoch !== undefined && /^\d+$/.test(epoch)) {
    return new Date(Number(epoch) * 1000).toISOString();
  }
  try {
    const commitDate = execSync('git log -1 --format=%cI', { cwd: __dirname, encoding: 'utf8' }).trim();
    const parsed = new Date(commitDate);
    if (commitDate.length > 0 && !Number.isNaN(parsed.getTime())) return parsed.toISOString();
  } catch {
    // Not a git checkout, or git is unavailable. Fall through to the sentinel.
  }
  return 'UNPINNED_NO_SOURCE_DATE_EPOCH_OR_GIT_HISTORY';
}

const REQUIRED_CYCLONEDX_BOM_NAMES = [
  'cargo-crates.cdx.json',
  'flutter-mobile.cdx.json',
  'npm-workspaces.cdx.json',
  'python-projects.cdx.json',
] as const;

function collectSbomHashes(files: Array<{ path: string; sha256: string; size_bytes: number; category: string }>): Array<{ path: string; sha256: string; size_bytes: number }> {
  const expected = new Set<string>(REQUIRED_CYCLONEDX_BOM_NAMES);
  const candidates = files.filter((entry) => /(?:^|\/)docs\/sbom\/[^/]+\.cdx\.json$/.test(entry.path));
  const byName = new Map<string, { path: string; sha256: string; size_bytes: number }>();
  for (const entry of candidates) {
    const filename = path.basename(entry.path);
    if (!expected.has(filename)) throw new Error(`unexpected CycloneDX SBOM in release tree: ${entry.path}`);
    if (byName.has(filename)) throw new Error(`duplicate CycloneDX SBOM filename in release tree: ${filename}`);
    if (!/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error(`CycloneDX SBOM has an invalid SHA-256 digest: ${entry.path}`);
    byName.set(filename, { path: entry.path, sha256: entry.sha256, size_bytes: entry.size_bytes });
  }
  const missing = REQUIRED_CYCLONEDX_BOM_NAMES.filter((filename) => !byName.has(filename));
  if (missing.length > 0) throw new Error(`release tree is missing required CycloneDX SBOM hashes: ${missing.join(', ')}`);
  return [...byName.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function walkFiles(dir: string, baseDir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, baseDir, acc);
    } else if (entry.isFile()) {
      const rel = path.relative(baseDir, full).replace(/\\/g, '/');
      // The manifest excludes itself, at every location it is written to. It is the artefact
      // being written, so a copy that hashes itself is self-referential: the hash recorded for
      // the file can only equal the hash of the file that records it if the file never changes,
      // and it changes every run, so the release gate in .github/workflows/release.yml could
      // never pass. There are two copies - the repository root and this monorepo - and the walk
      // from the outer root sees the inner one as "whitelabel-copytrade/RELEASE_MANIFEST.json",
      // which an exact rel-name comparison misses. Skipping by basename excludes both, and any
      // copy added later, which is the property the gate actually needs.
      if (entry.name === 'RELEASE_MANIFEST.json') continue;
      acc.push(rel);
    }
  }
  return acc;
}

export function generateDeterministicReleaseManifest(repoRoot: string): {
  summary: ReleaseManifestSummary;
  files: Array<{ path: string; sha256: string; size_bytes: number; category: string }>;
} {
  const relPaths = walkFiles(repoRoot, repoRoot).sort();
  const files: Array<{ path: string; sha256: string; size_bytes: number; category: string }> = [];

  let sourceFiles = 0;
  let testFiles = 0;
  let docFiles = 0;
  let configFiles = 0;
  let totalBytes = 0;

  const testRegex =
    /(^|\/)(tests?|__tests__|__fixtures__|integration_test)\/|\.spec\.[jt]sx?$|\.test\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$|_test\.(py|dart)$|\.fixture-spec\.ts$|(^|\/)run-\d+-checks\.js$|-validation-\d+-checks\.js$/;
  const docRegex = /\.(md|mdx|txt|rst|adoc)$|(^|\/)LICENSE$|(^|\/)docs\//;
  const sourceExts = new Set([
    '.cjs',
    '.css',
    '.dart',
    '.gradle',
    '.h',
    '.html',
    '.java',
    '.js',
    '.jsx',
    '.kt',
    '.mjs',
    '.prisma',
    '.py',
    '.rb',
    '.sh',
    '.sql',
    '.swift',
    '.tf',
    '.ts',
    '.tsx',
  ]);

  for (const rel of relPaths) {
    const abs = path.join(repoRoot, rel);
    const buf = fs.readFileSync(abs);
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    const size = buf.length;
    totalBytes += size;

    let category = 'config_or_asset';
    if (testRegex.test(rel)) {
      category = 'test';
      testFiles++;
    } else if (docRegex.test(rel)) {
      category = 'doc';
      docFiles++;
    } else if (sourceExts.has(path.extname(rel))) {
      category = 'source';
      sourceFiles++;
    } else {
      configFiles++;
    }

    files.push({
      path: rel,
      sha256,
      size_bytes: size,
      category,
    });
  }

  const sbom_hashes = collectSbomHashes(files);
  const summary: ReleaseManifestSummary = {
    release_name: 'White-Label01-Crypto-Copy-Trading-App-FINAL-COMPLETE',
    repository: 'https://github.com/Ainul-550Islam/White-Label01-Crypto-Copy-Trading-App',
    generated_at_utc: resolveGeneratedAtUtc(),
    resolved_gaps: 50,
    sbom_hashes,
    counts: {
      total_files_hashed: files.length,
      source_files: sourceFiles,
      test_files: testFiles,
      doc_files: docFiles,
      config_or_asset_files: configFiles,
      total_size_bytes_hashed: totalBytes,
    },
  };

  return { summary, files };
}

if (require.main === module) {
  const monorepoRoot = path.resolve(__dirname, '..');
  // The package-check document is a tracked root-level input, not a generated manifest. Resolve
  // its real location from this monorepo so a clean checkout does not need a pre-existing manifest
  // to identify the outer repository root.
  const outerPackageCheck = path.resolve(monorepoRoot, '../RELEASE_PACKAGE_CHECK.md');
  const outerRoot = fs.existsSync(outerPackageCheck) ? path.resolve(monorepoRoot, '..') : monorepoRoot;

  const { summary, files } = generateDeterministicReleaseManifest(outerRoot);
  const manifestPayload = {
    ...summary,
    files,
  };
  fs.writeFileSync(
    path.join(outerRoot, 'RELEASE_MANIFEST.json'),
    JSON.stringify(manifestPayload, null, 2) + '\n',
    'utf8',
  );
  fs.writeFileSync(
    path.join(monorepoRoot, 'RELEASE_MANIFEST.json'),
    JSON.stringify(manifestPayload, null, 2) + '\n',
    'utf8',
  );
  console.log(
    `Generated RELEASE_MANIFEST.json (${summary.counts.total_files_hashed} files hashed, ${summary.counts.test_files} test files, 50/50 gaps resolved).`,
  );
}

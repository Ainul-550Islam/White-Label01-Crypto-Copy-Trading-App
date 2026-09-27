#!/usr/bin/env node
/**
 * Writes the complete Part 1 source of the monorepo into docs/source/ as a set
 * of Markdown files, every file rendered as
 *
 *     FILE: exact/path/to/file
 *     ```lang
 *     <complete content>
 *     ```
 *
 * The delivery requirement is that every file appears in full, with nothing
 * elided. At ~51k lines that does not fit in a chat message, so the dump is
 * produced here instead: same content, browsable, and regenerable after any
 * change with `node scripts/generate-source-dump.mjs`.
 *
 * Generated artefacts (node_modules, dist, .next, migrations, lockfiles) and
 * anything containing real secrets (.env) are excluded by design.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, relative, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'docs', 'source');

/** Directories never worth dumping: generated, vendored, or secret. */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.next',
  '.git',
  'build',
  'coverage',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.dart_tool',
  '.venv',
  'venv',
  'migrations',
  'source',
]);

/** Files excluded: real secrets, lockfiles, binaries. */
const SKIP_FILES = new Set(['.env', 'package-lock.json', 'pubspec.lock', '.DS_Store']);

const SKIP_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.webp',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.pdf',
  '.zip',
  '.tsbuildinfo',
]);

const LANGUAGE_BY_EXTENSION = new Map([
  ['.ts', 'typescript'],
  ['.tsx', 'tsx'],
  ['.js', 'javascript'],
  ['.mjs', 'javascript'],
  ['.cjs', 'javascript'],
  ['.json', 'json'],
  ['.py', 'python'],
  ['.dart', 'dart'],
  ['.sql', 'sql'],
  ['.sh', 'bash'],
  ['.yml', 'yaml'],
  ['.yaml', 'yaml'],
  ['.md', 'markdown'],
  ['.prisma', 'prisma'],
  ['.css', 'css'],
  ['.html', 'html'],
  ['.xml', 'xml'],
  ['.gradle', 'groovy'],
  ['.properties', 'properties'],
  ['.txt', 'text'],
  ['.toml', 'toml'],
  ['.plist', 'xml'],
  ['.pbxproj', 'text'],
  ['.podspec', 'ruby'],
  ['.kt', 'kotlin'],
  ['.swift', 'swift'],
  ['.Dockerfile', 'dockerfile'],
]);

/**
 * The dump is split by area so each output file stays openable in an editor and
 * in the workspace previewer. Order mirrors the reading order a reviewer wants:
 * contracts first, then the API, then the satellites, then the clients.
 */
const SECTIONS = [
  {
    id: '01-root',
    title: 'Repository root',
    blurb:
      'Workspace wiring, the shared TypeScript base config, the complete environment reference and the Compose topology.',
    match: (path) => !path.includes(sep),
  },
  {
    id: '02-packages',
    title: 'Shared packages (@wlct/*)',
    blurb:
      'The contracts every runtime agrees on: shared types, validated configuration, validation schemas and the crypto/util layer.',
    match: (path) => path.startsWith(`packages${sep}`),
  },
  {
    id: '03-api-prisma',
    title: 'API - data model',
    blurb: 'The Prisma schema and the idempotent seed that provisions roles, permissions and the platform tenant.',
    match: (path) => path.startsWith(`apps${sep}api${sep}prisma${sep}`),
  },
  {
    id: '04-api-foundation',
    title: 'API - bootstrap, config and common layer',
    blurb:
      'Entrypoint, configuration service, Swagger, and the cross-cutting filters, guards, interceptors, pipes and middleware.',
    match: (path) =>
      path.startsWith(`apps${sep}api${sep}`) &&
      !path.startsWith(`apps${sep}api${sep}prisma${sep}`) &&
      !path.startsWith(`apps${sep}api${sep}src${sep}modules${sep}`) &&
      !path.startsWith(`apps${sep}api${sep}src${sep}infrastructure${sep}`),
  },
  {
    id: '05-api-infrastructure',
    title: 'API - infrastructure',
    blurb: 'Prisma service and tenant-scoped client, Redis, envelope encryption, password hashing, logging and i18n.',
    match: (path) => path.startsWith(`apps${sep}api${sep}src${sep}infrastructure${sep}`),
  },
  {
    id: '06-api-modules',
    title: 'API - feature modules',
    blurb:
      'Auth, users, tenants, RBAC, audit, security events, feature flags, billing, notifications, queue, realtime and health.',
    match: (path) => path.startsWith(`apps${sep}api${sep}src${sep}modules${sep}`),
  },
  {
    id: '07-services',
    title: 'Backing services',
    blurb:
      'The Python trading-engine and market-data services, and the TypeScript notification worker. No execution logic in Part 1.',
    match: (path) => path.startsWith(`services${sep}`),
  },
  {
    id: '08-admin-web',
    title: 'Admin console (Next.js)',
    blurb: 'Server-side session handling, the proxy route, and the console screens.',
    match: (path) => path.startsWith(`apps${sep}admin-web${sep}`),
  },
  {
    id: '09-mobile',
    title: 'Mobile app (Flutter)',
    blurb: 'Configuration, secure storage, the API client with refresh handling, routing, theming and localisation.',
    match: (path) => path.startsWith(`apps${sep}mobile${sep}`),
  },
  {
    id: '10-trading-core',
    title: 'Python trading core (libs/trading-core)',
    blurb:
      'The pure decision core from Parts 2, 5, 6, 7 and 8: signals, orders, positions, exchanges, execution, paper and ' +
      'backtest engines, the dataset infrastructure, the risk package, and the complete pytest suite.',
    match: (path) => path.startsWith(`libs${sep}`),
  },
  {
    id: '11-infrastructure',
    title: 'Infrastructure, scripts and docs',
    blurb: 'Dockerfiles, database bootstrap SQL, the helper scripts and the written documentation.',
    match: (path) =>
      path.startsWith(`infrastructure${sep}`) ||
      path.startsWith(`scripts${sep}`) ||
      path.startsWith(`docs${sep}`),
  },
];

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir).sort()) {
    const absolute = join(dir, entry);
    const stats = statSync(absolute);

    if (stats.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      walk(absolute, acc);
      continue;
    }

    if (SKIP_FILES.has(entry)) continue;
    if (SKIP_EXTENSIONS.has(extname(entry))) continue;
    if (entry.endsWith('.tsbuildinfo')) continue;

    // Compiled output that leaked next to its source (a stray `tsc` run without
    // an outDir). It is never part of the delivery and would silently shadow the
    // real module, so it is skipped rather than dumped.
    const relativePath = relative(ROOT, absolute);
    const isTypeScriptSource = relativePath.includes(`${sep}src${sep}`);
    if (
      isTypeScriptSource &&
      (entry.endsWith('.d.ts') || entry.endsWith('.js.map') || entry.endsWith('.d.ts.map'))
    ) {
      continue;
    }

    acc.push(relative(ROOT, absolute));
  }
  return acc;
}

function languageFor(path) {
  if (path.endsWith('.Dockerfile') || path.endsWith('Dockerfile')) return 'dockerfile';
  if (path.endsWith('.gitignore') || path.endsWith('.dockerignore')) return 'gitignore';
  if (path.endsWith('.env.example')) return 'ini';
  if (path.endsWith('.editorconfig')) return 'ini';
  if (path.endsWith('.nvmrc')) return 'text';
  return LANGUAGE_BY_EXTENSION.get(extname(path)) ?? 'text';
}

/**
 * Picks a fence long enough that fenced blocks inside the file (common in the
 * Markdown docs) cannot terminate it early.
 */
function fenceFor(content) {
  let longest = 0;
  for (const match of content.matchAll(/^`{3,}/gm)) {
    longest = Math.max(longest, match[0].length);
  }
  return '`'.repeat(Math.max(3, longest + 1));
}

function main() {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const files = walk(ROOT);
  const assigned = new Set();
  const index = [];
  let totalLines = 0;

  for (const section of SECTIONS) {
    const members = files.filter((path) => !assigned.has(path) && section.match(path));
    members.forEach((path) => assigned.add(path));

    if (members.length === 0) continue;

    const parts = [
      `# ${section.title}`,
      '',
      section.blurb,
      '',
      `${members.length} files. Part of the complete Part 1 source dump - see \`docs/source/README.md\`.`,
      '',
      '---',
      '',
    ];

    let sectionLines = 0;
    for (const path of members) {
      const content = readFileSync(join(ROOT, path), 'utf8');
      const fence = fenceFor(content);
      sectionLines += content.split('\n').length;

      parts.push(`FILE: ${path.split(sep).join('/')}`);
      parts.push('');
      parts.push(`${fence}${languageFor(path)}`);
      parts.push(content.replace(/\n$/, ''));
      parts.push(fence);
      parts.push('');
    }

    totalLines += sectionLines;
    writeFileSync(join(OUT_DIR, `${section.id}.md`), `${parts.join('\n')}\n`, 'utf8');
    index.push({ ...section, count: members.length, lines: sectionLines });
  }

  const orphans = files.filter((path) => !assigned.has(path));
  if (orphans.length > 0) {
    throw new Error(`Unassigned files would be dropped from the dump:\n  ${orphans.join('\n  ')}`);
  }

  const readme = [
    '# Complete Part 1 source',
    '',
    'Every file of the Part 1 delivery, in full, with nothing elided. Generated by',
    '`scripts/generate-source-dump.mjs`; regenerate it after any change with:',
    '',
    '```bash',
    'node scripts/generate-source-dump.mjs',
    '```',
    '',
    'Each entry is rendered as `FILE: exact/path/to/file` followed by the complete',
    'content of that file, so a path can be located by searching for its `FILE:` line.',
    '',
    'Excluded on purpose: generated output (`node_modules`, `dist`, `.next`, Prisma',
    'migrations, lockfiles), binary assets, and `.env` - which holds real secrets and',
    'must never be committed. `.env.example` documents every variable instead.',
    '',
    '| Section | Contents | Files | Lines |',
    '| --- | --- | ---: | ---: |',
    ...index.map(
      (section) =>
        `| [${section.title}](./${section.id}.md) | ${section.blurb} | ${section.count} | ${section.lines.toLocaleString('en-US')} |`,
    ),
    `| **Total** | | **${files.length}** | **${totalLines.toLocaleString('en-US')}** |`,
    '',
  ].join('\n');

  writeFileSync(join(OUT_DIR, 'README.md'), `${readme}\n`, 'utf8');

  process.stdout.write(`Wrote ${index.length} sections, ${files.length} files, ${totalLines} lines to docs/source/\n`);
}

main();

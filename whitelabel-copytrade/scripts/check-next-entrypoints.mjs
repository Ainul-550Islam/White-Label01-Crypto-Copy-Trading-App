// # Responsibility: rejects conflicting Next.js request entrypoints, requires admin-web proxy.ts, and reports every offending path.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appsRoot = path.join(root, 'apps');
const skippedDirectories = new Set(['.git', '.next', 'build', 'coverage', 'dist', 'node_modules', 'out']);
const extensions = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'];
const entrypointStems = ['middleware', 'proxy'];
const errors = [];

function findNextApplications(directory) {
  const applications = [];
  const entries = fs.readdirSync(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || skippedDirectories.has(entry.name)) continue;

    const applicationRoot = path.join(directory, entry.name);
    const manifestPath = path.join(applicationRoot, 'package.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (manifest.dependencies?.next || manifest.devDependencies?.next || manifest.peerDependencies?.next) {
        applications.push({ root: applicationRoot, name: manifest.name ?? entry.name });
      }
    }

    applications.push(...findNextApplications(applicationRoot));
  }

  return applications;
}

function entrypointCandidates(applicationRoot) {
  const candidateRoots = [applicationRoot, path.join(applicationRoot, 'src')];
  return candidateRoots.flatMap((candidateRoot) =>
    entrypointStems.flatMap((stem) =>
      extensions.map((extension) => path.join(candidateRoot, `${stem}.${extension}`)),
    ),
  );
}

function existingEntrypoints(applicationRoot) {
  return entrypointCandidates(applicationRoot).filter((candidate) => fs.existsSync(candidate));
}

const applications = findNextApplications(appsRoot);
const adminRoot = path.join(appsRoot, 'admin-web');
const adminIsNextApplication = applications.some((application) => application.root === adminRoot);
const applicationsToCheck = applications.slice();

if (!adminIsNextApplication) {
  applicationsToCheck.push({ root: adminRoot, name: 'admin-web' });
}

for (const application of applicationsToCheck) {
  const files = existingEntrypoints(application.root);
  const middleware = files.filter((file) => path.basename(file).startsWith('middleware.'));
  const proxy = files.filter((file) => path.basename(file).startsWith('proxy.'));
  const relativeFiles = [...middleware, ...proxy]
    .map((file) => path.relative(root, file).split(path.sep).join('/'))
    .sort();
  const applicationPath = path.relative(root, application.root).split(path.sep).join('/');

  if (middleware.length > 0 && proxy.length > 0) {
    errors.push(`conflicting Next.js request entrypoints in ${applicationPath}: ${relativeFiles.join(', ')}`);
  }

  if (application.root === adminRoot && proxy.length === 0) {
    const expectedProxyPaths = entrypointCandidates(adminRoot)
      .filter((candidate) => path.basename(candidate).startsWith('proxy.'))
      .map((candidate) => path.relative(root, candidate).split(path.sep).join('/'));
    errors.push(`admin-web has no proxy entrypoint; checked: ${expectedProxyPaths.join(', ')}`);
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else {
  console.log('Next.js request entrypoints are valid.');
}

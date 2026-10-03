#!/usr/bin/env node
/**
 * API dependency-injection check: do the Nest application graphs resolve?
 *
 *     node scripts/check-api-di.mjs
 *
 * Two roots are checked, because the API image starts two processes:
 * `AppModule` (src/main.ts, the HTTP API) and `WorkerModule` (src/worker.ts,
 * the compose `worker` service). Round 8 added the second one after the worker
 * container was found unable to boot (a provider of RedisModule needed the
 * named Pino logger that only AppModule registered) - a failure no check saw.
 *
 * Type-checking cannot catch a provider that is missing from a module's
 * `providers`/`exports`, an import cycle that leaves a token undefined, or a
 * constructor that throws. Any of those stops `node dist/main.js` at boot.
 * This script finds them without a database, Redis or a full `nest build`:
 *
 *   1. every non-spec file under apps/api/src is transpiled (no type-check,
 *      decorator metadata on, exactly like the compiler's emit) into a
 *      temporary directory;
 *   2. a child process per root runs `NestFactory.create(<root>)`. That
 *      instantiates every provider of every module (the whole graph) but does
 *      not run onModuleInit or open a port, so nothing connects anywhere.
 *      (`createApplicationContext`, which src/worker.ts uses, builds the same
 *      graph but also runs the lifecycle hooks, which would connect to Redis.)
 *
 * Environment: values come from the real environment first, then from
 * .env.example. The three secrets that .env.example deliberately leaves empty
 * and the API refuses to start without get throw-away random values for this
 * run only; they are never printed or written anywhere.
 *
 * Needs `prisma generate` and `npm run build:packages` first (CI runs both
 * earlier in the same job). Exit 0 = graph resolves; 1 = it does not, with
 * Nest's own message naming the provider and the module.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API_SRC = join(ROOT, "apps", "api", "src");
const require = createRequire(join(ROOT, "apps", "api", "package.json"));
const ts = require("typescript");

/** Secrets .env.example leaves empty on purpose, with the shape the API validates. */
const EPHEMERAL_SECRETS = {
  ENCRYPTION_MASTER_KEY_BASE64: () => randomBytes(32).toString("base64"),
  BLIND_INDEX_KEY_BASE64: () => randomBytes(32).toString("base64"),
  DEVELOPER_SECRET_HMAC_KEY: () => randomBytes(24).toString("base64"),
};

function transpileTree(outRoot) {
  let files = 0;
  const problems = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const source = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(source);
        continue;
      }
      if (entry.name.endsWith(".spec.ts")) continue;
      const target = join(outRoot, "src", relative(API_SRC, source));
      mkdirSync(dirname(target), { recursive: true });
      if (!entry.name.endsWith(".ts")) {
        copyFileSync(source, target);
        continue;
      }
      const result = ts.transpileModule(readFileSync(source, "utf8"), {
        fileName: source,
        reportDiagnostics: true,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          resolveJsonModule: true,
        },
      });
      for (const diagnostic of result.diagnostics ?? []) {
        problems.push(
          `${relative(ROOT, source)}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`,
        );
      }
      writeFileSync(target.replace(/\.ts$/, ".js"), result.outputText, "utf8");
      files += 1;
    }
  };
  walk(API_SRC);
  return { files, problems };
}

function childEnvironment() {
  const env = { ...process.env };
  for (const line of readFileSync(join(ROOT, ".env.example"), "utf8").split(
    "\n",
  )) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && env[match[1]] === undefined)
      env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  for (const [name, make] of Object.entries(EPHEMERAL_SECRETS)) {
    if (!env[name]) env[name] = make();
  }
  env.NODE_ENV = "development";
  return env;
}

/**
 * The roots to resolve, with the environment their process really runs with
 * (the worker values mirror the compose `worker` service).
 */
const ROOTS = [
  { name: "AppModule", file: join("src", "app.module.js"), env: {} },
  {
    name: "WorkerModule",
    file: join("src", "modules", "worker", "worker.module.js"),
    env: {
      QUEUE_RUN_INLINE_WORKERS: "true",
      WORKER_ENABLED: "true",
      EXECUTION_ENGINE_URL: "http://execution-engine:8093",
      EXECUTION_ENGINE_TOKEN: () => randomBytes(32).toString("hex"),
    },
  },
];

const BOOT = `
require('reflect-metadata');
const { NestFactory, ModulesContainer } = require('@nestjs/core');
const Root = require(process.env.WLCT_DI_ROOT_FILE)[process.env.WLCT_DI_ROOT_NAME];
if (typeof Root !== 'function') {
  console.error('DI_FAIL ' + process.env.WLCT_DI_ROOT_NAME + ' is not exported by ' + process.env.WLCT_DI_ROOT_FILE);
  process.exit(1);
}
NestFactory.create(Root, { abortOnError: false, logger: ['error'] })
  .then((app) => {
    const modules = app.get(ModulesContainer);
    let providers = 0;
    for (const m of modules.values()) providers += m.providers.size;
    console.log('DI_OK ' + process.env.WLCT_DI_ROOT_NAME + ' modules=' + modules.size + ' providers=' + providers);
    process.exit(0);
  })
  .catch((error) => {
    console.error('DI_FAIL ' + (error && error.message ? error.message : String(error)));
    process.exit(1);
  });
`;

function main() {
  const outRoot = mkdtempSync(join(tmpdir(), "wlct-api-di-"));
  try {
    const { files, problems } = transpileTree(outRoot);
    if (problems.length > 0) {
      for (const problem of problems) console.error(`TRANSPILE: ${problem}`);
      return 1;
    }
    const bootFile = join(outRoot, "boot.cjs");
    writeFileSync(bootFile, BOOT, "utf8");
    let failed = 0;
    for (const root of ROOTS) {
      const env = childEnvironment();
      for (const [name, value] of Object.entries(root.env)) {
        env[name] = typeof value === "function" ? value() : value;
      }
      env.WLCT_DI_ROOT_FILE = join(outRoot, root.file);
      env.WLCT_DI_ROOT_NAME = root.name;
      // `src/*` is the API's tsconfig path alias; packages resolve from the workspace.
      env.NODE_PATH = [
        outRoot,
        join(ROOT, "apps", "api", "node_modules"),
        join(ROOT, "node_modules"),
      ].join(process.platform === "win32" ? ";" : ":");
      const child = spawnSync(process.execPath, [bootFile], {
        cwd: outRoot,
        env,
        encoding: "utf8",
        timeout: 180_000,
      });
      const output = `${child.stdout ?? ""}${child.stderr ?? ""}`;
      const verdict = output
        .split("\n")
        .find((line) => line.startsWith("DI_OK") || line.startsWith("DI_FAIL"));
      if (child.status === 0 && verdict?.startsWith("DI_OK")) {
        console.log(`${verdict} (${files} files transpiled)`);
        continue;
      }
      failed += 1;
      console.error(
        `${root.name}: ` +
          (output.trim() ||
            `boot process ended with status ${child.status} signal ${child.signal}`),
      );
    }
    return failed === 0 ? 0 : 1;
  } finally {
    rmSync(outRoot, { recursive: true, force: true });
  }
}

process.exit(main());

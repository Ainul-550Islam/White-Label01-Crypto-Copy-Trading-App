#!/usr/bin/env node
/**
 * Terraform <-> API env-schema alignment check.
 *
 * Reads the `environment` and `secrets` lists of the API container in
 * infra/production/terraform/main.tf, builds the environment the ECS task
 * would start with (literal values as written, Terraform expressions and
 * Secrets Manager references replaced by well-formed placeholders), and runs
 * it through the API's own production env schema (@wlct/config).
 *
 * It fails when the production task would be refused at boot - a required
 * variable Terraform never sets, a name spelled differently from the schema,
 * a relative path, a production-only rule - which is exactly how the task
 * definition drifted before (ENCRYPTION_KEY vs ENCRYPTION_MASTER_KEY_BASE64,
 * no REDIS_HOST, missing METRICS_TOKEN / INTERNAL_SERVICE_TOKEN).
 *
 * It also checks that absolute dataset directories configured for the task
 * are created in the API image (the runtime user cannot create them under
 * the root-owned /app).
 *
 * Needs `npm run build:packages` first (imports packages/config/dist).
 * Usage: node scripts/check-terraform-api-env.mjs
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const tfPath = join(root, "infra/production/terraform/main.tf");
const dockerfilePath = join(root, "infrastructure/docker/api.Dockerfile");
const tf = readFileSync(tfPath, "utf8");

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
}

// --- locate the API container definition ------------------------------------
const start = tf.indexOf('resource "aws_ecs_task_definition" "api"');
if (start < 0) {
  fail('aws_ecs_task_definition "api" not found in main.tf');
  process.exit(1);
}
const next = tf.indexOf("\nresource ", start + 10);
const block = tf.slice(start, next < 0 ? undefined : next);

function listBody(name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*\\[`).exec(block);
  if (!m) return "";
  let depth = 0;
  for (let i = m.index + m[0].length - 1; i < block.length; i += 1) {
    if (block[i] === "[") depth += 1;
    else if (block[i] === "]") {
      depth -= 1;
      if (depth === 0) return block.slice(m.index + m[0].length, i);
    }
  }
  return "";
}

const envBody = listBody("environment");
const secretsBody = listBody("secrets");
if (!envBody || !secretsBody) {
  fail("could not read the environment/secrets lists of the API container");
  process.exit(1);
}

// { name = "X", value = "literal" }  or  { name = "X", value = expression }
const envEntries = [
  ...envBody.matchAll(
    /\{\s*name\s*=\s*"([A-Z0-9_]+)"\s*,\s*value\s*=\s*([^}]+?)\s*\}/g,
  ),
].map(([, name, raw]) => {
  const literal = /^"([^"$]*)"$/.exec(raw.trim());
  return {
    name,
    literal: literal ? literal[1] : null,
    expr: literal ? null : raw.trim(),
  };
});
const secretNames = [
  ...secretsBody.matchAll(
    /\{\s*name\s*=\s*"([A-Z0-9_]+)"\s*,\s*valueFrom\s*=/g,
  ),
].map((m) => m[1]);

// --- placeholders for values Terraform / Secrets Manager provide -------------
const b64 = (seed) => Buffer.alloc(32, seed).toString("base64");
function secretPlaceholder(name, i) {
  if (name.endsWith("_BASE64")) return b64(i + 1);
  if (/DATABASE_URL$/.test(name))
    return "postgresql://app:placeholder@db.internal:5432/app?sslmode=require";
  if (name === "REDIS_URL") return "rediss://redis.internal:6379";
  if (name.endsWith("_KEY_ID")) return "key-placeholder-1";
  return `${name.toLowerCase()}_`.padEnd(64, "x");
}
function exprPlaceholder(name, expr) {
  if (name === "REDIS_HOST") return "redis.internal";
  if (/bucket/i.test(expr) || /BUCKET$/.test(name)) return "bucket-placeholder";
  if (/region/i.test(expr)) return "us-east-1";
  return "placeholder";
}

const env = {};
for (const e of envEntries)
  env[e.name] =
    e.literal !== null ? e.literal : exprPlaceholder(e.name, e.expr);
secretNames.forEach((n, i) => {
  env[n] = secretPlaceholder(n, i);
});

const dupes = [...envEntries.map((e) => e.name), ...secretNames].filter(
  (n, i, a) => a.indexOf(n) !== i,
);
if (dupes.length)
  fail(
    `defined more than once in the API task: ${[...new Set(dupes)].join(", ")}`,
  );
if (env.NODE_ENV !== "production")
  fail(`API task NODE_ENV is "${env.NODE_ENV}", expected "production"`);

// --- run the real schema -------------------------------------------------------
let config;
try {
  config = require(join(root, "packages/config/dist/env.schema.js"));
} catch (e) {
  console.error(
    "packages/config is not built - run `npm run build:packages` first.",
  );
  process.exit(2);
}
const schema =
  config.EnvSchema ??
  config.envSchema ??
  Object.values(config).find((v) => v && typeof v.safeParse === "function");
const result = schema.safeParse(env);
if (!result.success) {
  for (const issue of result.error.issues)
    fail(`${issue.path.join(".") || "(root)"}: ${issue.message}`);
}

// --- dataset directories must exist in the image ------------------------------
const dockerfile = readFileSync(dockerfilePath, "utf8");
for (const key of ["DATASET_LOCAL_ROOT", "DATASET_TEMP_ROOT"]) {
  const p = env[key];
  if (p && p.startsWith("/") && !dockerfile.includes(p)) {
    fail(
      `${key}=${p} is not created in infrastructure/docker/api.Dockerfile (runtime user cannot mkdir under /app)`,
    );
  }
}

if (!process.exitCode) {
  console.log(
    `terraform API task env valid for production: ${envEntries.length} plain + ${secretNames.length} secret variables`,
  );
}

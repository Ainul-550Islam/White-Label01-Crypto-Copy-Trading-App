// # Validates each ECS service task's runtime environment against its owning schema.
/**
 * Compare every non-API ECS task's Terraform environment and secret names with
 * the schema that service actually boots from. This is deliberately a static
 * contract check: it does not need cloud credentials or apply infrastructure.
 *
 * Run `npm run build:packages` first so the worker can be checked with the
 * exact @wlct/config Zod schema used by the API and worker entrypoints.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const terraformDir = resolve(root, "infra/production/terraform");
const require = createRequire(import.meta.url);
const sources = Object.fromEntries(
  ["services_apps.tf", "services_workers.tf", "services_engines.tf"].map(
    (file) => [file, readFileSync(resolve(terraformDir, file), "utf8")],
  ),
);
const mainTerraform = readFileSync(resolve(terraformDir, "main.tf"), "utf8");
const failures = [];
const INFRASTRUCTURE_ONLY = {
  web: new Set(["PORT", "HOSTNAME"]),
  "admin-web": new Set(["PORT", "HOSTNAME"]),
};
const SENSITIVE_NAME =
  /(?:_TOKEN|_PASSWORD|_SECRET|_KEY_BASE64|_HMAC_KEY|DATABASE_URL)$/u;

function report(message) {
  failures.push(message);
  console.error(`FAIL: ${message}`);
}

function matchingEnd(text, openAt, openChar, closeChar) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = openAt; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "#" || (char === "/" && next === "/")) {
      lineComment = true;
      if (char === "/") index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === openChar) depth += 1;
    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function assignmentBody(text, name, openChar) {
  const closeChar = openChar === "[" ? "]" : "}";
  const expression = new RegExp(`\\b${name}\\s*=\\s*\\${openChar}`);
  const match = expression.exec(text);
  if (!match) return null;
  const openAt = match.index + match[0].lastIndexOf(openChar);
  const closeAt = matchingEnd(text, openAt, openChar, closeChar);
  return closeAt < 0 ? null : text.slice(openAt + 1, closeAt);
}

function resourceBody(source, type, name) {
  const expression = new RegExp(`resource\\s+"${type}"\\s+"${name}"\\s*\\{`);
  const match = expression.exec(source);
  if (!match) return null;
  const openAt = match.index + match[0].lastIndexOf("{");
  const closeAt = matchingEnd(source, openAt, "{", "}");
  return closeAt < 0 ? null : source.slice(openAt + 1, closeAt);
}

function namedObjectBody(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(
    `(?:^|\\n)\\s*(?:"${escaped}"|${escaped})\\s*=\\s*\\{`,
    "u",
  );
  const match = expression.exec(source);
  if (!match) return null;
  const openAt = match.index + match[0].lastIndexOf("{");
  const closeAt = matchingEnd(source, openAt, "{", "}");
  return closeAt < 0 ? null : source.slice(openAt + 1, closeAt);
}

function objectItems(body) {
  const objects = [];
  let index = 0;
  while (index < body.length) {
    if (body[index] !== "{") {
      index += 1;
      continue;
    }
    const end = matchingEnd(body, index, "{", "}");
    if (end < 0) break;
    objects.push(body.slice(index + 1, end));
    index = end + 1;
  }
  return objects;
}

function namesFromEntries(body, entryKind) {
  if (body === null) return null;
  const entries = new Map();
  for (const item of objectItems(body)) {
    const name = /\bname\s*=\s*"([A-Z][A-Z0-9_]*)"/u.exec(item)?.[1];
    if (!name) continue;
    const hasValue = /\bvalue\s*=/u.test(item);
    const hasValueFrom = /\bvalueFrom\s*=/u.test(item);
    if (entryKind === "environment" && (!hasValue || hasValueFrom)) {
      report(`${name} is not a plain environment entry`);
    }
    if (entryKind === "secrets" && (!hasValueFrom || hasValue)) {
      report(
        `${name} must be supplied through a Secrets Manager valueFrom reference`,
      );
    }
    if (entries.has(name))
      report(`${name} is duplicated in a Terraform ${entryKind} list`);
    entries.set(name, item);
  }
  return entries;
}

function parseZodObject(source, declaration) {
  const start = source.indexOf(`const ${declaration} = z.object({`);
  if (start < 0) return null;
  const openAt = source.indexOf("{", start);
  const closeAt = matchingEnd(source, openAt, "{", "}");
  if (closeAt < 0) return null;
  const body = source.slice(openAt + 1, closeAt);
  const fields = [...body.matchAll(/^\s{2}([A-Z][A-Z0-9_]*)\s*:/gmu)];
  const names = new Set(fields.map((match) => match[1]));
  const required = new Set();
  fields.forEach((match, index) => {
    const nextStart = fields[index + 1]?.index ?? body.length;
    const fieldExpression = body.slice(match.index, nextStart);
    if (!/\.(?:default|optional)\s*\(/u.test(fieldExpression))
      required.add(match[1]);
  });
  return { names, required };
}

function mapNames(body) {
  if (body === null) return null;
  return new Set(
    [...body.matchAll(/^[ \t]*([A-Z][A-Z0-9_]*)\s*=/gmu)].map(
      (match) => match[1],
    ),
  );
}

function mapEntries(body) {
  if (body === null) return null;
  return new Map(
    [...body.matchAll(/^[ \t]*([A-Z][A-Z0-9_]*)\s*=\s*([^\n]+)$/gmu)].map(
      (match) => [match[1], match[2].trim()],
    ),
  );
}

function compareNames(
  service,
  supplied,
  schemaNames,
  requiredNames,
  infrastructureOnly = new Set(),
) {
  if (!supplied) {
    report(`${service}: Terraform environment/secrets cannot be read`);
    return;
  }
  const all = new Set([...supplied.environment, ...supplied.secrets]);
  const unknown = [...all].filter(
    (name) => !schemaNames.has(name) && !infrastructureOnly.has(name),
  );
  const missing = [...requiredNames].filter((name) => !all.has(name));
  if (unknown.length)
    report(
      `${service}: names absent from its schema: ${unknown.sort().join(", ")}`,
    );
  if (missing.length)
    report(
      `${service}: required schema settings missing: ${missing.sort().join(", ")}`,
    );
  for (const name of all) {
    if (SENSITIVE_NAME.test(name) && !supplied.secrets.has(name)) {
      report(
        `${service}: sensitive setting ${name} must be provided through Secrets Manager`,
      );
    }
  }
}

function taskEntries(source, resourceName) {
  const block = resourceBody(source, "aws_ecs_task_definition", resourceName);
  if (!block) return null;
  const environment = namesFromEntries(
    assignmentBody(block, "environment", "["),
    "environment",
  );
  const secrets = namesFromEntries(
    assignmentBody(block, "secrets", "["),
    "secrets",
  );
  if (!environment || !secrets) return null;
  return {
    environment: new Set(environment.keys()),
    secrets: new Set(secrets.keys()),
    raw: block,
  };
}

function readPythonFields(file) {
  const code = [
    "import ast, json, sys",
    "tree = ast.parse(open(sys.argv[1], encoding='utf-8').read())",
    "settings = next((node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'Settings'), None)",
    "if settings is None: raise SystemExit('Settings class not found')",
    "fields = {}",
    "for node in settings.body:",
    "    if not isinstance(node, ast.AnnAssign) or not isinstance(node.target, ast.Name): continue",
    "    name = node.target.id",
    "    if not name.isupper() or not name.replace('_', '').isalnum(): continue",
    "    value = node.value",
    "    required = value is None",
    "    if isinstance(value, ast.Call) and (getattr(value.func, 'id', None) == 'Field' or getattr(value.func, 'attr', None) == 'Field'):",
    "        required = not any(keyword.arg == 'default' for keyword in value.keywords) and not value.args",
    "    fields[name] = required",
    "print(json.dumps(fields))",
  ].join("\n");
  const result = spawnSync("python3", ["-c", code, file], { encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(
      result.stderr || result.stdout || `python3 could not parse ${file}`,
    );
  return JSON.parse(result.stdout);
}

function engineEntries(service) {
  const localsStart = sources["services_engines.tf"].indexOf(
    "internal_engines = {",
  );
  if (localsStart < 0) return null;
  const localOpen = sources["services_engines.tf"].indexOf("{", localsStart);
  const localEnd = matchingEnd(
    sources["services_engines.tf"],
    localOpen,
    "{",
    "}",
  );
  if (localEnd < 0) return null;
  const serviceBody = namedObjectBody(
    sources["services_engines.tf"].slice(localOpen + 1, localEnd),
    service,
  );
  if (!serviceBody) return null;
  const environment = namesFromEntries(
    assignmentBody(serviceBody, "environment", "["),
    "environment",
  );
  const secrets = namesFromEntries(
    assignmentBody(serviceBody, "secrets", "["),
    "secrets",
  );
  if (!environment || !secrets) return null;
  return {
    environment: new Set(environment.keys()),
    secrets: new Set(secrets.keys()),
  };
}

function terraformLiteral(entries, name, fallback) {
  const item = entries.get(name);
  if (!item) return fallback;
  const raw = /\bvalue\s*=\s*("(?:[^"\\]|\\.)*"|[^,\n}]+)/u
    .exec(item)?.[1]
    ?.trim();
  if (!raw) return fallback;
  const literal = /^"((?:[^"\\]|\\.)*)"$/u.exec(raw);
  return literal
    ? literal[1].replace(/\\"/gu, '"').replace(/\\\\/gu, "\\")
    : fallback;
}

function buildApiEnv(entries, secrets) {
  const env = {};
  for (const [name, item] of entries) {
    const raw = /\bvalue\s*=\s*("(?:[^"\\]|\\.)*"|[^,\n}]+)/u
      .exec(item)?.[1]
      ?.trim();
    const literal = raw && /^"((?:[^"\\]|\\.)*)"$/u.exec(raw);
    if (literal) {
      env[name] = literal[1].replace(/\\"/gu, '"').replace(/\\\\/gu, "\\");
    } else if (name === "AWS_REGION") {
      env[name] = "us-east-1";
    } else if (name === "REDIS_HOST") {
      env[name] = "redis.internal";
    } else {
      env[name] = "placeholder";
    }
  }
  let index = 1;
  for (const name of secrets.keys()) {
    if (name.endsWith("_BASE64"))
      env[name] = Buffer.alloc(32, index).toString("base64");
    else if (name === "DATABASE_URL" || name === "DIRECT_DATABASE_URL") {
      env[name] =
        "postgresql://app:placeholder@db.internal:5432/app?sslmode=require";
    } else if (name === "ENCRYPTION_KEY_ID") env[name] = "key-placeholder-1";
    else env[name] = `${name.toLowerCase()}_`.padEnd(64, "x");
    index += 1;
  }
  return env;
}

// --- exact API schema reused by the ECS worker -------------------------------
let apiEnvSchema;
try {
  const config = require(resolve(root, "packages/config/dist/env.schema.js"));
  apiEnvSchema =
    config.EnvSchema ??
    config.envSchema ??
    Object.values(config).find(
      (candidate) => candidate && typeof candidate.safeParse === "function",
    );
} catch (error) {
  console.error(
    "packages/config is not built; run `npm run build:packages` first.",
  );
  process.exit(2);
}
function unwrapZodObject(schema) {
  let current = schema;
  while (current && !current.shape && current._def?.schema)
    current = current._def.schema;
  return current?.shape ? current : null;
}
const apiObject = unwrapZodObject(apiEnvSchema);
if (!apiObject) {
  report("could not inspect @wlct/config envSchema object shape");
} else {
  const apiKeys = new Set(Object.keys(apiObject.shape));
  const apiRequired = new Set(
    Object.entries(apiObject.shape)
      .filter(([, field]) => !field.safeParse(undefined).success)
      .map(([name]) => name),
  );
  apiRequired.add("DEVELOPER_SECRET_HMAC_KEY");
  const worker = taskEntries(sources["services_workers.tf"], "worker");
  compareNames("worker", worker, apiKeys, apiRequired);
  if (worker) {
    for (const name of ["EXECUTION_ENGINE_TOKEN", "WORKER_ENABLED"]) {
      if (![...worker.environment, ...worker.secrets].includes(name)) {
        report(
          `worker: bootstrap setting ${name} is required by apps/api/src/worker.ts`,
        );
      }
    }
    const envItems = namesFromEntries(
      assignmentBody(worker.raw, "environment", "["),
      "environment",
    );
    const secretItems = namesFromEntries(
      assignmentBody(worker.raw, "secrets", "["),
      "secrets",
    );
    const workerEnv = buildApiEnv(envItems, secretItems);
    const parsed = apiEnvSchema.safeParse(workerEnv);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        report(
          `worker envSchema ${issue.path.join(".") || "(root)"}: ${issue.message}`,
        );
      }
    }
    for (const name of [
      "TRADING_ENGINE_URL",
      "EXECUTION_ENGINE_URL",
      "MARKET_DATA_URL",
      "NOTIFICATION_SERVICE_URL",
    ]) {
      if (
        !workerEnv[name]?.includes(".wlct.internal") ||
        /localhost|127\\.0\\.0\\.1/u.test(workerEnv[name])
      ) {
        report(
          `worker: ${name} must target private ECS service discovery, not a localhost default`,
        );
      }
    }
    if (
      worker.raw.includes('"node", "dist/worker.js"') &&
      !/workingDirectory\s*=\s*"\/app\/apps\/api"/u.test(worker.raw)
    ) {
      report(
        "worker: node dist/worker.js requires workingDirectory=/app/apps/api for the API image",
      );
    }
  }
}

// --- web and admin-web Zod schemas -------------------------------------------
const webSources = {
  web: readFileSync(resolve(root, "apps/web/src/lib/env.ts"), "utf8"),
  "admin-web": readFileSync(
    resolve(root, "apps/admin-web/src/lib/env.ts"),
    "utf8",
  ),
};
const webAppsSource = sources["services_apps.tf"];
const localAppsStart = webAppsSource.indexOf("web_apps = {");
const localAppsOpen =
  localAppsStart < 0 ? -1 : webAppsSource.indexOf("{", localAppsStart);
const localAppsEnd =
  localAppsOpen < 0 ? -1 : matchingEnd(webAppsSource, localAppsOpen, "{", "}");
if (localAppsEnd < 0) {
  report("web_apps: local service map is missing or malformed");
} else {
  const localApps = webAppsSource.slice(localAppsOpen + 1, localAppsEnd);
  for (const service of ["web", "admin-web"]) {
    const app = namedObjectBody(localApps, service);
    if (!app) {
      report(`${service}: local task contract is missing`);
      continue;
    }
    const schema = parseZodObject(webSources[service], "serverSchema");
    if (!schema) {
      report(`${service}: could not read its server-side Zod schema`);
      continue;
    }
    const environmentEntries = mapEntries(
      assignmentBody(app, "environment", "{"),
    );
    const secretEntries = mapEntries(assignmentBody(app, "secrets", "{"));
    if (!environmentEntries || !secretEntries) {
      report(`${service}: local environment/secrets map is missing`);
      continue;
    }
    compareNames(
      service,
      {
        environment: new Set(environmentEntries.keys()),
        secrets: new Set(secretEntries.keys()),
      },
      schema.names,
      schema.required,
      INFRASTRUCTURE_ONLY[service],
    );
    const apiBaseUrl = environmentEntries.get("API_BASE_URL") ?? "";
    if (
      !apiBaseUrl.includes('"https://api.${var.domain_name}/api"') ||
      /localhost|127\\.0\\.0\\.1/u.test(apiBaseUrl)
    ) {
      report(
        `${service}: API_BASE_URL must use the API's HTTPS ALB hostname, not a localhost default`,
      );
    }
    const sessionReference = secretEntries.get("SESSION_COOKIE_SECRET") ?? "";
    const expectedSessionResource =
      service === "web" ? "web_session" : "session";
    if (
      !sessionReference.includes(
        `aws_secretsmanager_secret.${expectedSessionResource}.arn`,
      )
    ) {
      report(
        `${service}: SESSION_COOKIE_SECRET must use its distinct ${expectedSessionResource} secret`,
      );
    }
  }
  if (
    !/environment\s*=\s*\[\s*for name, value in each\.value\.environment/u.test(
      webAppsSource,
    )
  ) {
    report(
      "web_apps: task definition must emit each service-specific environment map",
    );
  }
  if (
    !/secrets\s*=\s*\[\s*for name, value in each\.value\.secrets/u.test(
      webAppsSource,
    )
  ) {
    report(
      "web_apps: task definition must emit each service-specific Secrets Manager map",
    );
  }
}
if (
  !/web\s*=\s*\{[^}]*port\s*=\s*3001/su.test(webAppsSource) ||
  !/admin-web\s*=\s*\{[^}]*port\s*=\s*3000/su.test(webAppsSource)
) {
  report(
    "web_apps: web/admin port mappings must remain 3001 and 3000, matching their Docker images",
  );
}

// --- notification-service Zod schema -----------------------------------------
const notificationSource = readFileSync(
  resolve(root, "services/notification-service/src/config.ts"),
  "utf8",
);
const notificationSchema = parseZodObject(notificationSource, "schema");
const notification = taskEntries(
  sources["services_workers.tf"],
  "notification_service",
);
if (!notificationSchema)
  report("notification-service: could not read src/config.ts Zod schema");
else
  compareNames(
    "notification-service",
    notification,
    notificationSchema.names,
    notificationSchema.required,
  );

// --- Python Pydantic Settings schemas ----------------------------------------
for (const service of ["trading-engine", "execution-engine", "market-data"]) {
  const configPath = `services/${service}/app/config.py`;
  let fields;
  try {
    fields = readPythonFields(resolve(root, configPath));
  } catch (error) {
    report(`${service}: could not inspect ${configPath}: ${error.message}`);
    continue;
  }
  const supplied = engineEntries(service);
  const fieldNames = new Set(Object.keys(fields));
  const required = new Set(
    Object.entries(fields)
      .filter(([, isRequired]) => isRequired)
      .map(([name]) => name),
  );
  if (service === "execution-engine") required.add("EXECUTION_INTERNAL_TOKEN");
  compareNames(service, supplied, fieldNames, required);
}

// Ensure the ECS engine task actually consumes the per-engine environment and
// secret maps that were checked above instead of silently omitting them.
const enginesTask = resourceBody(
  sources["services_engines.tf"],
  "aws_ecs_task_definition",
  "engines",
);
if (
  !enginesTask ||
  !/environment\s*=\s*each\.value\.environment/u.test(enginesTask) ||
  !/secrets\s*=\s*each\.value\.secrets/u.test(enginesTask)
) {
  report(
    "engines: task definition must use each service's validated environment and secrets maps",
  );
}
const notificationEcsService = resourceBody(
  sources["services_workers.tf"],
  "aws_ecs_service",
  "notification_service",
);
if (
  !notificationEcsService ||
  !/service_registries\s*\{\s*registry_arn\s*=\s*aws_service_discovery_service\.notification\.arn/u.test(
    notificationEcsService,
  )
) {
  report(
    "notification-service: ECS service must register its private DNS discovery record",
  );
}
const webSessionPolicy = resourceBody(
  webAppsSource,
  "aws_iam_role_policy",
  "web_session_secret_read",
);
if (
  !webSessionPolicy ||
  !/aws_secretsmanager_secret\.web_session\.arn/u.test(webSessionPolicy)
) {
  report(
    "web: ECS execution-role policy must allow reading the dedicated web session secret",
  );
}

if (failures.length) process.exit(1);
console.log(
  "Terraform ECS environment and secret names match each service's checked schema; no undocumented environment-only names remain.",
);

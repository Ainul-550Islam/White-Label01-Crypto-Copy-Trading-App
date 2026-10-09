// # Generates docs/ENV_MATRIX.md from the central Zod environment schema and API config accessors.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_PATH = "packages/config/src/env.schema.ts";
const APP_CONFIG_PATH = "apps/api/src/config/app-config.service.ts";
const OUTPUT_PATH = "docs/ENV_MATRIX.md";
const CONDITIONAL_REQUIREMENTS = new Map([
  [
    "NODE_ENV",
    {
      development: "No",
      staging: "Required",
      production: "Required",
      notes:
        "Set explicitly to staging or production; omitting it selects development and skips production-only refinements.",
    },
  ],
  [
    "JWT_ACCESS_SECRET",
    {
      development: "Conditional",
      staging: "Conditional",
      production: "Conditional",
      notes:
        "Required when JWT_ALGORITHM is HS256 or HS512; HS256 is the schema default.",
    },
  ],
  [
    "JWT_REFRESH_SECRET",
    {
      development: "Conditional",
      staging: "Conditional",
      production: "Conditional",
      notes:
        "Required when JWT_ALGORITHM is HS256 or HS512; HS256 is the schema default.",
    },
  ],
  [
    "JWT_PRIVATE_KEY_BASE64",
    {
      development: "Conditional",
      staging: "Conditional",
      production: "Conditional",
      notes:
        "Required when JWT_ALGORITHM is RS256 or RS512; provide a matching public key.",
    },
  ],
  [
    "JWT_PUBLIC_KEY_BASE64",
    {
      development: "Conditional",
      staging: "Conditional",
      production: "Conditional",
      notes:
        "Required when JWT_ALGORITHM is RS256 or RS512; provide a matching private key.",
    },
  ],
  [
    "SWAGGER_PASSWORD",
    {
      development: "No",
      staging: "No",
      production: "Conditional",
      notes:
        "Required when NODE_ENV is production and SWAGGER_ENABLED is true (true by default).",
    },
  ],
  [
    "METRICS_TOKEN",
    {
      development: "No",
      staging: "No",
      production: "Required",
      notes: "Production validation requires a token for the metrics endpoint.",
    },
  ],
  [
    "OTEL_ENDPOINT",
    {
      development: "No",
      staging: "No",
      production: "Conditional",
      notes:
        "Required in production only when OTEL_ENABLED is true; the schema default is false.",
    },
  ],
  [
    "DATABASE_READ_URL",
    {
      development: "Conditional",
      staging: "Conditional",
      production: "Conditional",
      notes:
        "Required when DATABASE_READ_ENABLED is true; the URL is refused when the flag is false.",
    },
  ],
  [
    "DATASET_LOCAL_ROOT",
    {
      development: "No",
      staging: "No",
      production: "Required",
      notes:
        "Production requires an absolute path; the relative schema default fails validation.",
    },
  ],
  [
    "DATASET_TEMP_ROOT",
    {
      development: "No",
      staging: "No",
      production: "Required",
      notes:
        "Production requires an absolute path; the relative schema default fails validation.",
    },
  ],
  [
    "EXECUTION_ENGINE_TOKEN",
    {
      development: "Conditional",
      staging: "Conditional",
      production: "Conditional",
      notes:
        "Required when the API worker process is started; API/web/admin-only startup does not need it.",
    },
  ],
]);

const PROFILE_NOTES = new Map([
  [
    "DIRECT_DATABASE_URL",
    "Optional to envSchema, but Prisma migrate/generate need a direct URL; Compose injects the container-side value for its migration job.",
  ],
  [
    "JWT_ALGORITHM",
    "HS256 is the default and requires distinct 32-character access and refresh secrets; RS256/RS512 require a matching private/public key pair.",
  ],
  [
    "SWAGGER_ENABLED",
    "Swagger defaults on; production therefore requires SWAGGER_PASSWORD unless Swagger is explicitly disabled.",
  ],
  [
    "RISK_ENGINE_ENABLED",
    "Must remain true in production; the schema default is true and production refuses false.",
  ],
  [
    "OBSERVABILITY_ENABLED",
    "Must remain true in production; the schema default is true.",
  ],
  [
    "METRICS_ENABLED",
    "Must remain true in production; the schema default is true.",
  ],
  [
    "HEALTH_ENABLED",
    "Must remain true in production; the schema default is true.",
  ],
  [
    "PROMETHEUS_ENABLED",
    "Must remain true in production; the schema default is true.",
  ],
  [
    "ALERTING_ENABLED",
    "Must remain true in production; the schema default is true.",
  ],
  [
    "OTEL_ENABLED",
    "Defaults false; enabling tracing in production makes OTEL_ENDPOINT required.",
  ],
  [
    "FAILURE_INJECTION_ENABLED",
    "Must remain false in production; the schema default is false and production refuses it when enabled.",
  ],
  [
    "DATABASE_READ_ENABLED",
    "Defaults false; when enabled, DATABASE_READ_URL is required, and a URL without this flag is refused.",
  ],
  [
    "LIVE_TRADING_ENABLED",
    "Defaults false; enabling live execution requires EXECUTION_ENABLED=true, DRY_RUN=false, PAPER_TRADING=false, and EXCHANGE_SANDBOX_MODE=false.",
  ],
]);

const ALWAYS_SECRET_NAMES = new Set([
  "BLIND_INDEX_KEY_BASE64",
  "DATABASE_URL",
  "DIRECT_DATABASE_URL",
  "ENCRYPTION_MASTER_KEY_BASE64",
  "ENCRYPTION_PREVIOUS_KEYS_JSON",
]);
const NON_SECRET_NAMES = new Set(["CORS_CREDENTIALS", "PASSWORD_MIN_LENGTH"]);

function readSource(relativePath) {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

function parseTypeScript(relativePath, text) {
  const source = ts.createSourceFile(
    relativePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if (source.parseDiagnostics.length > 0) {
    const details = source.parseDiagnostics
      .map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      )
      .join("; ");
    throw new Error(`Could not parse ${relativePath}: ${details}`);
  }
  return source;
}

function findVariableInitializer(source, variableName) {
  let initializer;
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === variableName
    ) {
      initializer = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!initializer) {
    throw new Error(
      `Could not find variable ${variableName} in ${source.fileName}`,
    );
  }
  return initializer;
}

function findMethodCall(node, methodName) {
  let found;
  function visit(current) {
    if (
      !found &&
      ts.isCallExpression(current) &&
      ts.isPropertyAccessExpression(current.expression) &&
      current.expression.name.text === methodName
    ) {
      found = current;
      return;
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
  return found;
}

function findIdentifierCall(node, identifierName) {
  let found;
  function visit(current) {
    if (
      !found &&
      ts.isCallExpression(current) &&
      ts.isIdentifier(current.expression) &&
      current.expression.text === identifierName
    ) {
      found = current;
      return;
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
  return found;
}

function schemaProperties(source) {
  const envSchemaInitializer = findVariableInitializer(source, "envSchema");
  let objectLiteral;
  function visit(node) {
    if (
      !objectLiteral &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "z" &&
      node.expression.name.text === "object" &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      objectLiteral = node.arguments[0];
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(envSchemaInitializer);
  if (!objectLiteral) {
    throw new Error(
      `${SCHEMA_PATH} does not contain the envSchema z.object literal`,
    );
  }

  const entries = [];
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) {
      throw new Error(
        `Unsupported envSchema property in ${SCHEMA_PATH}: ${property.getText(source)}`,
      );
    }
    entries.push({
      name: property.name.text,
      initializer: property.initializer,
    });
  }
  const duplicates = entries
    .map((entry) => entry.name)
    .filter((name, index, all) => all.indexOf(name) !== index);
  if (duplicates.length > 0) {
    throw new Error(
      `Duplicate envSchema fields: ${[...new Set(duplicates)].join(", ")}`,
    );
  }
  return entries;
}

function literalText(node, source) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return JSON.stringify(node.text);
  }
  if (
    ts.isNumericLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword
  ) {
    return node.getText(source);
  }
  return node.getText(source).replace(/\s+/g, " ").trim();
}

function helperDefaults(source) {
  const jsonRecordInitializer = findVariableInitializer(source, "jsonRecord");
  const jsonRecordDefault = findMethodCall(jsonRecordInitializer, "default");
  if (!jsonRecordDefault || !jsonRecordDefault.arguments[0]) {
    throw new Error("The jsonRecord helper must declare an explicit default");
  }
  return new Map([
    ["jsonRecord", literalText(jsonRecordDefault.arguments[0], source)],
  ]);
}

function typeFor(initializer, source) {
  const normalized = initializer.getText(source).replace(/\s+/g, "");
  const helperCall = findIdentifierCall(initializer, "intFromString");
  if (helperCall) return "integer";
  if (normalized.includes("booleanFromString")) return "boolean";
  if (findIdentifierCall(initializer, "decimalFromString"))
    return "decimal string";
  if (findIdentifierCall(initializer, "csv")) return "comma-separated list";
  if (
    findIdentifierCall(initializer, "jsonRecord") ||
    normalized === "jsonRecord"
  )
    return "JSON object";
  if (normalized.includes("NodeEnvSchema")) return "enum";
  if (normalized.includes("z.enum(")) return "enum";
  if (
    normalized.includes("z.coerce.number(") ||
    normalized.includes("z.number(")
  )
    return "number";
  if (normalized.includes("z.boolean(")) return "boolean";
  if (normalized.includes("z.string(")) return "string";
  if (normalized.includes("z.array(")) return "array";
  if (normalized.includes("z.record(") || normalized.includes("z.object("))
    return "JSON object";
  throw new Error(
    `Could not infer the environment type from: ${initializer.getText(source)}`,
  );
}

function defaultFor(initializer, source, helperDefaultValues) {
  const chainedDefault = findMethodCall(initializer, "default");
  if (chainedDefault) {
    if (!chainedDefault.arguments[0]) {
      throw new Error(
        `A default() call has no value: ${initializer.getText(source)}`,
      );
    }
    return literalText(chainedDefault.arguments[0], source);
  }

  for (const helperName of ["intFromString", "decimalFromString", "csv"]) {
    const helperCall = findIdentifierCall(initializer, helperName);
    if (helperCall) {
      if (!helperCall.arguments[0]) {
        throw new Error(
          `${helperName} must receive its default as the first argument`,
        );
      }
      return literalText(helperCall.arguments[0], source);
    }
  }

  const identifierCall = findIdentifierCall(initializer, "jsonRecord");
  if (
    identifierCall ||
    (ts.isIdentifier(initializer) && initializer.text === "jsonRecord")
  ) {
    return helperDefaultValues.get("jsonRecord");
  }

  return null;
}

function isOptional(initializer) {
  return Boolean(
    findMethodCall(initializer, "optional") ||
    findMethodCall(initializer, "nullish"),
  );
}

function appConfigFields(source) {
  const text = source.getFullText();
  const fields = new Set();
  for (const match of text.matchAll(/this\.env\.([A-Z][A-Z0-9_]*)/g)) {
    fields.add(match[1]);
  }
  for (const match of text.matchAll(
    /configService\.get(?:<[^>]+>)?\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
  )) {
    fields.add(match[1]);
  }
  return fields;
}

function isSecret(name) {
  if (NON_SECRET_NAMES.has(name)) return false;
  if (ALWAYS_SECRET_NAMES.has(name)) return true;
  if (
    name.startsWith("SECRET_MANAGER_") &&
    !/(?:TOKEN|PASSWORD|SECRET_KEY)/.test(name)
  )
    return false;
  return /(?:^|_)(?:SECRET|PASSWORD|TOKEN|PRIVATE_KEY|API_KEY|SERVER_KEY|ACCESS_KEY|AUTH_TOKEN|PEPPER|CREDENTIALS?)(?:_|$)/.test(
    name,
  );
}

function ownerFor(name, accessorFields) {
  if (name.startsWith("WORKER_") || name === "EXECUTION_ENGINE_TOKEN")
    return "API worker";
  if (name === "EXECUTION_ENGINE_URL") return "API worker";
  if (
    name === "DATABASE_URL" ||
    name === "DIRECT_DATABASE_URL" ||
    name.startsWith("DATABASE_READ_") ||
    name.startsWith("REDIS_")
  ) {
    return "API and worker";
  }
  if (/^(TRADING_ENGINE|MARKET_DATA|NOTIFICATION_SERVICE)_/.test(name))
    return "API service clients";
  if (/^(MAIL_|SMTP_|NOTIFICATIONS_|FIREBASE_|TELEGRAM_|TWILIO_)/.test(name)) {
    return "API notifications";
  }
  if (/^(KYC_|AML_|COMPLIANCE_)/.test(name)) return "API compliance";
  if (/^(BILLING_|STRIPE_|NOWPAYMENTS_|TAX_|PAYOUT_)/.test(name))
    return "API billing";
  if (
    /^(RISK_|MAX_|ORDER_|EXECUTION_|LIVE_TRADING_|DRY_RUN|PAPER_TRADING|STRATEGY_|SIGNAL_|BACKTEST_|DATASET_)/.test(
      name,
    )
  ) {
    return "API trading and risk";
  }
  return accessorFields.has(name) ? "API configuration" : "API feature module";
}

function requiredProfiles(field, hasDefault, optional) {
  const baseline = hasDefault || optional ? "No" : "Required";
  const result = {
    development: baseline,
    staging: baseline,
    production: baseline,
    notes: PROFILE_NOTES.get(field.name) ?? "",
  };

  const conditional = CONDITIONAL_REQUIREMENTS.get(field.name);
  if (conditional) {
    return { ...result, ...conditional };
  }
  return result;
}

function escapeTableCell(value) {
  return String(value).replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

function codeCell(value) {
  const escaped = escapeTableCell(value).replace(/`/g, "\\`");
  return `\`${escaped}\``;
}

function buildRows(schemaSource, appConfigSource) {
  const entries = schemaProperties(schemaSource);
  const helperDefaultValues = helperDefaults(schemaSource);
  const accessors = appConfigFields(appConfigSource);
  const names = new Set(entries.map((entry) => entry.name));
  const missing = [...accessors].filter((name) => !names.has(name)).sort();
  if (missing.length > 0) {
    throw new Error(
      `AppConfigService references fields absent from envSchema: ${missing.join(", ")}`,
    );
  }

  return entries.map((entry) => {
    const value = defaultFor(
      entry.initializer,
      schemaSource,
      helperDefaultValues,
    );
    const optional = isOptional(entry.initializer);
    const profiles = requiredProfiles(entry, value !== null, optional);
    return {
      name: entry.name,
      type: typeFor(entry.initializer, schemaSource),
      development: profiles.development,
      staging: profiles.staging,
      production: profiles.production,
      defaultValue:
        value === null ? (optional ? "not set (optional)" : "none") : value,
      secret: isSecret(entry.name) ? "Yes" : "No",
      owner: ownerFor(entry.name, accessors),
      notes: profiles.notes,
    };
  });
}

function renderMatrix() {
  const schemaSource = parseTypeScript(SCHEMA_PATH, readSource(SCHEMA_PATH));
  const appConfigSource = parseTypeScript(
    APP_CONFIG_PATH,
    readSource(APP_CONFIG_PATH),
  );
  const rows = buildRows(schemaSource, appConfigSource);
  const alwaysRequired = rows.filter(
    (row) =>
      row.development === "Required" &&
      row.staging === "Required" &&
      row.production === "Required",
  ).length;
  const appConfigCount = appConfigFields(appConfigSource).size;
  const lines = [
    "# Environment variable matrix",
    "",
    "Generated from `packages/config/src/env.schema.ts` and `apps/api/src/config/app-config.service.ts` by `node scripts/gen-env-matrix.mjs`. Do not edit this file by hand.",
    "",
    `The matrix contains ${rows.length} API schema fields; ${appConfigCount} are exposed through AppConfigService, and ${alwaysRequired} are unconditionally required by the shared schema. Frontend server settings are validated by the web/admin configuration modules and remain listed in their app-specific env examples and the root env example.`,
    "",
    "`Required` means an explicit value is needed for that profile (including overriding a default that fails profile validation). `No` means the schema supplies a usable default or treats the setting as optional. `Conditional` means a cross-field or process-specific rule applies; see Notes. Set NODE_ENV explicitly to staging or production to select those profiles. Production-only refinements run only when NODE_ENV=production; staging otherwise has the shared schema requirements.",
    "",
    "| Name | Type | Required in development | Required in staging | Required in production | Default | Secret? | Owner service | Notes |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const row of rows) {
    lines.push(
      `| ${codeCell(row.name)} | ${escapeTableCell(row.type)} | ${row.development} | ${row.staging} | ${row.production} | ${row.defaultValue === "none" || row.defaultValue === "not set (optional)" ? escapeTableCell(row.defaultValue) : codeCell(row.defaultValue)} | ${row.secret} | ${escapeTableCell(row.owner)} | ${escapeTableCell(row.notes || "—")} |`,
    );
  }
  lines.push("");
  return {
    content: lines.join("\n"),
    rowCount: rows.length,
    accessorCount: appConfigCount,
  };
}

function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const unknown = args.filter((arg) => arg !== "--check");
  if (unknown.length > 0) {
    throw new Error(`Unknown argument: ${unknown.join(" ")}`);
  }

  const { content, rowCount, accessorCount } = renderMatrix();
  const output = resolve(ROOT, OUTPUT_PATH);
  if (checkOnly) {
    let current = "";
    try {
      current = readFileSync(output, "utf8");
    } catch {
      current = "";
    }
    if (current !== content) {
      console.error(
        `${OUTPUT_PATH} is stale. Regenerate it with: node scripts/gen-env-matrix.mjs`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      `${OUTPUT_PATH} is current (${rowCount} API fields; ${accessorCount} AppConfigService accessors).`,
    );
    return;
  }

  writeFileSync(output, content, "utf8");
  console.log(
    `Generated ${OUTPUT_PATH} (${rowCount} API fields; ${accessorCount} AppConfigService accessors).`,
  );
}

try {
  main();
} catch (error) {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exitCode = 1;
}

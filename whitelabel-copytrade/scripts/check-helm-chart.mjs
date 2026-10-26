// # Statically validates chart values and hardening invariants without requiring Helm or a cluster.
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const chart = resolve(root, "infra/production/helm/wlct");
const errors = [];
const fail = (file, message) => errors.push(`${file}: ${message}`);
const loadYaml = (path) => {
  try {
    return yaml.load(readFileSync(path, "utf8"));
  } catch (error) {
    fail(path, `invalid YAML: ${error.message}`);
    return null;
  }
};
const valuesFile = join(chart, "values.yaml");
const values = loadYaml(valuesFile);
const chartMeta = loadYaml(join(chart, "Chart.yaml"));
const schemaFile = join(chart, "values.schema.json");
let schema;
try {
  schema = JSON.parse(readFileSync(schemaFile, "utf8"));
} catch (error) {
  fail(schemaFile, `invalid JSON schema: ${error.message}`);
}
if (
  !chartMeta ||
  chartMeta.apiVersion !== "v2" ||
  chartMeta.type !== "application"
)
  fail("Chart.yaml", "expected a Helm v2 application chart");
const expected = [
  "api",
  "worker",
  "web",
  "adminWeb",
  "tradingEngine",
  "executionEngine",
  "marketData",
  "notificationService",
];
if (values && schema) {
  for (const key of schema.required ?? [])
    if (!(key in values)) fail("values.yaml", `missing required key ${key}`);
  for (const key of expected) {
    const item = values.services?.[key];
    if (!item) {
      fail("values.yaml", `missing workload services.${key}`);
      continue;
    }
    if (!item.image || !item.tag || ["latest", "main"].includes(item.tag))
      fail("values.yaml", `services.${key} must use an immutable image tag`);
    if (!Number.isInteger(item.replicas) || item.replicas < 1)
      fail("values.yaml", `services.${key}.replicas must be at least one`);
    if (!item.secretRef || !String(item.secretRef).trim())
      fail("values.yaml", `services.${key}.secretRef must not be empty`);
    if (
      !item.resources?.limits?.cpu ||
      !item.resources?.limits?.memory ||
      !item.resources?.requests?.cpu ||
      !item.resources?.requests?.memory
    )
      fail(
        "values.yaml",
        `services.${key} requires CPU/memory requests and limits`,
      );
  }
  for (const key of ["postgres", "redis"]) {
    if (!values.external?.[key]?.secretRef?.trim())
      fail("values.yaml", `external.${key}.secretRef must not be empty`);
    if (!values.external?.[key]?.host?.trim())
      fail("values.yaml", `external.${key}.host is required`);
  }
  if (!values.ingress?.tlsSecretName?.trim())
    fail("values.yaml", "ingress.tlsSecretName must not be empty");
}
const templateDir = join(chart, "templates");
const templateFiles = readdirSync(templateDir).filter((name) =>
  name.endsWith(".yaml"),
);
const workloadFiles = [
  "api-deployment.yaml",
  "worker-deployment.yaml",
  "web-deployment.yaml",
  "admin-web-deployment.yaml",
  "engines-deployments.yaml",
  "migrate-job.yaml",
];
for (const name of workloadFiles) {
  const path = join(templateDir, name);
  if (!templateFiles.includes(name)) {
    fail(path, "workload template is missing");
    continue;
  }
  const source = readFileSync(path, "utf8");
  const probeChecks =
    name === "migrate-job.yaml"
      ? []
      : [
          ["startup probe", /startupProbe:/],
          ["readiness probe", /readinessProbe:/],
          ["liveness probe", /livenessProbe:/],
        ];
  for (const [label, pattern] of [
    ...probeChecks,
    ["resource limits", /resources:\s*\{\{-\s*toYaml[^\n]*resources/],
    ["non-root securityContext", /runAsNonRoot:\s*true/],
    ["read-only root filesystem", /readOnlyRootFilesystem:\s*true/],
    ["drop ALL capabilities", /drop:\s*\[ALL\]/],
  ])
    if (!pattern.test(source)) fail(path, `missing ${label}`);
  if (/kind:\s*Secret/.test(source))
    fail(
      path,
      "charts must reference pre-created Secrets and never create secret values",
    );
  if (/password:\s*[^\s{][^\n]*/i.test(source))
    fail(path, "possible inline secret value detected");
}
for (const name of [
  "ingress.yaml",
  "services.yaml",
  "networkpolicy.yaml",
  "hpa.yaml",
  "pdb.yaml",
]) {
  if (!templateFiles.includes(name))
    fail(join(templateDir, name), "required chart template is missing");
}
const networkPolicy = readFileSync(
  join(templateDir, "networkpolicy.yaml"),
  "utf8",
);
for (const [label, expression] of [
  ["default-deny ingress and egress", /policyTypes:\s*\[Ingress, Egress\]/],
  [
    "engine ingress source restriction",
    /name: .*engine-ingress[\s\S]*component: api[\s\S]*component: worker/,
  ],
  ["DNS-only resolver egress", /port: 53/],
  ["PostgreSQL egress", /external\.postgres\.port/],
  ["Redis egress", /external\.redis\.port/],
  ["venue HTTPS egress", /port: 443/],
])
  if (!expression.test(networkPolicy))
    fail("networkpolicy.yaml", `missing ${label}`);
const forbiddenDatabaseKinds = templateFiles.some((name) =>
  /kind:\s*(StatefulSet|Deployment)[\s\S]{0,500}image:\s*(postgres|redis):/i.test(
    readFileSync(join(templateDir, name), "utf8"),
  ),
);
if (forbiddenDatabaseKinds)
  fail(
    "templates",
    "in-chart PostgreSQL/Redis is forbidden; use external services",
  );
if (errors.length) {
  for (const error of errors) console.error(`FAIL ${error}`);
  process.exit(1);
}
console.log(
  `Helm chart static checks passed (${expected.length} workloads, ${templateFiles.length} templates).`,
);

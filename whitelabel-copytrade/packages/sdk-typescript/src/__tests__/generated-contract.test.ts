// # Guards generated TypeScript path/event contracts against OpenAPI and webhook documentation drift.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { DEVELOPER_EVENT_TYPES } from "../generated/event-types";

const sdkRoot = resolve(__dirname, "../..");
const repositoryRoot = resolve(sdkRoot, "../..");
const openapi = JSON.parse(
  readFileSync(resolve(repositoryRoot, "docs/openapi/openapi.json"), "utf8"),
) as {
  paths: Record<string, unknown>;
  components: {
    schemas: {
      DeveloperWebhookEventEnvelope: {
        properties: { eventType: { enum: string[] } };
      };
    };
  };
};
const generatedSchema = readFileSync(
  resolve(sdkRoot, "src/generated/schema.d.ts"),
  "utf8",
);
const clientSource = readFileSync(resolve(sdkRoot, "src/client.ts"), "utf8");
const webhookDocs = readFileSync(
  resolve(repositoryRoot, "docs/WEBHOOK_EVENTS.md"),
  "utf8",
);

test("every developer-platform path wrapped by the SDK has a generated OpenAPI path type", () => {
  const wrapped = [
    ...clientSource.matchAll(
      /(?:'|\")((?:\/developer-platform)[^'\"]+)(?:'|\")|`((?:\/developer-platform)[^`]+)`/g,
    ),
  ]
    .map((match) => match[1] ?? match[2])
    .map((path) => path.replace(/\$\{[^}]+\}/g, "{}"));
  const generatedPaths = Object.keys(openapi.paths)
    .filter(
      (path) =>
        generatedSchema.includes(JSON.stringify(path)) ||
        generatedSchema.includes(`"${path}"`),
    )
    .map((path) => path.replace(/^\/api\/v\d+/, ""));
  for (const sdkPath of wrapped) {
    const matches = generatedPaths.some((path) => {
      const sdkSegments = sdkPath.split("/");
      const openapiSegments = path.split("/");
      return (
        sdkSegments.length === openapiSegments.length &&
        sdkSegments.every((segment, index) =>
          segment === "{}"
            ? /^\{[^}]+\}$/.test(openapiSegments[index])
            : segment === openapiSegments[index],
        )
      );
    });
    assert.ok(
      matches,
      `SDK route lacks generated OpenAPI path type: ${sdkPath}`,
    );
  }
});

test("generated event union exactly covers OpenAPI and docs/WEBHOOK_EVENTS.md", () => {
  const fromOpenApi =
    openapi.components.schemas.DeveloperWebhookEventEnvelope.properties
      .eventType.enum;
  const fromDocs = [...webhookDocs.matchAll(/^\| `([^`]+)` \|/gm)].map(
    (match) => match[1],
  );
  assert.deepEqual([...DEVELOPER_EVENT_TYPES].sort(), [...fromOpenApi].sort());
  assert.deepEqual([...DEVELOPER_EVENT_TYPES].sort(), fromDocs.sort());
});

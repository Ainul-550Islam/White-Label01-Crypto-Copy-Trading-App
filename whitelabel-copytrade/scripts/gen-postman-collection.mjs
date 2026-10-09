// # NEW — Generates a Postman collection and variables from the committed OpenAPI contract

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const openApiPath = resolve(repositoryRoot, 'docs/openapi/openapi.json');
const collectionPath = resolve(repositoryRoot, 'docs/openapi/wlct.postman_collection.json');
const checkOnly = process.argv.includes('--check');

function resolveSchema(document, schema, depth = 0) {
  if (!schema || depth > 20) return {};
  if (schema.$ref) {
    const parts = schema.$ref.replace(/^#\//, '').split('/');
    let current = document;
    for (const part of parts) current = current?.[part];
    return resolveSchema(document, current, depth + 1);
  }
  if (schema.oneOf?.length) return resolveSchema(document, schema.oneOf[0], depth + 1);
  if (schema.anyOf?.length) return resolveSchema(document, schema.anyOf[0], depth + 1);
  if (schema.allOf?.length) {
    return Object.assign({}, ...schema.allOf.map((part) => resolveSchema(document, part, depth + 1)));
  }
  return schema;
}

function exampleFor(document, originalSchema, depth = 0) {
  if (!originalSchema || depth > 12) return null;
  const schema = resolveSchema(document, originalSchema);
  if (schema.example !== undefined) return schema.example;
  if (Array.isArray(schema.examples) && schema.examples.length > 0) return schema.examples[0];
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  if (schema.type === 'array') {
    if (!schema.items) return [];
    return [exampleFor(document, schema.items, depth + 1)];
  }
  if (schema.type === 'object' || schema.properties) {
    const properties = schema.properties ?? {};
    const required = new Set(schema.required ?? Object.keys(properties));
    return Object.fromEntries(
      Object.entries(properties)
        .filter(([name]) => required.has(name))
        .map(([name, property]) => [name, exampleFor(document, property, depth + 1)]),
    );
  }
  if (schema.type === 'boolean') return false;
  if (schema.type === 'integer' || schema.type === 'number') return 0;
  if (schema.nullable) return null;
  if (schema.type === 'string') {
    if (schema.format === 'date-time') return '2026-10-09T00:00:00.000Z';
    if (schema.format === 'uuid') return '11111111-1111-4111-8111-111111111111';
    return schema.minLength > 0 ? 'example' : '';
  }
  return null;
}

function buildCollection(document) {
  const grouped = new Map();
  const paths = Object.entries(document.paths ?? {}).sort(([left], [right]) => left.localeCompare(right));

  for (const [path, pathItem] of paths) {
    for (const [method, operation] of Object.entries(pathItem ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
      if (!['get', 'post', 'put', 'patch', 'delete', 'options', 'head'].includes(method.toLowerCase())) continue;
      const tags = Array.isArray(operation.tags) && operation.tags.length > 0 ? operation.tags : ['API'];
      const folderName = tags[0];
      const folder = grouped.get(folderName) ?? [];
      const route = path.replace(/\{([^}]+)\}/g, ':$1');
      const pathVariables = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => ({
        key: match[1],
        value: `set-${match[1]}`,
        description: `Path parameter ${match[1]}`,
      }));
      const queryParameters = [
        ...(pathItem.parameters ?? []),
        ...(operation.parameters ?? []),
      ]
        .filter((parameter) => parameter.in === 'query')
        .map((parameter) => ({
          key: parameter.name,
          value: parameter.example === undefined ? `set-${parameter.name}` : String(parameter.example),
          description: parameter.description ?? `Query parameter ${parameter.name}`,
          disabled: parameter.required !== true,
        }));
      const url = { raw: `{{baseUrl}}${route}`, variable: pathVariables };
      if (queryParameters.length > 0) url.query = queryParameters;

      const headers = [
        { key: 'Accept', value: 'application/json' },
        { key: 'X-Tenant-Slug', value: '{{tenantSlug}}', type: 'text' },
      ];
      const request = {
        method: method.toUpperCase(),
        header: headers,
        url,
        description: operation.description ?? operation.summary ?? `${method.toUpperCase()} ${path}`,
      };
      const bodySchema = operation.requestBody?.content?.['application/json']?.schema;
      if (bodySchema) {
        const sample = exampleFor(document, bodySchema);
        request.header.push({ key: 'Content-Type', value: 'application/json', type: 'text' });
        request.body = {
          mode: 'raw',
          raw: JSON.stringify(sample ?? {}, null, 2),
          options: { raw: { language: 'json' } },
        };
      }

      folder.push({
        name: operation.summary ?? operation.operationId ?? `${method.toUpperCase()} ${path}`,
        request,
      });
      grouped.set(folderName, folder);
    }
  }

  return {
    info: {
      name: 'WLCT Developer Platform API',
      description: 'Generated from docs/openapi/openapi.json. Do not edit this collection directly.',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      version: '1.0.0',
    },
    auth: {
      type: 'bearer',
      bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }],
    },
    variable: [
      { key: 'baseUrl', value: 'http://localhost:4000', type: 'string' },
      { key: 'tenantSlug', value: 'demo', type: 'string' },
      { key: 'accessToken', value: '', type: 'string' },
    ],
    item: [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, item]) => ({ name, item })),
  };
}

let document;
try {
  document = JSON.parse(await readFile(openApiPath, 'utf8'));
} catch (error) {
  process.stderr.write(`Unable to read docs/openapi/openapi.json: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

const generated = `${JSON.stringify(buildCollection(document), null, 2)}\n`;
if (checkOnly) {
  let current;
  try {
    current = await readFile(collectionPath, 'utf8');
  } catch {
    process.stderr.write('docs/openapi/wlct.postman_collection.json is missing; regenerate the OpenAPI artifacts.\n');
    process.exit(1);
  }
  if (current !== generated) {
    process.stderr.write('docs/openapi/wlct.postman_collection.json is stale; regenerate and commit the OpenAPI artifacts.\n');
    process.exit(1);
  }
  process.stdout.write(`Postman collection is current (${Object.keys(document.paths ?? {}).length} OpenAPI paths).\n`);
} else {
  await writeFile(collectionPath, generated, 'utf8');
  process.stdout.write(`Wrote Postman collection (${Object.keys(document.paths ?? {}).length} OpenAPI paths).\n`);
}

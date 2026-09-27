import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';

import { AppConfigService } from './app-config.service';
import {
  HEADER_DEVICE_ID,
  HEADER_IDEMPOTENCY_KEY,
  HEADER_REQUEST_ID,
  HEADER_TENANT_SLUG,
  HEADER_TWO_FACTOR_TOKEN,
} from '@wlct/config';

/**
 * OpenAPI documentation.
 *
 * Two deliberate decisions:
 *  1. Swagger is opt-in via SWAGGER_ENABLED and defaults to off in production.
 *     An accurate map of every endpoint is a gift to an attacker.
 *  2. When it *is* enabled in a production-like environment, it sits behind
 *     HTTP basic auth compared in constant time, so enabling docs temporarily
 *     for a partner does not expose the surface to the whole internet.
 */
export function setupSwagger(app: INestApplication, config: AppConfigService): void {
  if (!config.swaggerEnabled) {
    return;
  }

  if (config.isProduction) {
    applyDocsBasicAuth(app, config);
  }

  const builder = new DocumentBuilder()
    .setTitle(config.swaggerTitle)
    .setDescription(buildDescription(config))
    .setVersion(config.swaggerVersion)
    .setContact('Platform engineering', config.publicUrl, '')
    .setLicense('Proprietary', '')
    .addServer(config.publicUrl, 'Configured public URL')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        in: 'header',
        description:
          'Access token returned by POST /v1/auth/login. Short lived; refresh with POST /v1/auth/refresh.',
      },
      'access-token',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: HEADER_TENANT_SLUG,
        in: 'header',
        description:
          'Selects the organisation for unauthenticated requests. Ignored once a JWT is present - the token is always authoritative.',
      },
      'tenant-slug',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: HEADER_TWO_FACTOR_TOKEN,
        in: 'header',
        description: 'Two-factor challenge token issued by the login endpoint.',
      },
      'two-factor-token',
    )
    .addGlobalParameters(
      {
        name: HEADER_DEVICE_ID,
        in: 'header',
        required: false,
        description: 'Stable per-installation device identifier used for session binding.',
        schema: { type: 'string', maxLength: 128 },
      },
      {
        name: HEADER_REQUEST_ID,
        in: 'header',
        required: false,
        description: 'Client-supplied correlation id. Echoed back on every response.',
        schema: { type: 'string', format: 'uuid' },
      },
      {
        name: HEADER_IDEMPOTENCY_KEY,
        in: 'header',
        required: false,
        description: 'Idempotency key for unsafe operations that must not be applied twice.',
        schema: { type: 'string', maxLength: 128 },
      },
    )
    .addTag('Health', 'Liveness, readiness and operator probes')
    .addTag('Auth', 'Registration, login, refresh rotation and password management')
    .addTag('Two-factor authentication', 'TOTP enrolment, confirmation and recovery codes')
    .addTag('Sessions', 'Device and session management')
    .addTag('Users', 'User directory and profile administration')
    .addTag('Tenants', 'Organisation provisioning, branding, settings and domains')
    .addTag('RBAC - roles', 'Role definitions and assignment')
    .addTag('RBAC - permissions', 'The permission catalogue')
    .addTag('Feature flags', 'Per-tenant capability toggles')
    .addTag('Billing - plans', 'Subscription plan catalogue')
    .addTag('Billing - subscription', 'Tenant subscription lifecycle')
    .addTag('Notifications', 'Notification inbox and channel preferences')
    .addTag('Audit', 'Immutable audit trail')
    .addTag('Security', 'Security events and suspicious activity');

  const document: OpenAPIObject = SwaggerModule.createDocument(app, builder.build(), {
    deepScanRoutes: true,
    operationIdFactory: (controllerKey: string, methodKey: string) =>
      `${controllerKey.replace(/Controller$/, '')}_${methodKey}`,
  });

  SwaggerModule.setup(config.swaggerPath, app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: 'none',
      filter: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
    customSiteTitle: `${config.swaggerTitle} - API reference`,
    jsonDocumentUrl: `${config.swaggerPath}/json`,
    yamlDocumentUrl: `${config.swaggerPath}/yaml`,
  });
}

function buildDescription(config: AppConfigService): string {
  return [
    config.swaggerDescription,
    '',
    '## Multi-tenancy',
    'Every request is bound to exactly one organisation. For authenticated calls the tenant is read',
    'from the `tid` claim of the access token and a client-supplied tenant identifier can never',
    'override it. For unauthenticated calls the tenant is resolved from the custom domain, then the',
    `platform sub-domain, then the \`${HEADER_TENANT_SLUG}\` header.`,
    '',
    '## Response envelope',
    'Successful responses are wrapped as `{ "success": true, "data": ..., "meta": { "requestId", "timestamp" } }`.',
    'Errors are wrapped as `{ "success": false, "error": { "code", "message", "details", "requestId", "timestamp", "path" } }`.',
    'Stack traces are never returned outside development.',
    '',
    '## Authentication',
    'Bearer access tokens are short lived. Refresh tokens rotate on every use and are bound to a',
    'device; presenting a consumed refresh token revokes the entire token family and signs the user',
    'out everywhere.',
    '',
    '## Rate limiting',
    'Two buckets are enforced: a generous default bucket and a strict bucket on authentication',
    'endpoints. Exceeding either returns 429 with `Retry-After`.',
  ].join('\n');
}

/**
 * Constant-time basic auth in front of the docs routes. Credentials come from
 * the environment; when they are not configured in production the docs stay
 * closed rather than falling open.
 */
function applyDocsBasicAuth(app: INestApplication, config: AppConfigService): void {
  const { user, password } = config.swaggerCredentials;
  const path = `/${config.swaggerPath.replace(/^\//, '')}`;

  app.use(path, (request: Request, response: Response, next: NextFunction) => {
    if (!user || !password) {
      response.status(404).send();
      return;
    }

    const header = request.headers.authorization ?? '';
    if (!header.toLowerCase().startsWith('basic ')) {
      response.setHeader('WWW-Authenticate', 'Basic realm="API reference"');
      response.status(401).send();
      return;
    }

    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf(':');
    const providedUser = separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : '';
    const providedPassword = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : '';

    if (!safeEqual(providedUser, user) || !safeEqual(providedPassword, password)) {
      response.setHeader('WWW-Authenticate', 'Basic realm="API reference"');
      response.status(401).send();
      return;
    }

    next();
  });
}

function safeEqual(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  if (providedBuffer.length !== expectedBuffer.length) {
    // Compare against itself to keep the timing profile flat.
    timingSafeEqual(providedBuffer, providedBuffer);
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

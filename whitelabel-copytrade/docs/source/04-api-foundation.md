# API - bootstrap, config and common layer

Entrypoint, configuration service, Swagger, and the cross-cutting filters, guards, interceptors, pipes and middleware.

54 files. Part of the complete Part 1 source dump - see `docs/source/README.md`.

---

FILE: apps/api/.eslintrc.cjs

```javascript
/** ESLint configuration for the NestJS API. */
module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    // Both projects: the build config covers src, the spec config covers the
    // *.spec.ts files that the build config excludes so they stay out of dist.
    project: ['tsconfig.json', 'tsconfig.spec.json'],
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: ['plugin:@typescript-eslint/recommended', 'prettier'],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.cjs', 'dist', 'node_modules', 'prisma/generated'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-console': ['error', { allow: ['warn', 'error'] }],
  },
};
```

FILE: apps/api/.prettierrc

```text
{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "semi": true,
  "arrowParens": "always"
}
```

FILE: apps/api/nest-cli.json

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "entryFile": "main",
  "compilerOptions": {
    "deleteOutDir": true,
    "tsConfigPath": "tsconfig.build.json",
    "plugins": [
      {
        "name": "@nestjs/swagger",
        "options": {
          "classValidatorShim": true,
          "introspectComments": true
        }
      }
    ]
  }
}
```

FILE: apps/api/package.json

```json
{
  "name": "@wlct/api",
  "version": "1.0.0",
  "private": true,
  "description": "NestJS API gateway for the white-label copy-trading platform",
  "main": "dist/main.js",
  "scripts": {
    "prebuild": "rimraf dist",
    "build": "nest build",
    "start": "node dist/main.js",
    "start:dev": "nest start --watch",
    "start:debug": "nest start --debug --watch",
    "start:prod": "node dist/main.js",
    "lint": "eslint \"{src,test}/**/*.ts\" --max-warnings=0",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "jest --passWithNoTests",
    "test:watch": "jest --watch",
    "test:cov": "jest --coverage",
    "test:e2e": "jest --config ./test/jest-e2e.json --passWithNoTests",
    "prisma:generate": "dotenv -e ../../.env -- prisma generate",
    "prisma:migrate": "dotenv -e ../../.env -- prisma migrate dev",
    "prisma:deploy": "dotenv -e ../../.env -- prisma migrate deploy",
    "prisma:reset": "dotenv -e ../../.env -- prisma migrate reset --force",
    "prisma:studio": "dotenv -e ../../.env -- prisma studio",
    "db:seed": "dotenv -e ../../.env -- ts-node --transpile-only prisma/seed.ts",
    "worker": "node dist/worker.js",
    "worker:dev": "ts-node --transpile-only src/worker.ts"
  },
  "prisma": {
    "seed": "dotenv -e ../../.env -- ts-node --transpile-only prisma/seed.ts"
  },
  "dependencies": {
    "@nestjs/bullmq": "^10.2.1",
    "@nestjs/common": "^10.4.4",
    "@nestjs/config": "^3.2.3",
    "@nestjs/core": "^10.4.4",
    "@nestjs/jwt": "^10.2.0",
    "@nestjs/passport": "^10.0.3",
    "@nestjs/platform-express": "^10.4.4",
    "@nestjs/platform-socket.io": "^10.4.4",
    "@nestjs/schedule": "^4.1.1",
    "@nestjs/swagger": "^7.4.2",
    "@nestjs/terminus": "^10.2.3",
    "@nestjs/throttler": "^6.2.1",
    "@nestjs/websockets": "^10.4.4",
    "@prisma/client": "^5.20.0",
    "@socket.io/redis-adapter": "^8.3.0",
    "@wlct/config": "1.0.0",
    "@wlct/shared-types": "1.0.0",
    "@wlct/utils": "1.0.0",
    "@wlct/validation": "1.0.0",
    "argon2": "^0.41.1",
    "bullmq": "^5.13.2",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "compression": "^1.7.4",
    "cookie-parser": "^1.4.6",
    "express": "^4.21.0",
    "helmet": "^7.1.0",
    "ioredis": "^5.4.1",
    "nestjs-pino": "^4.1.0",
    "otplib": "^12.0.1",
    "passport": "^0.7.0",
    "passport-jwt": "^4.0.1",
    "pino": "^9.4.0",
    "pino-http": "^10.3.0",
    "qrcode": "^1.5.4",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "socket.io": "^4.8.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.4.5",
    "@nestjs/schematics": "^10.1.4",
    "@nestjs/testing": "^10.4.4",
    "@types/compression": "^1.7.5",
    "@types/cookie-parser": "^1.4.7",
    "@types/express": "^4.17.21",
    "@types/jest": "^29.5.13",
    "@types/node": "^20.14.10",
    "@types/passport-jwt": "^4.0.1",
    "@types/qrcode": "^1.5.5",
    "@types/supertest": "^6.0.2",
    "@typescript-eslint/eslint-plugin": "^7.18.0",
    "@typescript-eslint/parser": "^7.18.0",
    "dotenv-cli": "^7.4.2",
    "eslint": "^8.57.0",
    "eslint-config-prettier": "^9.1.0",
    "eslint-plugin-prettier": "^5.2.1",
    "jest": "^29.7.0",
    "pino-pretty": "^11.2.2",
    "prettier": "^3.3.3",
    "prisma": "^5.20.0",
    "rimraf": "^5.0.7",
    "source-map-support": "^0.5.21",
    "supertest": "^7.0.0",
    "ts-jest": "^29.2.5",
    "ts-loader": "^9.5.1",
    "ts-node": "^10.9.2",
    "tsconfig-paths": "^4.2.0",
    "typescript": "^5.5.4"
  },
  "jest": {
    "moduleFileExtensions": [
      "js",
      "json",
      "ts"
    ],
    "rootDir": "src",
    "testRegex": ".*\\.spec\\.ts$",
    "transform": {
      "^.+\\.(t|j)s$": "ts-jest"
    },
    "collectCoverageFrom": [
      "**/*.(t|j)s"
    ],
    "coverageDirectory": "../coverage",
    "testEnvironment": "node",
    "moduleNameMapper": {
      "^@wlct/shared-types$": "<rootDir>/../../../packages/shared-types/src",
      "^@wlct/config$": "<rootDir>/../../../packages/config/src",
      "^@wlct/utils$": "<rootDir>/../../../packages/utils/src",
      "^@wlct/validation$": "<rootDir>/../../../packages/validation/src",
      "^src/(.*)$": "<rootDir>/$1"
    }
  }
}
```

FILE: apps/api/src/app.module.ts

```typescript
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';

import { AppConfigModule } from './config/app-config.module';
import { LoggerModule } from './infrastructure/logger/logger.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { CryptoModule } from './infrastructure/crypto/crypto.module';
import { I18nModule } from './infrastructure/i18n/i18n.module';
import { QueueModule } from './modules/queue/queue.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { AuditModule } from './modules/audit/audit.module';
import { SecurityModule } from './modules/security/security.module';
import { FeatureFlagsModule } from './modules/feature-flags/feature-flags.module';
import { BillingModule } from './modules/billing/billing.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { ExecutionModule } from './modules/execution/execution.module';
import { StrategyModule } from './modules/strategy/strategy.module';
import { DatasetsModule } from './modules/datasets/datasets.module';
import { RiskModule } from './modules/risk/risk.module';
import { ObservabilityModule } from './modules/observability/observability.module';

import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { ResponseTransformInterceptor } from './common/interceptors/response-transform.interceptor';
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor';
import { AuditContextInterceptor } from './common/interceptors/audit-context.interceptor';
import { GlobalValidationPipe } from './common/pipes/global-validation.pipe';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from './modules/auth/guards/permissions.guard';
import { TenantGuard } from './modules/tenants/guards/tenant.guard';
import { FeatureFlagGuard } from './modules/feature-flags/guards/feature-flag.guard';
import { ThrottlerBehindProxyGuard } from './common/guards/throttler-behind-proxy.guard';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { TraceMiddleware } from './infrastructure/tracing/trace.middleware';
import { TenantResolutionMiddleware } from './common/middleware/tenant-resolution.middleware';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';

/**
 * Root module.
 *
 * Cross-cutting behaviour is registered once here as global providers so that
 * feature modules stay focused on their domain:
 *   - validation pipe        -> rejects malformed input before controllers run
 *   - exception filters      -> uniform, stack-trace-free error envelopes
 *   - response interceptor   -> uniform success envelopes
 *   - guards (order matters) -> throttling, then authN, then tenancy, then authZ
 */
@Module({
  imports: [
    AppConfigModule,
    // Dynamic on purpose: see the comment in logger.module.ts. Calling
    // forRoot() here (rather than importing a statically configured module)
    // guarantees every @InjectPinoLogger context has been registered first.
    LoggerModule.forRoot(),
    PrismaModule,
    RedisModule,
    CryptoModule,
    I18nModule,
    RateLimitModule,
    ScheduleModule.forRoot(),
    QueueModule,
    HealthModule,
    AuditModule,
    SecurityModule,
    RbacModule,
    TenantsModule,
    UsersModule,
    AuthModule,
    FeatureFlagsModule,
    BillingModule,
    NotificationsModule,
    RealtimeModule,
    ExecutionModule,
    StrategyModule,
    DatasetsModule,
    RiskModule,
    ObservabilityModule,
  ],
  providers: [
    { provide: APP_PIPE, useClass: GlobalValidationPipe },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: TimeoutInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseTransformInterceptor },
    // Guards execute in registration order.
    { provide: APP_GUARD, useClass: ThrottlerBehindProxyGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: FeatureFlagGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      // TraceMiddleware FIRST: the server span brackets the whole pipeline
      // (correlation and tenant resolution included), so a 401 from the
      // auth guard is still a span with a status - requests that never reach
      // a handler are precisely the ones an incident review asks about.
      .apply(TraceMiddleware, RequestContextMiddleware, TenantResolutionMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
```

FILE: apps/api/src/common/constants/metadata.constants.ts

```typescript
/** Reflector metadata keys. Centralised to avoid typo-driven security holes. */
export const IS_PUBLIC_KEY = 'auth:isPublic';
export const PERMISSIONS_KEY = 'auth:permissions';
export const PERMISSIONS_MODE_KEY = 'auth:permissionsMode';
export const ROLES_KEY = 'auth:roles';
export const PLATFORM_ONLY_KEY = 'auth:platformOnly';
export const SKIP_TENANT_KEY = 'tenant:skipResolution';
export const FEATURE_FLAG_KEY = 'feature:flag';
export const AUDIT_ACTION_KEY = 'audit:action';
export const SKIP_RESPONSE_TRANSFORM_KEY = 'response:skipTransform';
export const REQUEST_TIMEOUT_KEY = 'request:timeoutMs';
export const IDEMPOTENT_KEY = 'request:idempotent';
export const REQUIRE_FRESH_AUTH_KEY = 'auth:requireFresh';
```

FILE: apps/api/src/common/constants/request.constants.ts

```typescript
/** Keys used to stash request-scoped state on the Express request object. */
export const REQUEST_ID_PROPERTY = 'requestId';
export const REQUEST_START_TIME_PROPERTY = 'startTime';
export const REQUEST_TENANT_PROPERTY = 'tenantContext';
export const REQUEST_ACTOR_PROPERTY = 'actor';
export const REQUEST_LOCALE_PROPERTY = 'locale';
export const REQUEST_IP_HASH_PROPERTY = 'ipHash';

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
```

FILE: apps/api/src/common/decorators/api-standard-responses.decorator.ts

```typescript
import { applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../dto/api-response.dto';

/**
 * Documents the error envelopes that any endpoint may return, so the generated
 * OpenAPI document matches what the exception filter actually produces.
 */
export const ApiStandardResponses = (): MethodDecorator & ClassDecorator =>
  applyDecorators(
    ApiExtraModels(ApiErrorResponseDto),
    ApiResponse({
      status: 400,
      description: 'Malformed request.',
      schema: { $ref: getSchemaPath(ApiErrorResponseDto) },
    }),
    ApiResponse({
      status: 401,
      description: 'Missing, expired or invalid access token.',
      schema: { $ref: getSchemaPath(ApiErrorResponseDto) },
    }),
    ApiResponse({
      status: 403,
      description: 'Authenticated but not permitted (RBAC, tenancy or feature flag).',
      schema: { $ref: getSchemaPath(ApiErrorResponseDto) },
    }),
    ApiResponse({
      status: 422,
      description: 'Validation failed. `error.details` lists the offending fields.',
      schema: { $ref: getSchemaPath(ApiErrorResponseDto) },
    }),
    ApiResponse({
      status: 429,
      description: 'Rate limit exceeded.',
      schema: { $ref: getSchemaPath(ApiErrorResponseDto) },
    }),
    ApiResponse({
      status: 500,
      description: 'Unexpected server error. Quote the `meta.requestId` in support tickets.',
      schema: { $ref: getSchemaPath(ApiErrorResponseDto) },
    }),
  );
```

FILE: apps/api/src/common/decorators/audit.decorator.ts

```typescript
import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import type { AuditAction } from '@wlct/shared-types';
import { AUDIT_ACTION_KEY } from '../constants/metadata.constants';

/**
 * Declares the audit action produced by a route. The audit interceptor uses it
 * to emit a record automatically when the handler resolves successfully.
 */
export const Audited = (action: AuditAction, resourceType?: string): CustomDecorator<string> =>
  SetMetadata(AUDIT_ACTION_KEY, { action, resourceType });
```

FILE: apps/api/src/common/decorators/current-tenant.decorator.ts

```typescript
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AppRequest, TenantContext } from '../types/request.types';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '@wlct/shared-types';

/**
 * Injects the resolved tenant context. The value is derived server-side from
 * the JWT (authenticated calls) or the request host (public calls) - never from
 * a client supplied tenant id.
 */
export const CurrentTenant = createParamDecorator(
  (property: keyof TenantContext | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<AppRequest>();
    const tenant = request.tenantContext;
    if (!tenant) {
      throw new AppException({
        code: ErrorCode.TENANT_NOT_FOUND,
        message: 'No organisation could be resolved for this request.',
      });
    }
    return property ? tenant[property] : tenant;
  },
);

/** Shorthand for the most common need: the tenant id string. */
export const TenantId = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  const request = context.switchToHttp().getRequest<AppRequest>();
  const tenant = request.tenantContext;
  if (!tenant) {
    throw new AppException({
      code: ErrorCode.TENANT_NOT_FOUND,
      message: 'No organisation could be resolved for this request.',
    });
  }
  return tenant.tenantId;
});
```

FILE: apps/api/src/common/decorators/current-user.decorator.ts

```typescript
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedActor } from '@wlct/shared-types';
import type { AppRequest } from '../types/request.types';
import { UnauthorizedException } from '../errors/app.exception';

/**
 * Injects the authenticated actor. Throws instead of returning undefined so a
 * controller can never silently operate without an identity.
 */
export const CurrentUser = createParamDecorator(
  (property: keyof AuthenticatedActor | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<AppRequest>();
    const actor = request.actor;
    if (!actor) {
      throw new UnauthorizedException();
    }
    return property ? actor[property] : actor;
  },
);
```

FILE: apps/api/src/common/decorators/feature-flag.decorator.ts

```typescript
import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import { FEATURE_FLAG_KEY } from '../constants/metadata.constants';

/**
 * Gates a route behind a tenant feature flag. The FeatureFlagGuard resolves the
 * flag for the request's tenant and returns FEATURE_DISABLED when it is off.
 */
export const RequireFeature = (flagKey: string): CustomDecorator<string> =>
  SetMetadata(FEATURE_FLAG_KEY, flagKey);
```

FILE: apps/api/src/common/decorators/index.ts

```typescript
export * from './public.decorator';
export * from './permissions.decorator';
export * from './current-user.decorator';
export * from './current-tenant.decorator';
export * from './request-context.decorator';
export * from './audit.decorator';
export * from './feature-flag.decorator';
export * from './api-standard-responses.decorator';
export * from './zod-body.decorator';
```

FILE: apps/api/src/common/decorators/permissions.decorator.ts

```typescript
import { SetMetadata, applyDecorators, type CustomDecorator } from '@nestjs/common';
import type { Permission } from '@wlct/shared-types';
import { PERMISSIONS_KEY, PERMISSIONS_MODE_KEY, PLATFORM_ONLY_KEY } from '../constants/metadata.constants';

export type PermissionMode = 'all' | 'any';

/** Requires the caller to hold every listed permission. */
export const RequirePermissions = (...permissions: Permission[]): CustomDecorator<string> =>
  applyDecorators(
    SetMetadata(PERMISSIONS_KEY, permissions),
    SetMetadata(PERMISSIONS_MODE_KEY, 'all' satisfies PermissionMode),
  ) as CustomDecorator<string>;

/** Requires at least one of the listed permissions. */
export const RequireAnyPermission = (...permissions: Permission[]): CustomDecorator<string> =>
  applyDecorators(
    SetMetadata(PERMISSIONS_KEY, permissions),
    SetMetadata(PERMISSIONS_MODE_KEY, 'any' satisfies PermissionMode),
  ) as CustomDecorator<string>;

/** Restricts a route to platform staff (super admins), regardless of tenant. */
export const PlatformOnly = (): CustomDecorator<string> => SetMetadata(PLATFORM_ONLY_KEY, true);
```

FILE: apps/api/src/common/decorators/public.decorator.ts

```typescript
import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../constants/metadata.constants';

/**
 * Marks a route as reachable without an access token. Authentication is
 * deny-by-default: every endpoint requires a valid JWT unless it opts out here.
 */
export const Public = (): CustomDecorator<string> => SetMetadata(IS_PUBLIC_KEY, true);
```

FILE: apps/api/src/common/decorators/request-context.decorator.ts

```typescript
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AppRequest } from '../types/request.types';

export interface RequestMetadata {
  requestId: string;
  /** Part 9: the cross-service correlation id (echoed on the response
   *  header; falls back to requestId for calls that arrived without one). */
  correlationId: string;
  ipHash: string;
  ip: string;
  userAgent: string | null;
  locale: string;
  method: string;
  path: string;
}

/** RequestMetadata deliberately does NOT carry the operation id as a
 *  separate field for callers: for an HTTP request the operation IS the
 *  request. Queue-side code that splits a request into several operations
 *  owns its operation ids locally (see the maintenance jobs). */

/** Injects request metadata needed by audit logging and security analytics. */
export const RequestMeta = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestMetadata => {
    const request = context.switchToHttp().getRequest<AppRequest>();
    return {
      requestId: request.requestId,
      correlationId: request.correlationId,
      ipHash: request.ipHash,
      ip: request.ip ?? 'unknown',
      userAgent: request.headers['user-agent'] ?? null,
      locale: request.locale,
      method: request.method,
      path: request.originalUrl.split('?')[0],
    };
  },
);
```

FILE: apps/api/src/common/decorators/zod-body.decorator.ts

```typescript
import { Body, Param, Query } from '@nestjs/common';
import type { ZodSchema } from 'zod';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';

/**
 * Validates a request body with a zod schema from `@wlct/validation`, which
 * keeps a single validation source of truth shared with the web and mobile
 * clients. Swagger documentation still comes from the DTO classes.
 */
export const ZodBody = (schema: ZodSchema): ParameterDecorator =>
  Body(new ZodValidationPipe(schema));

/** Query-string equivalent of {@link ZodBody}. */
export const ZodQuery = (schema: ZodSchema): ParameterDecorator =>
  Query(new ZodValidationPipe(schema));

/** Route-parameter equivalent of {@link ZodBody}. */
export const ZodParam = (property: string, schema: ZodSchema): ParameterDecorator =>
  Param(property, new ZodValidationPipe(schema));
```

FILE: apps/api/src/common/dto/api-response.dto.ts

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Swagger models mirroring the runtime envelopes in `@wlct/shared-types`. */

export class ResponseMetaDto {
  @ApiProperty({ example: '7f3c1d2e-0f8a-4a3b-9c1a-1d2e3f4a5b6c' })
  requestId!: string;

  @ApiProperty({ example: '2026-09-05T09:15:00.000Z' })
  timestamp!: string;

  @ApiProperty({ example: '1' })
  version!: string;
}

export class ValidationErrorDetailDto {
  @ApiProperty({ example: 'email' })
  field!: string;

  @ApiProperty({ example: 'isEmail' })
  constraint!: string;

  @ApiProperty({ example: 'Must be a valid email address' })
  message!: string;
}

export class ApiErrorBodyDto {
  @ApiProperty({ example: 'VALIDATION_ERROR' })
  code!: string;

  @ApiProperty({ example: 'The submitted data failed validation.' })
  message!: string;

  @ApiProperty({ example: 422 })
  statusCode!: number;

  @ApiPropertyOptional({ type: [ValidationErrorDetailDto] })
  details?: ValidationErrorDetailDto[];
}

export class ApiErrorResponseDto {
  @ApiProperty({ example: false })
  success!: false;

  @ApiProperty({ type: ApiErrorBodyDto })
  error!: ApiErrorBodyDto;

  @ApiProperty({ type: ResponseMetaDto })
  meta!: ResponseMetaDto;
}

export class PaginationMetaDto {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 137 })
  totalItems!: number;

  @ApiProperty({ example: 7 })
  totalPages!: number;

  @ApiProperty({ example: true })
  hasNextPage!: boolean;

  @ApiProperty({ example: false })
  hasPreviousPage!: boolean;
}
```

FILE: apps/api/src/common/dto/index.ts

```typescript
export * from './api-response.dto';
export * from './pagination-query.dto';
```

FILE: apps/api/src/common/dto/pagination-query.dto.ts

```typescript
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PAGINATION_DEFAULTS } from '@wlct/config';

/** Shared query DTO for every list endpoint. */
export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: PAGINATION_DEFAULTS.PAGE })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be at least 1' })
  page: number = PAGINATION_DEFAULTS.PAGE;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: PAGINATION_DEFAULTS.MAX_LIMIT,
    default: PAGINATION_DEFAULTS.LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(PAGINATION_DEFAULTS.MAX_LIMIT, {
    message: `limit must not exceed ${PAGINATION_DEFAULTS.MAX_LIMIT}`,
  })
  limit: number = PAGINATION_DEFAULTS.LIMIT;

  @ApiPropertyOptional({ description: 'Field to sort by. Unknown fields are ignored.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'sortOrder must be "asc" or "desc"' })
  sortOrder: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({ description: 'Free-text search term.' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;
}
```

FILE: apps/api/src/common/errors/app.exception.ts

```typescript
import { HttpException } from '@nestjs/common';
import { ERROR_CODE_HTTP_STATUS, ErrorCode, type ValidationErrorDetail } from '@wlct/shared-types';

export interface AppExceptionOptions {
  /** Machine readable code the clients switch on. */
  code: ErrorCode;
  /** Human readable, safe-to-display message. */
  message?: string;
  /** Overrides the default status mapped from the code. */
  statusCode?: number;
  /** Field level validation problems. */
  details?: ValidationErrorDetail[];
  /** Internal-only diagnostic context; logged, never serialised to clients. */
  cause?: unknown;
  /** Extra structured context for logs and audit records. */
  context?: Record<string, unknown>;
}

/**
 * Base exception for every deliberate failure raised by application code.
 *
 * Two rules make this safe by construction:
 *   1. `message` is always something we are happy to show a end user.
 *   2. `cause`/`context` never leave the process; the exception filter strips
 *      them from the HTTP response and forwards them to the logger only.
 */
export class AppException extends HttpException {
  public readonly code: ErrorCode;
  public readonly details?: ValidationErrorDetail[];
  public readonly context?: Record<string, unknown>;
  public readonly internalCause?: unknown;

  constructor(options: AppExceptionOptions) {
    const status = options.statusCode ?? ERROR_CODE_HTTP_STATUS[options.code] ?? 500;
    const message = options.message ?? defaultMessageFor(options.code);
    super({ code: options.code, message, statusCode: status }, status);
    this.name = 'AppException';
    this.code = options.code;
    this.details = options.details;
    this.context = options.context;
    this.internalCause = options.cause;
  }
}

function defaultMessageFor(code: ErrorCode): string {
  switch (code) {
    case ErrorCode.UNAUTHORIZED:
      return 'Authentication is required to access this resource.';
    case ErrorCode.INVALID_CREDENTIALS:
      return 'The email address or password is incorrect.';
    case ErrorCode.FORBIDDEN:
    case ErrorCode.INSUFFICIENT_PERMISSIONS:
      return 'You do not have permission to perform this action.';
    case ErrorCode.NOT_FOUND:
      return 'The requested resource was not found.';
    case ErrorCode.CONFLICT:
      return 'The request conflicts with the current state of the resource.';
    case ErrorCode.VALIDATION_ERROR:
      return 'The submitted data failed validation.';
    case ErrorCode.RATE_LIMIT_EXCEEDED:
      return 'Too many requests. Please slow down and try again shortly.';
    case ErrorCode.INTERNAL_SERVER_ERROR:
      return 'An unexpected error occurred. Please try again later.';
    default:
      return 'The request could not be completed.';
  }
}

// -----------------------------------------------------------------------------
// Convenience subclasses for the most frequent failures
// -----------------------------------------------------------------------------

export class ValidationException extends AppException {
  constructor(details: ValidationErrorDetail[], message = 'The submitted data failed validation.') {
    super({ code: ErrorCode.VALIDATION_ERROR, message, details });
    this.name = 'ValidationException';
  }
}

export class NotFoundException extends AppException {
  constructor(resource: string, identifier?: string) {
    super({
      code: ErrorCode.NOT_FOUND,
      message: `${resource} was not found.`,
      context: identifier ? { resource, identifier } : { resource },
    });
    this.name = 'NotFoundException';
  }
}

export class ConflictException extends AppException {
  constructor(message: string, context?: Record<string, unknown>) {
    super({ code: ErrorCode.CONFLICT, message, context });
    this.name = 'ConflictException';
  }
}

export class UnauthorizedException extends AppException {
  constructor(code: ErrorCode = ErrorCode.UNAUTHORIZED, message?: string) {
    super({ code, message });
    this.name = 'UnauthorizedException';
  }
}

export class ForbiddenException extends AppException {
  constructor(code: ErrorCode = ErrorCode.FORBIDDEN, message?: string, context?: Record<string, unknown>) {
    super({ code, message, context });
    this.name = 'ForbiddenException';
  }
}

export class TenantIsolationException extends AppException {
  constructor(context: Record<string, unknown>) {
    super({
      code: ErrorCode.TENANT_MISMATCH,
      message: 'The requested resource does not belong to your organisation.',
      context,
    });
    this.name = 'TenantIsolationException';
  }
}

export class FeatureDisabledException extends AppException {
  constructor(featureKey: string) {
    super({
      code: ErrorCode.FEATURE_DISABLED,
      message: 'This feature is not enabled for your organisation.',
      context: { featureKey },
    });
    this.name = 'FeatureDisabledException';
  }
}

export class ServiceUnavailableException extends AppException {
  constructor(service: string, cause?: unknown) {
    super({
      code: ErrorCode.SERVICE_UNAVAILABLE,
      message: 'A dependent service is temporarily unavailable. Please retry shortly.',
      context: { service },
      cause,
    });
    this.name = 'ServiceUnavailableException';
  }
}
```

FILE: apps/api/src/common/errors/index.ts

```typescript
export * from './app.exception';
```

FILE: apps/api/src/common/filters/global-exception.filter.ts

```typescript
import {
  Catch,
  HttpException,
  HttpStatus,
  Injectable,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ThrottlerException } from '@nestjs/throttler';
import { PinoLogger, InjectPinoLogger } from 'nestjs-pino';
import { ErrorCode, type ApiErrorResponse, type ValidationErrorDetail } from '@wlct/shared-types';
import { redact } from '@wlct/utils';

import { AppException } from '../errors/app.exception';
import { AppConfigService } from '../../config/app-config.service';
import type { AppRequest } from '../types/request.types';

/**
 * Single exit point for every unhandled error.
 *
 * Guarantees:
 *   - the response body always matches {@link ApiErrorResponse};
 *   - stack traces and internal context never reach the client;
 *   - 5xx responses are logged at error level with full (redacted) context, so
 *     an operator can correlate a user-reported requestId with the root cause.
 */
@Injectable()
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly config: AppConfigService,
    @InjectPinoLogger(GlobalExceptionFilter.name) private readonly logger: PinoLogger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<AppRequest>();
    const response = ctx.getResponse();

    const resolved = this.resolveException(exception);

    const body: ApiErrorResponse = {
      success: false,
      error: {
        code: resolved.code,
        message: resolved.message,
        statusCode: resolved.statusCode,
        ...(resolved.details ? { details: resolved.details } : {}),
      },
      meta: {
        requestId: request?.requestId ?? 'unknown',
        timestamp: new Date().toISOString(),
        version: this.config.defaultApiVersion,
      },
    };

    const logContext = {
      event: 'request.failed',
      requestId: request?.requestId,
      tenantId: request?.tenantContext?.tenantId,
      userId: request?.actor?.userId,
      method: request?.method,
      path: request?.originalUrl?.split('?')[0],
      statusCode: resolved.statusCode,
      errorCode: resolved.code,
      context: resolved.context ? redact(resolved.context) : undefined,
    };

    if (resolved.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        { ...logContext, stack: resolved.stack },
        `Unhandled error: ${resolved.internalMessage}`,
      );
    } else if (resolved.statusCode === HttpStatus.TOO_MANY_REQUESTS) {
      this.logger.warn(logContext, 'Rate limit triggered');
    } else {
      this.logger.info(logContext, `Request rejected: ${resolved.code}`);
    }

    httpAdapter.reply(response, body, resolved.statusCode);
  }

  private resolveException(exception: unknown): {
    statusCode: number;
    code: ErrorCode | string;
    message: string;
    details?: ValidationErrorDetail[];
    context?: Record<string, unknown>;
    stack?: string;
    internalMessage: string;
  } {
    if (exception instanceof AppException) {
      const payload = exception.getResponse() as { message: string };
      return {
        statusCode: exception.getStatus(),
        code: exception.code,
        message: payload.message,
        details: exception.details,
        context: {
          ...(exception.context ?? {}),
          ...(exception.internalCause instanceof Error
            ? { cause: exception.internalCause.message }
            : {}),
        },
        stack: exception.stack,
        internalMessage: payload.message,
      };
    }

    if (exception instanceof ThrottlerException) {
      return {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: ErrorCode.RATE_LIMIT_EXCEEDED,
        message: 'Too many requests. Please slow down and try again shortly.',
        internalMessage: 'Throttler limit exceeded',
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      const message =
        typeof raw === 'string'
          ? raw
          : ((raw as { message?: string | string[] }).message ?? exception.message);

      return {
        statusCode: status,
        code: this.mapStatusToCode(status),
        message: Array.isArray(message) ? message.join('; ') : message,
        stack: exception.stack,
        internalMessage: exception.message,
      };
    }

    // Anything else is a genuine bug: never leak its message to the client.
    const error = exception instanceof Error ? exception : new Error(String(exception));
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      message: 'An unexpected error occurred. Please try again later.',
      stack: error.stack,
      internalMessage: error.message,
    };
  }

  private mapStatusToCode(status: number): ErrorCode {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.BAD_REQUEST;
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.UNAUTHORIZED;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ErrorCode.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ErrorCode.CONFLICT;
      case HttpStatus.PAYLOAD_TOO_LARGE:
        return ErrorCode.PAYLOAD_TOO_LARGE;
      case HttpStatus.UNSUPPORTED_MEDIA_TYPE:
        return ErrorCode.UNSUPPORTED_MEDIA_TYPE;
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return ErrorCode.VALIDATION_ERROR;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ErrorCode.RATE_LIMIT_EXCEEDED;
      case HttpStatus.SERVICE_UNAVAILABLE:
        return ErrorCode.SERVICE_UNAVAILABLE;
      default:
        return status >= 500 ? ErrorCode.INTERNAL_SERVER_ERROR : ErrorCode.BAD_REQUEST;
    }
  }
}
```

FILE: apps/api/src/common/filters/index.ts

```typescript
export * from './global-exception.filter';
export * from './prisma-exception.filter';
```

FILE: apps/api/src/common/filters/prisma-exception.filter.ts

```typescript
import { Catch, HttpStatus, Injectable, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ErrorCode, type ApiErrorResponse } from '@wlct/shared-types';

import { AppConfigService } from '../../config/app-config.service';
import type { AppRequest } from '../types/request.types';

/**
 * Translates Prisma engine errors into safe API responses.
 *
 * Database driver messages routinely contain table names, column names and
 * sometimes parameter values, so they are logged but never returned.
 */
@Injectable()
@Catch(
  Prisma.PrismaClientKnownRequestError,
  Prisma.PrismaClientValidationError,
  Prisma.PrismaClientInitializationError,
  Prisma.PrismaClientRustPanicError,
)
export class PrismaExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly config: AppConfigService,
    @InjectPinoLogger(PrismaExceptionFilter.name) private readonly logger: PinoLogger,
  ) {}

  catch(exception: Error, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<AppRequest>();
    const response = ctx.getResponse();

    const mapped = this.map(exception);

    this.logger.error(
      {
        event: 'database.error',
        requestId: request?.requestId,
        tenantId: request?.tenantContext?.tenantId,
        userId: request?.actor?.userId,
        prismaCode:
          exception instanceof Prisma.PrismaClientKnownRequestError ? exception.code : undefined,
        statusCode: mapped.statusCode,
        stack: exception.stack,
      },
      `Prisma error: ${exception.message.split('\n')[0]}`,
    );

    const body: ApiErrorResponse = {
      success: false,
      error: {
        code: mapped.code,
        message: mapped.message,
        statusCode: mapped.statusCode,
      },
      meta: {
        requestId: request?.requestId ?? 'unknown',
        timestamp: new Date().toISOString(),
        version: this.config.defaultApiVersion,
      },
    };

    httpAdapter.reply(response, body, mapped.statusCode);
  }

  private map(exception: Error): { statusCode: number; code: ErrorCode; message: string } {
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          return {
            statusCode: HttpStatus.CONFLICT,
            code: ErrorCode.CONFLICT,
            message: 'A record with these details already exists.',
          };
        case 'P2003':
          return {
            statusCode: HttpStatus.CONFLICT,
            code: ErrorCode.CONFLICT,
            message: 'The operation references a record that does not exist.',
          };
        case 'P2025':
          return {
            statusCode: HttpStatus.NOT_FOUND,
            code: ErrorCode.NOT_FOUND,
            message: 'The requested resource was not found.',
          };
        case 'P2034':
          return {
            statusCode: HttpStatus.CONFLICT,
            code: ErrorCode.CONFLICT,
            message: 'The operation conflicted with a concurrent change. Please retry.',
          };
        default:
          return {
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            code: ErrorCode.INTERNAL_SERVER_ERROR,
            message: 'An unexpected database error occurred.',
          };
      }
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.BAD_REQUEST,
        message: 'The request could not be processed due to invalid parameters.',
      };
    }

    return {
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      code: ErrorCode.SERVICE_UNAVAILABLE,
      message: 'The database is temporarily unavailable. Please retry shortly.',
    };
  }
}
```

FILE: apps/api/src/common/guards/feature-flag.guard.ts

```typescript
import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { FEATURE_FLAG_KEY } from '../constants/metadata.constants';
import { FeatureDisabledException } from '../errors/app.exception';
import { FeatureFlagsService } from '../../modules/feature-flags/feature-flags.service';
import type { AppRequest } from '../types/request.types';

/**
 * Enforces `@RequireFeature('flag_key')`. Flags are evaluated per tenant and
 * cached in Redis, so the hot path is a single cache lookup rather than a
 * database query. No latency figure is claimed or guaranteed.
 */
@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const flagKey = this.reflector.getAllAndOverride<string>(FEATURE_FLAG_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!flagKey) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AppRequest>();
    const tenantId = request.tenantContext?.tenantId;

    if (!tenantId) {
      throw new FeatureDisabledException(flagKey);
    }

    const enabled = await this.featureFlags.isEnabled(tenantId, flagKey);
    if (!enabled) {
      throw new FeatureDisabledException(flagKey);
    }

    return true;
  }
}
```

FILE: apps/api/src/common/guards/index.ts

```typescript
export * from './throttler-behind-proxy.guard';
export * from './feature-flag.guard';
export * from './internal-service.guard';
```

FILE: apps/api/src/common/guards/internal-service.guard.ts

```typescript
import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { HEADER_INTERNAL_TOKEN } from '@wlct/config';
import { safeCompare } from '@wlct/utils';
import { ErrorCode } from '@wlct/shared-types';

import { AppConfigService } from '../../config/app-config.service';
import { AppException } from '../errors/app.exception';
import type { AppRequest } from '../types/request.types';

/**
 * Protects endpoints that only internal services (trading engine, market data,
 * notification worker) may call. In production this sits behind mTLS as well;
 * the shared token is the application-layer second factor.
 */
@Injectable()
export class InternalServiceGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AppRequest>();
    const header = request.headers[HEADER_INTERNAL_TOKEN];
    const token = Array.isArray(header) ? header[0] : header;

    if (!token || !safeCompare(token, this.config.internalServiceToken)) {
      throw new AppException({
        code: ErrorCode.UNAUTHORIZED,
        message: 'Internal service authentication failed.',
      });
    }

    return true;
  }
}
```

FILE: apps/api/src/common/guards/throttler-behind-proxy.guard.ts

```typescript
import { Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import { ErrorCode } from '@wlct/shared-types';

import { AppException } from '../errors/app.exception';
import type { AppRequest } from '../types/request.types';

/**
 * Rate limiting keyed by the real client identity rather than the proxy IP.
 *
 * Authenticated traffic is bucketed per user so one noisy customer cannot
 * exhaust a shared NAT allowance for everyone behind the same egress IP;
 * anonymous traffic falls back to the forwarded IP address.
 */
@Injectable()
export class ThrottlerBehindProxyGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const request = req as unknown as AppRequest;

    if (request.actor?.userId) {
      return `user:${request.actor.userId}`;
    }

    const forwarded = request.headers?.['x-forwarded-for'];
    const forwardedIp = Array.isArray(forwarded)
      ? forwarded[0]
      : typeof forwarded === 'string'
        ? forwarded.split(',')[0].trim()
        : undefined;

    const ip = forwardedIp ?? request.ip ?? 'unknown';
    const tenantId = request.tenantContext?.tenantId ?? 'no-tenant';
    return `ip:${tenantId}:${ip}`;
  }

  protected override async throwThrottlingException(
    _context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    throw new AppException({
      code: ErrorCode.RATE_LIMIT_EXCEEDED,
      message: `Too many requests. Try again in ${Math.ceil(
        throttlerLimitDetail.timeToBlockExpire,
      )} seconds.`,
      context: {
        limit: throttlerLimitDetail.limit,
        ttl: throttlerLimitDetail.ttl,
      },
    });
  }
}
```

FILE: apps/api/src/common/interceptors/audit-context.interceptor.ts

```typescript
import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { tap, type Observable } from 'rxjs';
import { AuditActorType, AuditOutcome, type AuditAction } from '@wlct/shared-types';

import { AUDIT_ACTION_KEY } from '../constants/metadata.constants';
import { AuditService } from '../../modules/audit/audit.service';
import type { AppRequest } from '../types/request.types';

interface AuditMetadata {
  action: AuditAction;
  resourceType?: string;
}

/**
 * Emits an audit record for routes annotated with `@Audited(...)`.
 *
 * Writes are queued (BullMQ) rather than awaited so the audit trail never adds
 * latency to the request path, and a slow audit sink cannot fail a mutation.
 */
@Injectable()
export class AuditContextInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const metadata = this.reflector.getAllAndOverride<AuditMetadata>(AUDIT_ACTION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!metadata) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<AppRequest>();

    return next.handle().pipe(
      tap({
        next: (result: unknown) => {
          void this.auditService.record({
            tenantId: request.tenantContext?.tenantId ?? null,
            actorType: request.actor ? AuditActorType.USER : AuditActorType.SYSTEM,
            actorId: request.actor?.userId ?? null,
            action: metadata.action,
            outcome: AuditOutcome.SUCCESS,
            resourceType: metadata.resourceType ?? null,
            resourceId: extractResourceId(result, request),
            ipHash: request.ipHash,
            userAgent: request.headers['user-agent'] ?? null,
            requestId: request.requestId,
            correlationId: request.correlationId,
            operationId: request.requestId,
            metadata: {
              method: request.method,
              path: request.originalUrl.split('?')[0],
            },
          });
        },
        error: (error: unknown) => {
          void this.auditService.record({
            tenantId: request.tenantContext?.tenantId ?? null,
            actorType: request.actor ? AuditActorType.USER : AuditActorType.SYSTEM,
            actorId: request.actor?.userId ?? null,
            action: metadata.action,
            outcome: AuditOutcome.FAILURE,
            resourceType: metadata.resourceType ?? null,
            resourceId: typeof request.params?.id === 'string' ? request.params.id : null,
            ipHash: request.ipHash,
            userAgent: request.headers['user-agent'] ?? null,
            requestId: request.requestId,
            correlationId: request.correlationId,
            operationId: request.requestId,
            metadata: {
              method: request.method,
              path: request.originalUrl.split('?')[0],
              errorName: error instanceof Error ? error.name : 'UnknownError',
            },
          });
        },
      }),
    );
  }
}

function extractResourceId(result: unknown, request: AppRequest): string | null {
  if (result && typeof result === 'object' && 'id' in result) {
    const id = (result as { id: unknown }).id;
    if (typeof id === 'string') {
      return id;
    }
  }
  if (typeof request.params?.id === 'string') {
    return request.params.id;
  }
  return null;
}
```

FILE: apps/api/src/common/interceptors/index.ts

```typescript
export * from './response-transform.interceptor';
export * from './timeout.interceptor';
export * from './audit-context.interceptor';
```

FILE: apps/api/src/common/interceptors/response-transform.interceptor.ts

```typescript
import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, type Observable } from 'rxjs';
import type { ApiSuccessResponse } from '@wlct/shared-types';

import { SKIP_RESPONSE_TRANSFORM_KEY } from '../constants/metadata.constants';
import { AppConfigService } from '../../config/app-config.service';
import type { AppRequest } from '../types/request.types';

/**
 * Wraps every successful handler result in the platform success envelope so
 * clients can rely on one shape. Streaming/file routes opt out with
 * `@SetMetadata(SKIP_RESPONSE_TRANSFORM_KEY, true)`.
 */
@Injectable()
export class ResponseTransformInterceptor<T>
  implements NestInterceptor<T, ApiSuccessResponse<T> | T>
{
  constructor(
    private readonly reflector: Reflector,
    private readonly config: AppConfigService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiSuccessResponse<T> | T> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_RESPONSE_TRANSFORM_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (skip) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<AppRequest>();

    return next.handle().pipe(
      map((data) => ({
        success: true as const,
        data,
        meta: {
          requestId: request.requestId ?? 'unknown',
          timestamp: new Date().toISOString(),
          version: this.config.defaultApiVersion,
        },
      })),
    );
  }
}
```

FILE: apps/api/src/common/interceptors/timeout.interceptor.ts

```typescript
import {
  Injectable,
  RequestTimeoutException,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { throwError, timeout, catchError, type Observable, TimeoutError } from 'rxjs';

import { DEFAULT_REQUEST_TIMEOUT_MS } from '../constants/request.constants';
import { REQUEST_TIMEOUT_KEY } from '../constants/metadata.constants';

/**
 * Bounds handler execution time. Without this, a slow exchange or database call
 * can pin a worker thread and cascade into a platform-wide outage.
 */
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const configured = this.reflector.getAllAndOverride<number>(REQUEST_TIMEOUT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const timeoutMs = configured ?? DEFAULT_REQUEST_TIMEOUT_MS;

    return next.handle().pipe(
      timeout(timeoutMs),
      catchError((error: unknown) => {
        if (error instanceof TimeoutError) {
          return throwError(
            () => new RequestTimeoutException('The request took too long to complete.'),
          );
        }
        return throwError(() => error);
      }),
    );
  }
}
```

FILE: apps/api/src/common/middleware/index.ts

```typescript
export * from './request-context.middleware';
export * from './tenant-resolution.middleware';
```

FILE: apps/api/src/common/middleware/request-context.middleware.ts

```typescript
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { HEADER_CORRELATION_ID, HEADER_REQUEST_ID } from '@wlct/config';

import { CryptoService } from '../../infrastructure/crypto/crypto.service';
import { AppConfigService } from '../../config/app-config.service';
import type { AppRequest } from '../types/request.types';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Establishes per-request context before anything else runs:
 *   - a correlation id (accepted from an upstream proxy only if it is a UUID,
 *     so a client cannot inject arbitrary text into log fields) and the same
 *     id propagated to Python services and queue payloads (Part 9);
 *   - a keyed hash of the client IP, used everywhere instead of the raw address
 *     to limit personal data retention;
 *   - the negotiated locale for i18n.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(
    private readonly crypto: CryptoService,
    private readonly config: AppConfigService,
  ) {}

  use(req: AppRequest, res: Response, next: NextFunction): void {
    const incomingId = req.headers[HEADER_REQUEST_ID];
    const candidate = Array.isArray(incomingId) ? incomingId[0] : incomingId;
    const requestId = candidate && UUID_PATTERN.test(candidate) ? candidate : randomUUID();

    req.requestId = requestId;
    req.id = requestId;

    const incomingCorrelation = req.headers[HEADER_CORRELATION_ID];
    const correlationCandidate = Array.isArray(incomingCorrelation)
      ? incomingCorrelation[0]
      : incomingCorrelation;
    req.correlationId =
      correlationCandidate && UUID_PATTERN.test(correlationCandidate) ? correlationCandidate : requestId;
    res.setHeader(HEADER_CORRELATION_ID, req.correlationId);
    req.startTime = Date.now();
    req.ipHash = this.crypto.hashIp(req.ip ?? 'unknown');
    req.locale = this.negotiateLocale(req.headers['accept-language']);

    res.setHeader(HEADER_REQUEST_ID, requestId);

    next();
  }

  private negotiateLocale(header: string | string[] | undefined): string {
    const supported = this.config.supportedLocales;
    const fallback = this.config.defaultLocale;
    const raw = Array.isArray(header) ? header[0] : header;
    if (!raw) {
      return fallback;
    }

    const ranked = raw
      .split(',')
      .map((part) => {
        const [tag, qualityPart] = part.trim().split(';q=');
        const quality = qualityPart ? Number.parseFloat(qualityPart) : 1;
        return { tag: tag.trim().toLowerCase(), quality: Number.isNaN(quality) ? 0 : quality };
      })
      .sort((a, b) => b.quality - a.quality);

    for (const { tag } of ranked) {
      const base = tag.split('-')[0];
      if (supported.includes(tag)) {
        return tag;
      }
      if (supported.includes(base)) {
        return base;
      }
    }

    return fallback;
  }
}
```

FILE: apps/api/src/common/middleware/tenant-resolution.middleware.ts

```typescript
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { HEADER_TENANT_SLUG } from '@wlct/config';
import { extractSubdomain } from '@wlct/utils';

import { AppConfigService } from '../../config/app-config.service';
import { TenantResolverService } from '../../modules/tenants/tenant-resolver.service';
import type { AppRequest, TenantContext } from '../types/request.types';

/**
 * Resolves the tenant for *unauthenticated* traffic (login, registration,
 * public branding) from trustworthy transport-level signals, in priority order:
 *
 *   1. custom domain           -> app.acme-capital.com
 *   2. platform sub-domain     -> acme.copytrade.app
 *   3. X-Tenant-Slug header    -> native mobile clients that cannot use DNS
 *   4. configured default slug -> single-brand deployments
 *
 * The header is the weakest signal, so it is only honoured when it resolves to
 * an ACTIVE tenant, and any authenticated request later has this value replaced
 * by the tenant id embedded in the verified JWT (see TenantGuard). A client can
 * therefore never read another brand's data by forging a header.
 */
@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(
    private readonly tenantResolver: TenantResolverService,
    private readonly config: AppConfigService,
  ) {}

  async use(req: AppRequest, _res: Response, next: NextFunction): Promise<void> {
    try {
      const context = await this.resolve(req);
      if (context) {
        req.tenantContext = context;
      }
    } catch {
      // Tenant resolution must never break the request pipeline; downstream
      // guards decide whether a missing tenant context is fatal for the route.
    }
    next();
  }

  private async resolve(req: AppRequest): Promise<TenantContext | null> {
    const host = (req.headers['x-forwarded-host'] as string) ?? req.headers.host ?? '';
    const hostname = host.split(',')[0].trim().split(':')[0].toLowerCase();

    if (hostname) {
      const subdomain = extractSubdomain(hostname, this.config.platformRootDomain);
      if (subdomain) {
        const bySubdomain = await this.tenantResolver.resolveBySlug(subdomain);
        if (bySubdomain) {
          return { ...bySubdomain, source: 'subdomain' };
        }
      } else if (!this.isPlatformHost(hostname)) {
        const byDomain = await this.tenantResolver.resolveByDomain(hostname);
        if (byDomain) {
          return { ...byDomain, source: 'domain' };
        }
      }
    }

    const headerValue = req.headers[HEADER_TENANT_SLUG];
    const slug = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (slug) {
      const byHeader = await this.tenantResolver.resolveBySlug(slug.trim().toLowerCase());
      if (byHeader) {
        return { ...byHeader, source: 'header' };
      }
    }

    const fallback = await this.tenantResolver.resolveBySlug(this.config.defaultTenantSlug);
    return fallback ? { ...fallback, source: 'default' } : null;
  }

  private isPlatformHost(hostname: string): boolean {
    return (
      hostname === this.config.platformRootDomain ||
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.endsWith('.local')
    );
  }
}
```

FILE: apps/api/src/common/pipes/global-validation.pipe.ts

```typescript
import { Injectable, ValidationPipe, type ValidationError } from '@nestjs/common';
import type { ValidationErrorDetail } from '@wlct/shared-types';

import { ValidationException } from '../errors/app.exception';

/**
 * Global class-validator pipe for DTO based endpoints.
 *
 * Hardening choices:
 *   - `whitelist` strips unknown properties (mass-assignment protection).
 *   - `forbidNonWhitelisted` rejects requests that try to send them at all.
 *   - `transform` produces real class instances so `@Type` conversions apply.
 *   - errors are flattened into the platform's ValidationErrorDetail contract.
 */
@Injectable()
export class GlobalValidationPipe extends ValidationPipe {
  constructor() {
    super({
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      stopAtFirstError: false,
      validationError: { target: false, value: false },
      exceptionFactory: (errors: ValidationError[]) =>
        new ValidationException(flattenValidationErrors(errors)),
    });
  }
}

export function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): ValidationErrorDetail[] {
  const details: ValidationErrorDetail[] = [];

  for (const error of errors) {
    const path = parentPath ? `${parentPath}.${error.property}` : error.property;

    if (error.constraints) {
      for (const [constraint, message] of Object.entries(error.constraints)) {
        details.push({ field: path, constraint, message });
      }
    }

    if (error.children && error.children.length > 0) {
      details.push(...flattenValidationErrors(error.children, path));
    }
  }

  return details;
}
```

FILE: apps/api/src/common/pipes/index.ts

```typescript
export * from './global-validation.pipe';
export * from './zod-validation.pipe';
export * from './parse-uuid.pipe';
```

FILE: apps/api/src/common/pipes/parse-uuid.pipe.ts

```typescript
import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import { ValidationException } from '../errors/app.exception';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates UUID route parameters before they reach Prisma. Postgres raises a
 * type error for malformed uuids, which would otherwise surface as a 500.
 */
@Injectable()
export class ParseUuidPipe implements PipeTransform<string, string> {
  transform(value: string, metadata: ArgumentMetadata): string {
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
      throw new ValidationException([
        {
          field: metadata.data ?? 'id',
          constraint: 'isUuid',
          message: 'Must be a valid UUID',
        },
      ]);
    }
    return value.toLowerCase();
  }
}
```

FILE: apps/api/src/common/pipes/zod-validation.pipe.ts

```typescript
import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import type { ZodError, ZodSchema } from 'zod';
import type { ValidationErrorDetail } from '@wlct/shared-types';

import { ValidationException } from '../errors/app.exception';

/**
 * Runs a zod schema over an incoming payload and converts failures into the
 * platform's standard validation error envelope.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform<unknown, unknown> {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    const result = this.schema.safeParse(value);
    if (result.success) {
      return result.data;
    }
    throw new ValidationException(toValidationDetails(result.error));
  }
}

export function toValidationDetails(error: ZodError): ValidationErrorDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join('.') : '(root)',
    constraint: issue.code,
    message: issue.message,
  }));
}
```

FILE: apps/api/src/common/rate-limit/rate-limit.module.ts

```typescript
import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';

import { AppConfigService } from '../../config/app-config.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { RedisThrottlerStorage } from './redis-throttler.storage';

/**
 * Distributed rate limiting.
 *
 * Counters live in Redis so the limit is enforced across every API replica -
 * an in-memory limiter would let an attacker multiply their allowance by the
 * number of pods behind the load balancer.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [AppConfigService, RedisService],
      useFactory: (config: AppConfigService, redis: RedisService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: config.rateLimitTtlSeconds * 1000,
            limit: config.rateLimitEnabled ? config.rateLimitMax : Number.MAX_SAFE_INTEGER,
          },
          {
            name: 'auth',
            ttl: config.rateLimitAuthTtlSeconds * 1000,
            limit: config.rateLimitEnabled ? config.rateLimitAuthMax : Number.MAX_SAFE_INTEGER,
          },
        ],
        storage: new RedisThrottlerStorage(redis),
        // Health probes and internal traffic bypass the limiter.
        skipIf: (context) => {
          const request = context.switchToHttp().getRequest<{ path?: string; ip?: string }>();
          const path = request?.path ?? '';
          if (path.startsWith('/health')) {
            return true;
          }
          return false;
        },
        errorMessage: 'Too many requests. Please slow down and try again shortly.',
      }),
    }),
  ],
  providers: [RedisThrottlerStorage],
  exports: [ThrottlerModule],
})
export class RateLimitModule {}
```

FILE: apps/api/src/common/rate-limit/redis-throttler.storage.ts

```typescript
import { Injectable } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';

import { RedisService } from '../../infrastructure/redis/redis.service';

/**
 * Redis backed sliding-window counter for @nestjs/throttler.
 *
 * The increment and the TTL are applied in one round trip; the block key is a
 * separate short-lived entry so a blocked caller stays blocked even if their
 * window counter expires.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const client = this.redis.client;
    const counterKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `throttle:block:${throttlerName}:${key}`;

    const blockTtl = await client.pttl(blockKey);
    if (blockTtl > 0) {
      return {
        totalHits: limit + 1,
        timeToExpire: Math.ceil(blockTtl / 1000),
        isBlocked: true,
        timeToBlockExpire: Math.ceil(blockTtl / 1000),
      };
    }

    const pipeline = client.multi();
    pipeline.incr(counterKey);
    pipeline.pttl(counterKey);
    const results = await pipeline.exec();

    const totalHits = Number(results?.[0]?.[1] ?? 1);
    let remainingTtl = Number(results?.[1]?.[1] ?? -1);

    if (remainingTtl < 0) {
      await client.pexpire(counterKey, ttl);
      remainingTtl = ttl;
    }

    if (totalHits > limit) {
      const effectiveBlock = blockDuration > 0 ? blockDuration : ttl;
      await client.set(blockKey, '1', 'PX', effectiveBlock);
      return {
        totalHits,
        timeToExpire: Math.ceil(remainingTtl / 1000),
        isBlocked: true,
        timeToBlockExpire: Math.ceil(effectiveBlock / 1000),
      };
    }

    return {
      totalHits,
      timeToExpire: Math.ceil(remainingTtl / 1000),
      isBlocked: false,
      timeToBlockExpire: 0,
    };
  }
}
```

FILE: apps/api/src/common/types/request.types.ts

```typescript
import type { Request } from 'express';
import type { AuthenticatedActor } from '@wlct/shared-types';

export interface TenantContext {
  tenantId: string;
  slug: string;
  status: string;
  /** How the tenant was identified; useful for auditing spoof attempts. */
  source: 'jwt' | 'domain' | 'subdomain' | 'header' | 'default';
  defaultLocale: string;
  defaultCurrency: string;
}

/** Express request enriched by the middleware/guard pipeline. */
export interface AppRequest extends Request {
  requestId: string;
  /** Part 9: cross-service correlation id. Always set - the middleware
   *  accepts an inbound x-correlation-id only when it is a UUID and
   *  otherwise mints one, exactly like requestId. */
  correlationId: string;
  startTime: number;
  ipHash: string;
  locale: string;
  tenantContext?: TenantContext;
  actor?: AuthenticatedActor;
}
```

FILE: apps/api/src/config/app-config.module.ts

```typescript
import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppConfigService } from './app-config.service';
import { validateEnvironment } from './env.validation';

/**
 * Loads and validates environment configuration exactly once, then exposes it
 * through a strongly typed service.
 *
 * The rule this module exists to enforce is that no other file reads
 * `process.env` unvalidated - and it has exactly two exceptions, both of which
 * describe the built artefact rather than the deployment: `APP_VERSION` and
 * `GIT_COMMIT_SHA`, read in `modules/health/health.service.ts`. They are absent
 * from this schema on purpose (a build stamp is not a configuration knob, and a
 * default here would fabricate a commit that never happened), they are documented
 * in the root `.env.example`, and `apps/api/src/config/env-example-coverage.spec.ts`
 * refuses a third exception silently appearing: any direct `process.env` read
 * outside this package must be either a schema key or named in that file. The
 * sentence used to read "Nothing else in the codebase reads `process.env`
 * directly", which had been untrue for two of them.
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: true,
      envFilePath: ['.env.local', '.env', '../../.env'],
      validate: validateEnvironment,
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService, ConfigModule],
})
export class AppConfigModule {}
```

FILE: apps/api/src/config/app-config.service.ts

```typescript
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv, NodeEnvironment } from '@wlct/config';
import { parseDurationToMs, parseDurationToSeconds } from '@wlct/utils';

export interface RedisConnectionOptions {
  host: string;
  port: number;
  password?: string;
  db: number;
  tls?: Record<string, never>;
  keyPrefix: string;
  maxRetriesPerRequest: number | null;
  enableReadyCheck: boolean;
}

/**
 * Typed, memoised accessor over the validated environment.
 *
 * Every consumer depends on this class instead of `ConfigService.get(...)`,
 * which removes stringly-typed lookups and gives a single place to derive
 * computed values (durations in ms, Redis connection objects, CORS validators).
 */
@Injectable()
export class AppConfigService {
  private readonly env: AppEnv;

  constructor(private readonly configService: ConfigService) {
    // `validate()` in AppConfigModule has already coerced and checked every
    // variable, so reads go through ConfigService to pick up the parsed values
    // (numbers, booleans, arrays) rather than the raw strings in process.env.
    this.env = new Proxy({} as AppEnv, {
      get: (_target, property: string | symbol) =>
        typeof property === 'string' ? this.configService.get(property) : undefined,
    }) as AppEnv;
  }

  // ---------------------------------------------------------------------------
  // Application
  // ---------------------------------------------------------------------------

  get nodeEnv(): NodeEnvironment {
    return this.env.NODE_ENV;
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get isDevelopment(): boolean {
    return this.env.NODE_ENV === 'development';
  }

  get isTest(): boolean {
    return this.env.NODE_ENV === 'test';
  }

  get appName(): string {
    return this.env.APP_NAME;
  }

  get port(): number {
    return this.env.API_PORT;
  }

  get host(): string {
    return this.env.API_HOST;
  }

  get globalPrefix(): string {
    return this.env.API_GLOBAL_PREFIX;
  }

  get defaultApiVersion(): string {
    return this.env.API_DEFAULT_VERSION;
  }

  get publicUrl(): string {
    return this.env.API_PUBLIC_URL;
  }

  get adminWebUrl(): string {
    return this.env.ADMIN_WEB_URL;
  }

  get trustProxyHops(): number {
    return this.env.TRUST_PROXY_HOPS;
  }

  get platformRootDomain(): string {
    return this.env.PLATFORM_ROOT_DOMAIN;
  }

  get defaultTenantSlug(): string {
    return this.env.DEFAULT_TENANT_SLUG;
  }

  // ---------------------------------------------------------------------------
  // Database
  // ---------------------------------------------------------------------------

  get databaseUrl(): string {
    return this.env.DATABASE_URL;
  }

  get databaseLogQueries(): boolean {
    return this.env.DATABASE_LOG_QUERIES;
  }

  // ---------------------------------------------------------------------------
  // Redis
  // ---------------------------------------------------------------------------

  get redisOptions(): RedisConnectionOptions {
    return {
      host: this.env.REDIS_HOST,
      port: this.env.REDIS_PORT,
      password: this.env.REDIS_PASSWORD || undefined,
      db: this.env.REDIS_DB,
      tls: this.env.REDIS_TLS ? {} : undefined,
      keyPrefix: this.env.REDIS_KEY_PREFIX,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    };
  }

  /**
   * BullMQ requires `maxRetriesPerRequest: null` and no key prefix collisions.
   *
   * The prefix is stripped by rebuilding the object rather than by destructuring
   * it away: an unused binding is dead weight the linter is right to flag, and
   * naming the retained fields makes it obvious that dropping `keyPrefix` is the
   * whole point of the method.
   */
  get queueRedisOptions(): Omit<RedisConnectionOptions, 'keyPrefix'> {
    const options = this.redisOptions;
    return {
      host: options.host,
      port: options.port,
      password: options.password,
      db: options.db,
      tls: options.tls,
      maxRetriesPerRequest: options.maxRetriesPerRequest,
      enableReadyCheck: options.enableReadyCheck,
    };
  }

  get redisKeyPrefix(): string {
    return this.env.REDIS_KEY_PREFIX;
  }

  // ---------------------------------------------------------------------------
  // JWT
  // ---------------------------------------------------------------------------

  get jwtAlgorithm(): AppEnv['JWT_ALGORITHM'] {
    return this.env.JWT_ALGORITHM;
  }

  get jwtUsesAsymmetricKeys(): boolean {
    return this.env.JWT_ALGORITHM.startsWith('RS');
  }

  get jwtAccessSigningKey(): string {
    if (this.jwtUsesAsymmetricKeys) {
      return Buffer.from(this.env.JWT_PRIVATE_KEY_BASE64 ?? '', 'base64').toString('utf8');
    }
    return this.env.JWT_ACCESS_SECRET ?? '';
  }

  get jwtAccessVerificationKey(): string {
    if (this.jwtUsesAsymmetricKeys) {
      return Buffer.from(this.env.JWT_PUBLIC_KEY_BASE64 ?? '', 'base64').toString('utf8');
    }
    return this.env.JWT_ACCESS_SECRET ?? '';
  }

  get jwtRefreshSigningKey(): string {
    if (this.jwtUsesAsymmetricKeys) {
      return Buffer.from(this.env.JWT_PRIVATE_KEY_BASE64 ?? '', 'base64').toString('utf8');
    }
    return this.env.JWT_REFRESH_SECRET ?? '';
  }

  get jwtRefreshVerificationKey(): string {
    if (this.jwtUsesAsymmetricKeys) {
      return Buffer.from(this.env.JWT_PUBLIC_KEY_BASE64 ?? '', 'base64').toString('utf8');
    }
    return this.env.JWT_REFRESH_SECRET ?? '';
  }

  get accessTokenTtl(): string {
    return this.env.JWT_ACCESS_TTL;
  }

  get accessTokenTtlSeconds(): number {
    return parseDurationToSeconds(this.env.JWT_ACCESS_TTL);
  }

  get refreshTokenTtl(): string {
    return this.env.JWT_REFRESH_TTL;
  }

  get refreshTokenTtlSeconds(): number {
    return parseDurationToSeconds(this.env.JWT_REFRESH_TTL);
  }

  get refreshTokenTtlMs(): number {
    return parseDurationToMs(this.env.JWT_REFRESH_TTL);
  }

  get jwtIssuer(): string {
    return this.env.JWT_ISSUER;
  }

  get jwtAudience(): string {
    return this.env.JWT_AUDIENCE;
  }

  get maxActiveSessionsPerUser(): number {
    return this.env.MAX_ACTIVE_SESSIONS_PER_USER;
  }

  // ---------------------------------------------------------------------------
  // Password & account protection
  // ---------------------------------------------------------------------------

  get passwordMinLength(): number {
    return this.env.PASSWORD_MIN_LENGTH;
  }

  get argon2Options(): { memoryCost: number; timeCost: number; parallelism: number } {
    return {
      memoryCost: this.env.ARGON2_MEMORY_COST,
      timeCost: this.env.ARGON2_TIME_COST,
      parallelism: this.env.ARGON2_PARALLELISM,
    };
  }

  get loginMaxFailedAttempts(): number {
    return this.env.LOGIN_MAX_FAILED_ATTEMPTS;
  }

  get loginFailedWindowSeconds(): number {
    return this.env.LOGIN_FAILED_WINDOW_SECONDS;
  }

  get accountLockoutSeconds(): number {
    return this.env.ACCOUNT_LOCKOUT_SECONDS;
  }

  // ---------------------------------------------------------------------------
  // Encryption
  // ---------------------------------------------------------------------------

  get encryptionMasterKeyBase64(): string {
    return this.env.ENCRYPTION_MASTER_KEY_BASE64;
  }

  get encryptionKeyId(): string {
    return this.env.ENCRYPTION_KEY_ID;
  }

  get encryptionPreviousKeys(): Record<string, string> {
    return this.env.ENCRYPTION_PREVIOUS_KEYS_JSON ?? {};
  }

  get encryptionProvider(): 'local' | 'kms' {
    return this.env.ENCRYPTION_PROVIDER;
  }

  get blindIndexKeyBase64(): string {
    return this.env.BLIND_INDEX_KEY_BASE64;
  }

  // ---------------------------------------------------------------------------
  // Two factor
  // ---------------------------------------------------------------------------

  get twoFactorIssuer(): string {
    return this.env.TWO_FACTOR_ISSUER;
  }

  get twoFactorWindow(): number {
    return this.env.TWO_FACTOR_WINDOW;
  }

  get twoFactorDigits(): number {
    return this.env.TWO_FACTOR_DIGITS;
  }

  get twoFactorPeriod(): number {
    return this.env.TWO_FACTOR_PERIOD;
  }

  get twoFactorRecoveryCodeCount(): number {
    return this.env.TWO_FACTOR_RECOVERY_CODES;
  }

  get twoFactorChallengeTtl(): string {
    return this.env.TWO_FACTOR_CHALLENGE_TTL;
  }

  get twoFactorChallengeTtlSeconds(): number {
    return parseDurationToSeconds(this.env.TWO_FACTOR_CHALLENGE_TTL);
  }

  get twoFactorMaxChallengeAttempts(): number {
    return this.env.TWO_FACTOR_MAX_CHALLENGE_ATTEMPTS;
  }

  // ---------------------------------------------------------------------------
  // CORS
  // ---------------------------------------------------------------------------

  get corsEnabled(): boolean {
    return this.env.CORS_ENABLED;
  }

  get corsOrigins(): string[] {
    return this.env.CORS_ORIGINS;
  }

  get corsCredentials(): boolean {
    return this.env.CORS_CREDENTIALS;
  }

  get corsAllowedHeaders(): string[] {
    return this.env.CORS_ALLOWED_HEADERS;
  }

  get corsExposedHeaders(): string[] {
    return this.env.CORS_EXPOSED_HEADERS;
  }

  /**
   * Allows configured origins plus any tenant custom domain that resolves under
   * the platform root domain. Unknown origins are rejected rather than echoed.
   */
  get corsOriginValidator(): (
    origin: string | undefined,
    callback: (error: Error | null, allow?: boolean) => void,
  ) => void {
    const allowList = new Set(this.corsOrigins);
    const rootDomain = this.platformRootDomain;
    const allowAnyInDev = !this.isProduction;

    return (origin, callback) => {
      if (!origin) {
        // Same-origin, curl, and mobile apps send no Origin header.
        callback(null, true);
        return;
      }
      if (allowList.has(origin)) {
        callback(null, true);
        return;
      }
      try {
        const { hostname, protocol } = new URL(origin);
        if (protocol === 'https:' && (hostname === rootDomain || hostname.endsWith(`.${rootDomain}`))) {
          callback(null, true);
          return;
        }
        if (allowAnyInDev && (hostname === 'localhost' || hostname === '127.0.0.1')) {
          callback(null, true);
          return;
        }
      } catch {
        callback(null, false);
        return;
      }
      callback(null, false);
    };
  }

  // ---------------------------------------------------------------------------
  // Rate limiting
  // ---------------------------------------------------------------------------

  get rateLimitEnabled(): boolean {
    return this.env.RATE_LIMIT_ENABLED;
  }

  get rateLimitTtlSeconds(): number {
    return this.env.RATE_LIMIT_TTL_SECONDS;
  }

  get rateLimitMax(): number {
    return this.env.RATE_LIMIT_MAX;
  }

  get rateLimitAuthTtlSeconds(): number {
    return this.env.RATE_LIMIT_AUTH_TTL_SECONDS;
  }

  get rateLimitAuthMax(): number {
    return this.env.RATE_LIMIT_AUTH_MAX;
  }

  get rateLimitTrustedIps(): string[] {
    return this.env.RATE_LIMIT_TRUSTED_IPS;
  }

  // ---------------------------------------------------------------------------
  // Swagger
  // ---------------------------------------------------------------------------

  get swaggerEnabled(): boolean {
    return this.env.SWAGGER_ENABLED;
  }

  get swaggerPath(): string {
    return this.env.SWAGGER_PATH;
  }

  get swaggerTitle(): string {
    return this.env.SWAGGER_TITLE;
  }

  get swaggerDescription(): string {
    return this.env.SWAGGER_DESCRIPTION;
  }

  get swaggerVersion(): string {
    return this.env.SWAGGER_VERSION;
  }

  get swaggerCredentials(): { user?: string; password?: string } {
    return { user: this.env.SWAGGER_USER, password: this.env.SWAGGER_PASSWORD };
  }

  // ---------------------------------------------------------------------------
  // Logging
  // ---------------------------------------------------------------------------

  get logLevel(): AppEnv['LOG_LEVEL'] {
    return this.env.LOG_LEVEL;
  }

  get logFormat(): 'json' | 'pretty' {
    return this.env.LOG_FORMAT;
  }

  get logRequestBody(): boolean {
    return this.env.LOG_REQUEST_BODY;
  }

  // ---------------------------------------------------------------------------
  // WebSocket
  // ---------------------------------------------------------------------------

  get wsEnabled(): boolean {
    return this.env.WS_ENABLED;
  }

  get wsPath(): string {
    return this.env.WS_PATH;
  }

  get wsNamespace(): string {
    return this.env.WS_NAMESPACE;
  }

  get wsPingIntervalMs(): number {
    return this.env.WS_PING_INTERVAL_MS;
  }

  get wsPingTimeoutMs(): number {
    return this.env.WS_PING_TIMEOUT_MS;
  }

  get wsMaxConnectionsPerUser(): number {
    return this.env.WS_MAX_CONNECTIONS_PER_USER;
  }

  get wsRedisAdapterEnabled(): boolean {
    return this.env.WS_REDIS_ADAPTER;
  }

  // ---------------------------------------------------------------------------
  // Queues
  // ---------------------------------------------------------------------------

  get queuePrefix(): string {
    return this.env.QUEUE_PREFIX;
  }

  get queueDefaultAttempts(): number {
    return this.env.QUEUE_DEFAULT_ATTEMPTS;
  }

  get queueBackoffMs(): number {
    return this.env.QUEUE_BACKOFF_MS;
  }

  get queueRemoveOnComplete(): number {
    return this.env.QUEUE_REMOVE_ON_COMPLETE;
  }

  get queueRemoveOnFail(): number {
    return this.env.QUEUE_REMOVE_ON_FAIL;
  }

  get queueConcurrency(): number {
    return this.env.QUEUE_CONCURRENCY;
  }

  get queueRunInlineWorkers(): boolean {
    return this.env.QUEUE_RUN_INLINE_WORKERS;
  }

  // ---------------------------------------------------------------------------
  // Part 11: trading-worker plane + read-replica policy
  // ---------------------------------------------------------------------------

  get workerEnabled(): boolean {
    return this.env.WORKER_ENABLED;
  }

  private workerIdMemo: string | null = null;

  /** Composed identity when not configured; set WORKER_ID per replica in the
   * deployment so a restart reclaims its own partition claims.
   *
   * MEMOIZED on purpose: the composition contains a fresh UUID, and several
   * consumers compare this id across calls (claim value round-trips, the
   * registry self-check "did my ping list ME"). A getter that returned a
   * new identity per read would make every such comparison false - the
   * worker would never see itself in its own fleet. Within one process the
   * identity is a constant; across restarts it is not. */
  get workerId(): string {
    if (this.workerIdMemo !== null) {
      return this.workerIdMemo;
    }
    const configured = this.env.WORKER_ID;
    const composed =
      configured !== undefined && configured.length > 0
        ? configured
        : `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
    this.workerIdMemo = composed;
    return composed;
  }

  /** Config-declared fleet membership for the partition assignment; empty
   * means this single worker. Ordering is irrelevant by construction (the
   * assignment math sorts). */
  get workerMembership(): string[] {
    const raw = this.env.WORKER_MEMBERSHIP;
    const listed = raw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return listed.length > 0 ? listed : [this.workerId];
  }

  /** Which source drives live membership: config-declared list (Part 11)
   * or the Redis self-registration registry (Part 12). Read defensively:
   * the schema enum is the gate, and anything unrecognised boots as
   * 'config' - the pre-Part-12 behaviour - rather than throwing from a
   * hot getter the coordination loop cannot survive. */
  get workerMembershipMode(): 'config' | 'registry' {
    return this.env.WORKER_MEMBERSHIP_MODE === 'registry' ? 'registry' : 'config';
  }

  get workerMembershipTtlMs(): number {
    return this.env.WORKER_MEMBERSHIP_TTL_MS;
  }

  get workerPartitionCount(): number {
    return this.env.WORKER_PARTITION_COUNT;
  }

  get workerPartitionLeaseTtlMs(): number {
    return this.env.WORKER_PARTITION_LEASE_TTL_MS;
  }

  get workerPartitionRetryMs(): number {
    return this.env.WORKER_PARTITION_RETRY_MS;
  }

  get workerDeferDelayMs(): number {
    return this.env.WORKER_DEFER_DELAY_MS;
  }

  get workerMaxDefers(): number {
    return this.env.WORKER_MAX_DEFERS;
  }

  get workerShutdownTimeoutMs(): number {
    return this.env.WORKER_SHUTDOWN_TIMEOUT_MS;
  }

  get executionEngineUrl(): string {
    return this.env.EXECUTION_ENGINE_URL;
  }

  /** Secret: readable only where it is needed, never logged, never echoed
   * into a response - the same discipline as every token on this service. */
  get executionEngineToken(): string | undefined {
    return this.env.EXECUTION_ENGINE_TOKEN;
  }

  get databaseReadEnabled(): boolean {
    return this.env.DATABASE_READ_ENABLED;
  }

  get databaseReadUrl(): string | undefined {
    return this.env.DATABASE_READ_URL;
  }

  get databaseReadMaxLagMs(): number {
    return this.env.DATABASE_READ_MAX_LAG_MS;
  }

  // ---------------------------------------------------------------------------
  // Exchanges and internal services
  // ---------------------------------------------------------------------------

  get enabledExchanges(): string[] {
    return this.env.EXCHANGES_ENABLED;
  }

  get exchangeSandboxMode(): boolean {
    return this.env.EXCHANGE_SANDBOX_MODE;
  }

  get executionEnabled(): boolean {
    return this.env.EXECUTION_ENABLED;
  }

  // ---------------------------------------------------------------------------
  // Authenticated execution (Part 5)
  // ---------------------------------------------------------------------------
  // Note what is absent: there is no getter returning BINANCE_API_SECRET, or
  // any other raw credential. The API process never needs one. Credentials are
  // resolved inside the trading service's credential provider, and the only
  // thing this class exposes about them is whether a platform-level pair was
  // configured at all.

  get liveTradingEnabled(): boolean {
    return this.env.LIVE_TRADING_ENABLED;
  }

  get dryRun(): boolean {
    return this.env.DRY_RUN;
  }

  get paperTrading(): boolean {
    return this.env.PAPER_TRADING;
  }

  /**
   * The effective trading mode after all switches are combined.
   *
   * Resolution is deliberately pessimistic and the order of the checks is the
   * whole point: DRY_RUN wins over everything, then PAPER, and LIVE is only
   * reached when every switch explicitly permits it. There is no path through
   * this function where an unset variable produces LIVE.
   */
  get tradingMode(): 'DISABLED' | 'DRY_RUN' | 'PAPER' | 'LIVE' {
    if (!this.env.EXECUTION_ENABLED) {
      return 'DISABLED';
    }
    if (this.env.DRY_RUN) {
      return 'DRY_RUN';
    }
    if (this.env.PAPER_TRADING) {
      return 'PAPER';
    }
    if (this.env.LIVE_TRADING_ENABLED) {
      return 'LIVE';
    }
    return 'DISABLED';
  }

  /** True when a platform-level venue credential pair is configured. */
  get hasPlatformExchangeCredentials(): boolean {
    return Boolean(this.env.BINANCE_API_KEY) && Boolean(this.env.BINANCE_API_SECRET);
  }

  get orderRequestTimeoutMs(): number {
    return this.env.ORDER_REQUEST_TIMEOUT_MS;
  }

  get orderReconciliationIntervalMs(): number {
    return this.env.ORDER_RECONCILIATION_INTERVAL_MS;
  }

  get privateStreamReconnectEnabled(): boolean {
    return this.env.PRIVATE_STREAM_RECONNECT_ENABLED;
  }

  get exchangeTimeSyncIntervalMs(): number {
    return this.env.EXCHANGE_TIME_SYNC_INTERVAL_MS;
  }

  get executionIdempotencyTtlSeconds(): number {
    return this.env.EXECUTION_IDEMPOTENCY_TTL_SECONDS;
  }

  get orderUnknownReconciliationDelayMs(): number {
    return this.env.ORDER_UNKNOWN_RECONCILIATION_DELAY_MS;
  }

  /**
   * Everything the admin UI is allowed to know about execution configuration.
   * Booleans and durations only - assembled explicitly rather than by spreading
   * the env object, so a credential can never be added to the response by
   * accident later.
   */
  get executionSafetySummary(): {
    executionEnabled: boolean;
    tradingMode: 'DISABLED' | 'DRY_RUN' | 'PAPER' | 'LIVE';
    liveTradingEnabled: boolean;
    dryRun: boolean;
    paperTrading: boolean;
    sandboxMode: boolean;
    platformCredentialsConfigured: boolean;
    orderRequestTimeoutMs: number;
    orderReconciliationIntervalMs: number;
    orderUnknownReconciliationDelayMs: number;
    exchangeTimeSyncIntervalMs: number;
    executionIdempotencyTtlSeconds: number;
    privateStreamReconnectEnabled: boolean;
  } {
    return {
      executionEnabled: this.executionEnabled,
      tradingMode: this.tradingMode,
      liveTradingEnabled: this.liveTradingEnabled,
      dryRun: this.dryRun,
      paperTrading: this.paperTrading,
      sandboxMode: this.exchangeSandboxMode,
      platformCredentialsConfigured: this.hasPlatformExchangeCredentials,
      orderRequestTimeoutMs: this.orderRequestTimeoutMs,
      orderReconciliationIntervalMs: this.orderReconciliationIntervalMs,
      orderUnknownReconciliationDelayMs: this.orderUnknownReconciliationDelayMs,
      exchangeTimeSyncIntervalMs: this.exchangeTimeSyncIntervalMs,
      executionIdempotencyTtlSeconds: this.executionIdempotencyTtlSeconds,
      privateStreamReconnectEnabled: this.privateStreamReconnectEnabled,
    };
  }

  // ---------------------------------------------------------------------------
  // Strategy engine, paper trading and backtesting (Part 6)
  // ---------------------------------------------------------------------------
  // None of these getters can enable live trading. `strategyEngineEnabled`
  // says whether strategies run; where their signals may go is still decided
  // by `tradingMode` above, which is unchanged by anything in this section.

  get strategyEngineEnabled(): boolean {
    return this.env.STRATEGY_ENGINE_ENABLED;
  }

  get paperTradingEnabled(): boolean {
    return this.env.PAPER_TRADING_ENABLED;
  }

  get backtestEnabled(): boolean {
    return this.env.BACKTEST_ENABLED;
  }

  get strategyEventQueueSize(): number {
    return this.env.STRATEGY_EVENT_QUEUE_SIZE;
  }

  get strategyMaxInstances(): number {
    return this.env.STRATEGY_MAX_INSTANCES;
  }

  /**
   * Observation budget for one strategy dispatch, in milliseconds.
   *
   * Exceeding it increments a counter and marks the dispatch slow. It is not
   * a guarantee, and this platform makes no latency guarantee of any kind.
   */
  get strategyMaxProcessingLatencyMs(): number {
    return this.env.STRATEGY_MAX_PROCESSING_LATENCY_MS;
  }

  get signalMaxAgeMs(): number {
    return this.env.SIGNAL_MAX_AGE_MS;
  }

  get signalDedupTtlSeconds(): number {
    return this.env.SIGNAL_DEDUP_TTL_SECONDS;
  }

  /**
   * Default backtest execution assumptions.
   *
   * Returned as strings, not numbers: they are exact decimals that end up in
   * Decimal arithmetic and in the configuration hash of every run, and a
   * binary float would corrupt both.
   */
  get backtestDefaults(): {
    initialCapital: string;
    makerFee: string;
    takerFee: string;
    slippageBps: string;
  } {
    return {
      initialCapital: this.env.BACKTEST_DEFAULT_INITIAL_CAPITAL,
      makerFee: this.env.BACKTEST_DEFAULT_MAKER_FEE,
      takerFee: this.env.BACKTEST_DEFAULT_TAKER_FEE,
      slippageBps: this.env.BACKTEST_DEFAULT_SLIPPAGE_BPS,
    };
  }

  /**
   * Everything the admin UI may know about the strategy layer.
   *
   * Assembled field by field for the same reason as
   * {@link executionSafetySummary}: nothing is spread in, so a credential can
   * never arrive here by accident. `liveExecutionReachable` is stated
   * explicitly so an operator can see at a glance that enabling strategies did
   * not enable live orders.
   */
  get strategySafetySummary(): {
    strategyEngineEnabled: boolean;
    paperTradingEnabled: boolean;
    backtestEnabled: boolean;
    liveExecutionReachable: boolean;
    tradingMode: 'DISABLED' | 'DRY_RUN' | 'PAPER' | 'LIVE';
    maxInstances: number;
    eventQueueSize: number;
    maxProcessingLatencyMs: number;
    signalMaxAgeMs: number;
    signalDedupTtlSeconds: number;
    backtestDefaults: {
      initialCapital: string;
      makerFee: string;
      takerFee: string;
      slippageBps: string;
    };
    disclaimer: string;
  } {
    return {
      strategyEngineEnabled: this.strategyEngineEnabled,
      paperTradingEnabled: this.paperTradingEnabled,
      backtestEnabled: this.backtestEnabled,
      liveExecutionReachable: this.tradingMode === 'LIVE',
      tradingMode: this.tradingMode,
      maxInstances: this.strategyMaxInstances,
      eventQueueSize: this.strategyEventQueueSize,
      maxProcessingLatencyMs: this.strategyMaxProcessingLatencyMs,
      signalMaxAgeMs: this.signalMaxAgeMs,
      signalDedupTtlSeconds: this.signalDedupTtlSeconds,
      backtestDefaults: this.backtestDefaults,
      disclaimer:
        'Backtest and paper results are simulated. Backtest performance is ' +
        'not indicative of future performance; paper performance is not ' +
        'indicative of live performance.',
    };
  }

  // ---------------------------------------------------------------------------
  // Historical datasets (Part 7)
  // ---------------------------------------------------------------------------
  // The dataset layer is storage and integrity. None of these getters can
  // enable live trading, and none of them describe a venue connection: an
  // ingestion job reads public archives and the backtest engine reads the
  // frozen result. What the summary exposes is *why a backtest is
  // reproducible*: which storage serves datasets, whether ingestion may run,
  // and whether runs must cite a registered dataset version.

  get datasetStorage(): {
    backend: 'local';
    localRoot: string;
    stagingRoot: string;
    maxPartitionBytes: number;
    readerBufferSize: number;
    maxEventsPerPartition: number;
    maxGapWarnings: number;
    validationEnabled: boolean;
    retentionPolicy: 'retain' | 'purge_staging_only';
  } {
    return {
      backend: this.env.DATASET_STORAGE_BACKEND,
      localRoot: this.env.DATASET_LOCAL_ROOT,
      stagingRoot: this.env.DATASET_TEMP_ROOT,
      maxPartitionBytes: this.env.DATASET_MAX_PARTITION_BYTES,
      readerBufferSize: this.env.DATASET_READER_BUFFER_SIZE,
      maxEventsPerPartition: this.env.DATASET_MAX_EVENTS_PER_PARTITION,
      maxGapWarnings: this.env.DATASET_MAX_GAP_WARNINGS,
      validationEnabled: this.env.DATASET_VALIDATION_ENABLED,
      retentionPolicy: this.env.DATASET_RETENTION_POLICY,
    };
  }

  get historicalIngestionEnabled(): boolean {
    return this.env.HISTORICAL_INGESTION_ENABLED;
  }

  get backtestDatasetRequired(): boolean {
    return this.env.BACKTEST_DATASET_REQUIRED;
  }
  /**
   * Everything the admin UI may know about the dataset layer.
   *
   * Field by field for the same reason as {@link strategySafetySummary}:
   * nothing is spread in, so a credential-shaped value cannot arrive by
   * accident. There are no credentials here to begin with - historical
   * market data is public - but the assembly discipline is what keeps it
   * that way when someone adds the next field.
   */
  get datasetSafetySummary(): {
    ingestionEnabled: boolean;
    datasetRequiredForBacktests: boolean;
    storage: {
      backend: 'local';
      localRoot: string;
      stagingRoot: string;
      maxPartitionBytes: number;
      readerBufferSize: number;
      maxEventsPerPartition: number;
      maxGapWarnings: number;
      validationEnabled: boolean;
      retentionPolicy: 'retain' | 'purge_staging_only';
    };
    note: string;
  } {
    return {
      ingestionEnabled: this.historicalIngestionEnabled,
      datasetRequiredForBacktests: this.backtestDatasetRequired,
      storage: this.datasetStorage,
      note:
        'Datasets are frozen historical market data used for backtesting. ' +
        'They are not a trading input, cannot reach a venue, and a result ' +
        'computed over them is a simulation.',
    };
  }

  // ---------------------------------------------------------------------------
  // Part 8: risk engine control plane
  // ---------------------------------------------------------------------------

  get riskEngineEnabled(): boolean {
    return this.env.RISK_ENGINE_ENABLED;
  }

  get riskFailClosed(): boolean {
    return this.env.RISK_FAIL_CLOSED;
  }

  get maxRiskStateAgeMs(): number {
    return this.env.MAX_RISK_STATE_AGE_MS;
  }

  get riskSnapshotRefreshMs(): number {
    return this.env.RISK_SNAPSHOT_REFRESH_MS;
  }

  get riskEventsRetentionDays(): number {
    return this.env.RISK_EVENTS_RETENTION_DAYS;
  }

  /**
   * The platform-default ceilings this deployment publishes as the GLOBAL
   * layer of the risk hierarchy. They are strings because they are decimal
   * money all the way down: the API never runs them through Number beyond the
   * validation the env schema already performed.
   */
  get riskPlatformCeilings(): {
    maxOrderNotional: string;
    maxPositionNotional: string;
    maxAccountExposure: string;
    maxStrategyExposure: string;
    maxSymbolExposure: string;
    maxOpenOrders: number;
    maxDailyLoss: string;
    maxStrategyDailyLoss: string;
    maxDrawdownPercent: string;
    maxOrdersPerSecond: number;
    maxOrdersPerMinute: number;
    maxCancelsPerSecond: number;
    maxCancelsPerMinute: number;
    maxPriceDeviationBps: number;
    maxConsecutiveLosses: number;
  } {
    return {
      maxOrderNotional: this.env.MAX_ORDER_NOTIONAL,
      maxPositionNotional: this.env.MAX_POSITION_NOTIONAL,
      maxAccountExposure: this.env.MAX_ACCOUNT_EXPOSURE,
      maxStrategyExposure: this.env.MAX_STRATEGY_EXPOSURE,
      maxSymbolExposure: this.env.MAX_SYMBOL_EXPOSURE,
      maxOpenOrders: this.env.MAX_OPEN_ORDERS,
      maxDailyLoss: this.env.MAX_DAILY_LOSS,
      maxStrategyDailyLoss: this.env.MAX_STRATEGY_DAILY_LOSS,
      maxDrawdownPercent: this.env.MAX_DRAWDOWN,
      maxOrdersPerSecond: this.env.MAX_ORDERS_PER_SECOND,
      maxOrdersPerMinute: this.env.MAX_ORDERS_PER_MINUTE,
      maxCancelsPerSecond: this.env.MAX_CANCELS_PER_SECOND,
      maxCancelsPerMinute: this.env.MAX_CANCELS_PER_MINUTE,
      maxPriceDeviationBps: this.env.MAX_PRICE_DEVIATION_BPS,
      maxConsecutiveLosses: this.env.MAX_CONSECUTIVE_LOSSES,
    };
  }

  /**
   * The operator's single answer to "what is the risk posture of this
   * deployment, right now". Computed from configuration (the env) plus the
   * durable switch mirror, exactly like the Part 5 execution summary -
   * nothing cached, nothing assumed, and the blocking list states ALL
   * reasons at once so nobody releases a control to see whether the next
   * one was real.
   */
  get riskSafetySummary(): {
    engineEnabled: boolean;
    failClosed: boolean;
    maxRiskStateAgeMs: number;
    snapshotRefreshMs: number;
    refreshOutpacesStaleness: boolean;
    ceilings: AppConfigService['riskPlatformCeilings'];
    note: string;
  } {
    return {
      engineEnabled: this.riskEngineEnabled,
      failClosed: this.riskFailClosed,
      maxRiskStateAgeMs: this.maxRiskStateAgeMs,
      snapshotRefreshMs: this.riskSnapshotRefreshMs,
      refreshOutpacesStaleness:
        this.riskSnapshotRefreshMs < this.maxRiskStateAgeMs,
      ceilings: this.riskPlatformCeilings,
      note:
        'Risk controls reduce operational risk but cannot guarantee against ' +
        'all losses. These ceilings are the GLOBAL layer only; the effective ' +
        'limit is the tightest applicable entry across the whole hierarchy, ' +
        'resolved inside the engine. No API route approves an order.',
    };
  }

  get tradingEngineUrl(): string {
    return this.env.TRADING_ENGINE_URL;
  }

  // ------------------------------------------------------------------
  // Part 9: observability accessors. Every value here is *publication*
  // configuration; nothing in the trading path reads them, and nothing
  // here can switch a trading safety off.
  // ------------------------------------------------------------------

  get observabilityEnabled(): boolean {
    return this.configService.get<boolean>('OBSERVABILITY_ENABLED', true);
  }

  get metricsEnabled(): boolean {
    return this.configService.get<boolean>('METRICS_ENABLED', true);
  }

  get healthEnabled(): boolean {
    return this.configService.get<boolean>('HEALTH_ENABLED', true);
  }

  get prometheusEnabled(): boolean {
    return this.configService.get<boolean>('PROMETHEUS_ENABLED', true);
  }

  get prometheusPath(): string {
    return this.configService.get<string>('PROMETHEUS_PATH', '/metrics');
  }

  /** Optional scrape secret. NEVER returned by any summary and never
   *  interpolated into a log line - callers use it only for a constant-time
   *  comparison against the presented header. */
  get metricsToken(): string | undefined {
    return this.configService.get<string>('METRICS_TOKEN') ?? undefined;
  }

  get alertingEnabled(): boolean {
    return this.configService.get<boolean>('ALERTING_ENABLED', true);
  }

  get alertDedupWindowMs(): number {
    return this.configService.get<number>('ALERT_DEDUP_WINDOW_MS', 60_000);
  }

  get queueAlertAgeMs(): number {
    return this.configService.get<number>('QUEUE_ALERT_AGE_MS', 120_000);
  }

  get metricsExportIntervalMs(): number {
    return this.configService.get<number>('METRICS_EXPORT_INTERVAL_MS', 15_000);
  }

  get healthRefreshMs(): number {
    return this.configService.get<number>('HEALTH_REFRESH_MS', 5_000);
  }

  get alertRetentionDays(): number {
    return this.configService.get<number>('ALERT_RETENTION_DAYS', 90);
  }

  get incidentRetentionDays(): number {
    return this.configService.get<number>('INCIDENT_RETENTION_DAYS', 365);
  }

  /** Trading-engine ops surface: the gate documents this service publishes
   *  for the API's trading-readiness merge. Same base URL as the health
   *  probe; distinct path, so a probe outage and a telemetry outage are
   *  distinguishable in logs without a third URL to configure. */
  get tradingEngineOpsTradingUrl(): string {
    const base = this.configService.get<string>('TRADING_ENGINE_URL', 'http://localhost:8001');
    return `${base.replace(/\/+$/, '')}/health/trading`;
  }

  get tradingEngineOpsComponentsUrl(): string {
    const base = this.configService.get<string>('TRADING_ENGINE_URL', 'http://localhost:8001');
    return `${base.replace(/\/+$/, '')}/health/components`;
  }

  get tradingEngineOpsMetricsUrl(): string {
    const base = this.configService.get<string>('TRADING_ENGINE_URL', 'http://localhost:8001');
    return `${base.replace(/\/+$/, '')}/metrics`;
  }

  get marketDataOpsComponentsUrl(): string {
    const base = this.configService.get<string>('MARKET_DATA_URL', 'http://localhost:8002');
    return `${base.replace(/\/+$/, '')}/health/components`;
  }

  /** The sentence the operations panel shows about its own guarantees.
   *  Deliberately plain: no latency claims, no uptime claims. */
  get observabilitySafetySummary(): {
    observabilityEnabled: boolean;
    metricsEnabled: boolean;
    prometheusEnabled: boolean;
    alertingEnabled: boolean;
    alertRetentionDays: number;
    incidentRetentionDays: number;
    queueAlertAgeMs: number;
    tracingEnabled: boolean;
    sloEnabled: boolean;
    note: string;
  } {
    return {
      observabilityEnabled: this.observabilityEnabled,
      metricsEnabled: this.metricsEnabled,
      prometheusEnabled: this.prometheusEnabled,
      alertingEnabled: this.alertingEnabled,
      alertRetentionDays: this.alertRetentionDays,
      incidentRetentionDays: this.incidentRetentionDays,
      queueAlertAgeMs: this.queueAlertAgeMs,
      tracingEnabled: this.otelEnabled,
      sloEnabled: this.sloEnabled,
      note:
        'Observability describes the platform; it authorises nothing. Trading ' +
        'enforcement lives in the risk gate. Risk controls reduce operational ' +
        'risk but cannot guarantee against all losses.',
    };
  }

  // --- Part 10: reliability (tracing, SLO evaluation, fault posture) ------
  // These getters READ configuration; none of them can change it. The
  // one-way derivations (priority list parsing, multiplier -> ppm) live here
  // so every consumer sees the identical integers the validator was written
  // against, and so the ppm math happens once, in integer arithmetic.

  get otelEnabled(): boolean {
    return this.env.OTEL_ENABLED === true;
  }

  /** The collector base URL, or undefined. Never logged: an OTLP URL is not
   *  secret, but a future operator might embed one, and the surface reading
   *  this only needs "configured / not configured". */
  get otelEndpoint(): string | undefined {
    return this.env.OTEL_ENDPOINT ?? undefined;
  }

  get otelTimeoutMs(): number {
    return this.env.OTEL_TIMEOUT_MS;
  }

  get otelSampleRatio(): number {
    return this.env.OTEL_SAMPLE_RATIO;
  }

  get otelPriorityOperations(): string[] {
    return this.env.OTEL_PRIORITY_OPERATIONS.split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }

  /** Effective arming: the guards are AND-ed here because every consumer
   *  must see the SAME truth the env validator enforced - a deployment that
   *  disabled the guard gets an unarmed injector, fail-closed in both
   *  directions. */
  get failureInjectionArmed(): boolean {
    return (
      this.env.FAILURE_INJECTION_ENABLED === true &&
      this.env.FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY === true &&
      this.env.NODE_ENV !== 'production'
    );
  }

  get failureInjectionRequested(): boolean {
    return this.env.FAILURE_INJECTION_ENABLED === true;
  }

  get sloEnabled(): boolean {
    return this.env.SLO_ENABLED === true;
  }

  get sloEvaluationIntervalMinutes(): number {
    return this.env.SLO_EVALUATION_INTERVAL_MINUTES;
  }

  get sloRetentionDays(): number {
    return this.env.SLO_RETENTION_DAYS;
  }

  get sloDefaultWindowMinutes(): number {
    return this.env.SLO_DEFAULT_WINDOW_MINUTES;
  }

  /** Decimal multiplier STRING -> integer ppm, exactly (14.4 -> 14_400_000).
   *  String arithmetic on purpose: `Number('14.4') * 1e6` is
   *  14400000.000000002 in IEEE-754, and a paging threshold whose rounding
   *  depends on float history is how a 3am argument starts. */
  get sloFastBurnPpm(): number {
    return AppConfigService.decimalStringToPpm(this.env.SLO_FAST_BURN_MULTIPLIER);
  }

  get sloSlowBurnPpm(): number {
    return AppConfigService.decimalStringToPpm(this.env.SLO_SLOW_BURN_MULTIPLIER);
  }

  static decimalStringToPpm(raw: string): number {
    const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(raw);
    if (!match) {
      throw new Error(`not a plain decimal multiplier: ${JSON.stringify(raw)}`);
    }
    const whole = match[1] ?? '0';
    const fraction = (match[2] ?? '').padEnd(6, '0').slice(0, 6);
    return Number(whole) * 1_000_000 + Number(fraction);
  }

  /** Tracing posture the panel renders; secret-free by construction - the
   *  endpoint is reported as a boolean, never as text. */
  get tracingSafetySummary(): {
    enabled: boolean;
    endpointConfigured: boolean;
    sampleRatio: number;
    priorityOperations: string[];
    faultInjection: { requested: boolean; armed: boolean };
    note: string;
  } {
    return {
      enabled: this.otelEnabled,
      endpointConfigured: this.otelEndpoint !== undefined,
      sampleRatio: this.otelSampleRatio,
      priorityOperations: this.otelPriorityOperations,
      faultInjection: {
        requested: this.failureInjectionRequested,
        armed: this.failureInjectionArmed,
      },
      note:
        'Tracing correlates evidence; it authorises nothing. Sampling is ' +
        'head-based and spans may be dropped under load or export failure - ' +
        'dropped is counted, never silently lost.',
    };
  }

  get tradingEngineHealthUrl(): string {
    return `${this.env.TRADING_ENGINE_URL}${this.env.TRADING_ENGINE_HEALTH_PATH}`;
  }

  get marketDataUrl(): string {
    return this.env.MARKET_DATA_URL;
  }

  get marketDataHealthUrl(): string {
    return `${this.env.MARKET_DATA_URL}${this.env.MARKET_DATA_HEALTH_PATH}`;
  }

  get notificationServiceUrl(): string {
    return this.env.NOTIFICATION_SERVICE_URL;
  }

  get notificationServiceHealthUrl(): string {
    return `${this.env.NOTIFICATION_SERVICE_URL}${this.env.NOTIFICATION_SERVICE_HEALTH_PATH}`;
  }

  get internalServiceToken(): string {
    return this.env.INTERNAL_SERVICE_TOKEN;
  }

  // ---------------------------------------------------------------------------
  // Mail / notifications
  // ---------------------------------------------------------------------------

  get mailDriver(): AppEnv['MAIL_DRIVER'] {
    return this.env.MAIL_DRIVER;
  }

  get mailFrom(): { name: string; address: string } {
    return { name: this.env.MAIL_FROM_NAME, address: this.env.MAIL_FROM_ADDRESS };
  }

  get notificationsEnabled(): boolean {
    return this.env.NOTIFICATIONS_ENABLED;
  }

  // ---------------------------------------------------------------------------
  // Localisation
  // ---------------------------------------------------------------------------

  get defaultLocale(): string {
    return this.env.DEFAULT_LOCALE;
  }

  get supportedLocales(): string[] {
    return this.env.SUPPORTED_LOCALES;
  }

  get defaultCurrency(): string {
    return this.env.DEFAULT_CURRENCY;
  }

  get supportedCurrencies(): string[] {
    return this.env.SUPPORTED_CURRENCIES;
  }

  // ---------------------------------------------------------------------------
  // Compliance / billing providers
  // ---------------------------------------------------------------------------

  get kycProvider(): AppEnv['KYC_PROVIDER'] {
    return this.env.KYC_PROVIDER;
  }

  get billingProvider(): AppEnv['BILLING_PROVIDER'] {
    return this.env.BILLING_PROVIDER;
  }

  // ---------------------------------------------------------------------------
  // Seed
  // ---------------------------------------------------------------------------

  get seedSuperAdminEmail(): string {
    return this.env.SEED_SUPER_ADMIN_EMAIL;
  }
}
```

FILE: apps/api/src/config/env-example-coverage.spec.ts

```typescript
/**
 * The environment schema and `.env.example` are one promise in two files, so they are
 * checked against each other rather than trusted separately.
 *
 * `packages/config/src/env.schema.ts` is the single source of truth for what the API and
 * the worker will boot with: an unlisted name is ignored, a listed name is validated, and
 * `apps/api/src/config/env.validation.ts` aborts the process when the two disagree with
 * reality. `.env.example` is the only place an operator learns those names exist. A part
 * that adds a schema key and forgets the example file has therefore shipped a knob nobody
 * can find - and a part that documents a name nobody reads has shipped a lie in the file
 * people copy into production. Both directions are asserted here, in the house style of
 * `infrastructure/prisma/rls-coverage.spec.ts`: re-derive the truth from the source at
 * test time instead of importing a snapshot of it that could itself drift.
 *
 * The third check exists because of what this audit actually found. `health.service.ts`
 * reads `process.env.GIT_COMMIT_SHA` directly, outside the schema - a legitimate exception,
 * since a build stamp is not a deployment knob - except that nothing in the repository set
 * it and no file named it, so `GET /v1/health` was reporting `commit: "unknown"` for a
 * reason nobody could look up. An exception that is written down is a design; an exception
 * that is only coded is how that happened.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..', '..', '..', '..');

const SCHEMA_SOURCE = 'packages/config/src/env.schema.ts';
const EXAMPLE_SOURCE = '.env.example';
const MODULE_SOURCE = 'apps/api/src/config/app-config.module.ts';
const VALIDATION_SOURCE = 'apps/api/src/config/env.validation.ts';
const READ_ROOTS = ['apps/api/src', 'apps/worker/src', 'services/notification-service/src'];

const read = (relative: string): string => readFileSync(join(repoRoot, relative), 'utf8');

/** The keys the schema declares: top-level UPPER_SNAKE members of its object literal. */
function declaredKeys(source: string): string[] {
  return [...source.matchAll(/^ {4}([A-Z][A-Z0-9_]+)\s*:/gm)].map((match) => String(match[1]));
}

/** Assignments an operator actually gets: a name at column zero, not a commented mention. */
function activeAssignments(example: string): string[] {
  return [...example.matchAll(/^([A-Z][A-Z0-9_]{2,})=/gm)].map((match) => String(match[1]));
}

function walkFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist') {
        walkFiles(join(directory, entry.name), found);
      }
      continue;
    }
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      found.push(join(directory, entry.name));
    }
  }
  return found;
}

/**
 * Every `process.env.NAME` read outside `packages/config`.
 *
 * Spec files are skipped on purpose: a test that assigns an env var to build a fixture is
 * describing a scenario, not adding to the deployment surface, and forcing documentation for
 * those would bury the case this check exists for.
 */
function directEnvironmentReads(): Set<string> {
  const names = new Set<string>();
  for (const root of READ_ROOTS) {
    const absolute = join(repoRoot, root);
    if (!exists(absolute)) {
      continue;
    }
    for (const file of walkFiles(absolute)) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) {
        names.add(String(match[1]));
      }
    }
  }
  return names;
}

function exists(path: string): boolean {
  try {
    readdirSync(path);
    return true;
  } catch {
    return false;
  }
}

describe('environment schema and .env.example', () => {
  const schema = read(SCHEMA_SOURCE);
  const example = read(EXAMPLE_SOURCE);
  const keys = declaredKeys(schema);
  const assigned = activeAssignments(example);

  it('declares enough keys that this check cannot pass by scanning nothing', () => {
    expect(keys.length).toBeGreaterThanOrEqual(200);
    expect(assigned.length).toBeGreaterThanOrEqual(200);
  });

  it('names every key the schema declares', () => {
    const undocumented = keys.filter((key) => !example.includes(key));
    expect(undocumented).toEqual([]);
  });

  it('assigns each name at most once, because two answers is no answer', () => {
    const counts = new Map<string, number>();
    for (const name of assigned) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const duplicated = [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name);
    // dotenv honours the first value of a repeated key and docker compose's env_file
    // honours the last, so a name written twice in one file is a setting whose value
    // depends on which loader read it. Three names were, and two carried different values.
    expect(duplicated).toEqual([]);
  });

  it('documents or declares every name read straight off process.env', () => {
    const undeclared = [...directEnvironmentReads()].filter(
      (name) => !keys.includes(name) && !example.includes(name),
    );
    expect(undeclared).toEqual([]);
  });

  it('is wired to the boot path it claims to police', () => {
    // If `validate: validateEnvironment` were dropped from the module, every assertion
    // above would still pass while the schema stopped mattering: a parity test on a seam
    // has to check the seam is installed.
    expect(read(MODULE_SOURCE)).toContain('validate: validateEnvironment');
    expect(read(VALIDATION_SOURCE)).toContain('validateEnv(raw)');
  });
});
```

FILE: apps/api/src/config/env.validation.ts

```typescript
import { AppEnv, EnvValidationError, validateEnv } from '@wlct/config';

/**
 * Adapter between `@nestjs/config` and the shared zod environment schema.
 * Throwing here aborts the boot sequence, which is exactly what we want: an API
 * that starts with an invalid JWT secret is worse than an API that does not
 * start at all.
 */
export function validateEnvironment(raw: Record<string, unknown>): AppEnv {
  try {
    return validateEnv(raw);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      const details = error.failures
        .map((failure) => `  \u2022 ${failure.path}: ${failure.message}`)
        .join('\n');
      throw new Error(
        `Environment validation failed. Fix the following variables in your .env file:\n${details}\n` +
          'Tip: run "npm run keys:generate" to produce valid cryptographic material.',
      );
    }
    throw error;
  }
}
```

FILE: apps/api/src/config/swagger.config.ts

```typescript
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
```

FILE: apps/api/src/main.ts

```typescript
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger as PinoLogger } from 'nestjs-pino';
import { VersioningType } from '@nestjs/common';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { Request, Response, NextFunction } from 'express';

import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';
import { setupSwagger } from './config/swagger.config';
import { RedisIoAdapter } from './modules/realtime/redis-io.adapter';
import { RedisService } from './infrastructure/redis/redis.service';
import { HEADER_REQUEST_ID } from '@wlct/config';

/**
 * Application entrypoint.
 *
 * Bootstrapping order matters: configuration is validated before anything else,
 * security middleware is installed before routing, and the HTTP server is only
 * opened once every module reports ready. Shutdown hooks are enabled so Prisma,
 * Redis and BullMQ can drain in-flight work during a rolling deploy.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    // The global exception filter owns error shaping; disable Nest's default.
    abortOnError: false,
  });

  const logger = app.get(PinoLogger);
  app.useLogger(logger);
  app.flushLogs();

  const config = app.get(AppConfigService);

  // Behind a load balancer the client IP must come from X-Forwarded-For, which
  // rate limiting and audit logging both depend on.
  app.set('trust proxy', config.trustProxyHops);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: config.isProduction
        ? {
            directives: {
              defaultSrc: ["'self'"],
              baseUri: ["'self'"],
              fontSrc: ["'self'", 'https:', 'data:'],
              formAction: ["'self'"],
              frameAncestors: ["'none'"],
              imgSrc: ["'self'", 'data:', 'https:'],
              objectSrc: ["'none'"],
              scriptSrc: ["'self'"],
              scriptSrcAttr: ["'none'"],
              styleSrc: ["'self'", 'https:', "'unsafe-inline'"],
              upgradeInsecureRequests: [],
            },
          }
        : false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: config.isProduction
        ? { maxAge: 31536000, includeSubDomains: true, preload: true }
        : false,
    }),
  );

  app.use(compression());
  app.use(cookieParser());

  // Hard cap on request size: nothing this API accepts legitimately exceeds it.
  app.useBodyParser('json', { limit: '512kb' });
  app.useBodyParser('urlencoded', { limit: '512kb', extended: true });

  // Surface the correlation id on every response, including error paths.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = (req as Request & { id?: string }).id;
    if (requestId) {
      res.setHeader(HEADER_REQUEST_ID, requestId);
    }
    next();
  });

  if (config.corsEnabled) {
    app.enableCors({
      origin: config.corsOriginValidator,
      credentials: config.corsCredentials,
      allowedHeaders: config.corsAllowedHeaders,
      exposedHeaders: config.corsExposedHeaders,
      methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      maxAge: 86400,
    });
  }

  // Health routes are excluded from the global prefix so probes can hit
  // `/health*` directly. Nest matches these entries literally, so each
  // sub-route of HealthController must be listed here; the controller itself is
  // VERSION_NEUTRAL so URI versioning does not re-add a `/v1` segment.
  app.setGlobalPrefix(config.globalPrefix, {
    exclude: ['health', 'health/ready', 'health/deep', 'health/startup', 'health/trading', 'metrics'],
  });

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: config.defaultApiVersion,
    prefix: 'v',
  });

  if (config.wsEnabled) {
    const redisIoAdapter = new RedisIoAdapter(app, config, app.get(RedisService));
    await redisIoAdapter.connectToRedis();
    app.useWebSocketAdapter(redisIoAdapter);
  }

  setupSwagger(app, config);

  app.enableShutdownHooks();

  await app.listen(config.port, config.host);

  const url = await app.getUrl();
  logger.log(
    {
      event: 'application.started',
      environment: config.nodeEnv,
      port: config.port,
      globalPrefix: config.globalPrefix,
      apiVersion: config.defaultApiVersion,
      swagger: config.swaggerEnabled ? `${url}/${config.swaggerPath}` : 'disabled',
      websocket: config.wsEnabled ? config.wsPath : 'disabled',
      executionEnabled: config.executionEnabled,
    },
    'API bootstrap complete',
  );
}

bootstrap().catch((error: unknown) => {
  // The logger may not exist yet at this point, so stderr is the only sink.
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`Fatal bootstrap error: ${message}\n`);
  process.exit(1);
});
```

FILE: apps/api/src/worker.ts

```typescript
/**
 * Trading-worker bootstrap: this process consumes; it never serves.
 *
 * There is no HTTP server here by construction, not by configuration:
 * createApplicationContext builds the DI graph and stops. An operator who
 * wants to read what the worker thinks must read its logs - which carry
 * claim state and job outcomes and never carry tokens or venue payloads.
 *
 * Lifecycle, in the order it actually matters:
 *  1. configuration parses (validateEnv inside the config module) - bad
 *     config exits nonzero before anything touches Redis;
 *  2. WORKER_ENABLED is honoured: false exits nonzero rather than running a
 *     silently-idle consumer, because "started and doing nothing" is the
 *     hardest failure mode an operator has to debug;
 *  3. the engine compatibility gate runs: the execution engine must answer,
 *     report the mode this build forwards to, and expose the command set.
 *     A worker that boots ahead of its engine would otherwise queue ack-less
 *     retries against a void and blame Redis for it;
 *  4. the coordination tick starts inside the module lifecycle and claims
 *     immediately (first tick is synchronous with construction, then every
 *     WORKER_PARTITION_RETRY_MS);
 *  5. shutdown drains: BullMQ workers pause first (no new jobs), held
 *     claims release second (owners move on without a TTL wait), connections
 *     close last. The whole sequence is bounded by
 *     WORKER_SHUTDOWN_TIMEOUT_MS; past that, process exit stands on the
 *     lease TTL - degraded, correct, and the reason TTLs exist.
 */

import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppConfigService } from './config/app-config.service';
import { EngineInternalClient } from './modules/worker/engine-internal.client';
import { WorkerModule } from './modules/worker/worker.module';

async function bootstrap(): Promise<void> {
  const logger = new Logger('WorkerBootstrap');

  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
    abortOnError: false,
  });
  const config = app.get(AppConfigService);

  if (!config.workerEnabled) {
    logger.error(
      'WORKER_ENABLED=false: this process refuses to idle. A worker that ' +
        'consumes nothing and looks healthy is an outage with extra steps.',
    );
    await app.close();
    process.exitCode = 1;
    return;
  }

  if (config.executionEngineToken === undefined) {
    logger.error(
      'EXECUTION_ENGINE_TOKEN is required by the worker: it forwards commands ' +
        'into the process that holds venue credentials.',
    );
    await app.close();
    process.exitCode = 1;
    return;
  }

  const client = app.get(EngineInternalClient);
  try {
    const status = await client.assertEngineCompatible();
    logger.log(
      `execution engine compatible: mode=${status.mode} instance=${status.instanceId} ` +
        `store=${status.store} commands=${status.commands.join(',')}`,
    );
  } catch (error) {
    logger.error(
      `execution engine gate failed: ${error instanceof Error ? error.message : 'unknown'}`,
    );
    await app.close();
    process.exitCode = 1;
    return;
  }

  app.enableShutdownHooks();
  logger.log(
    `worker ${config.workerId} online: partitions=${config.workerPartitionCount} ` +
      `membership=${config.workerMembership.length} defer=${config.workerDeferDelayMs}ms ` +
      `shutdown budget=${config.workerShutdownTimeoutMs}ms`,
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`${signal}: draining worker`);
    const deadline = new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`shutdown exceeded ${config.workerShutdownTimeoutMs}ms`)),
        config.workerShutdownTimeoutMs,
      );
      timer.unref();
    });
    try {
      await Promise.race([app.close(), deadline]);
      logger.log('worker drained cleanly');
    } catch (error) {
      // The forced path is SAFE, not hopeful: un-acked jobs stay in their
      // queues (at-least-once), and held claims expire by TTL, which is the
      // same recovery any crash follows. The log says so loudly because
      // making it quiet would be making it a lie.
      logger.error(
        `drain incomplete (${error instanceof Error ? error.message : 'unknown'}); ` +
          'exiting anyway - claims release by TTL and unacked jobs redeliver',
      );
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void bootstrap().catch((error: unknown) => {
  new Logger('WorkerBootstrap').error(
    `worker failed to start: ${error instanceof Error ? error.message : 'unknown'}`,
  );
  process.exitCode = 1;
});
```

FILE: apps/api/test/jest-e2e.json

```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": {
    "^.+\\.(t|j)s$": "ts-jest"
  },
  "moduleNameMapper": {
    "^@wlct/shared-types$": "<rootDir>/../../../packages/shared-types/src",
    "^@wlct/config$": "<rootDir>/../../../packages/config/src",
    "^@wlct/utils$": "<rootDir>/../../../packages/utils/src",
    "^@wlct/validation$": "<rootDir>/../../../packages/validation/src",
    "^src/(.*)$": "<rootDir>/../src/$1"
  }
}
```

FILE: apps/api/tsconfig.build.json

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "test", "dist", "**/*spec.ts"]
}
```

FILE: apps/api/tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "./dist",
    "baseUrl": "./",
    "paths": {
      "src/*": ["src/*"]
    },
    "strictBindCallApply": false,
    "noImplicitAny": true,
    "declaration": false,
    "declarationMap": false
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "test", "**/*.spec.ts"]
}
```

FILE: apps/api/tsconfig.spec.json

```json
{
  "// purpose": [
    "Type context for test files only.",
    "",
    "tsconfig.json deliberately excludes **/*.spec.ts so that `nest build` emits",
    "no test code into dist. That exclusion also hides spec files from",
    "typescript-eslint's typed rules, which then refuses to parse them. Rather",
    "than turn typed linting off for tests - tests on a money path are exactly",
    "where an unnoticed `any` does damage - this config gives them a project of",
    "their own, and .eslintrc.cjs points at both."
  ],
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "noEmit": true,
    "types": ["node", "jest"]
  },
  "include": ["src/**/*.spec.ts"],
  "exclude": ["node_modules", "dist"]
}
```


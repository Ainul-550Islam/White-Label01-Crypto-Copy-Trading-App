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

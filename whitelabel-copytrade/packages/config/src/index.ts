// # Enforces strict Zod validation on all production environment variables
import {
  envSchema,
  validateEnv,
  EnvValidationError,
  type AppEnv,
  type EnvValidationFailure,
} from './env.schema';

export * from './constants';
export * from './env.schema';

export type ValidatedEnv = AppEnv;

export interface ProductionPreflightReport {
  valid: boolean;
  environment: string;
  errors: string[];
}

export function evaluateEnvironmentSafety(
  rawEnv: Record<string, string | undefined> = process.env,
): ProductionPreflightReport {
  const errors: string[] = [];
  const environment = String(rawEnv.NODE_ENV ?? 'development');

  try {
    validateEnv(rawEnv);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      errors.push(
        ...error.failures.map(
          (failure: EnvValidationFailure) => `${failure.path}: ${failure.message}`,
        ),
      );
    } else if (error instanceof Error) {
      errors.push(error.message);
    }
  }

  return {
    valid: errors.length === 0,
    environment,
    errors,
  };
}

export { envSchema, validateEnv, EnvValidationError, type AppEnv, type EnvValidationFailure };

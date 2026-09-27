import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DEFAULT_PASSWORD_POLICY, evaluatePassword, type PasswordEvaluation } from '@wlct/validation';
import { ErrorCode } from '@wlct/shared-types';

import { AppConfigService } from '../../config/app-config.service';
import { AppException } from '../../common/errors/app.exception';

/**
 * Password hashing and policy enforcement.
 *
 * argon2id is used with OWASP recommended parameters (19 MiB memory, t=2).
 * A dummy verification is exposed so the login flow can spend the same amount
 * of CPU whether or not the account exists, removing a user-enumeration oracle.
 */
@Injectable()
export class PasswordService {
  private readonly dummyHashPromise: Promise<string>;

  constructor(
    private readonly config: AppConfigService,
    @InjectPinoLogger(PasswordService.name) private readonly logger: PinoLogger,
  ) {
    this.dummyHashPromise = this.hash('dummy-password-for-timing-equalisation');
  }

  private get options(): argon2.Options {
    const { memoryCost, timeCost, parallelism } = this.config.argon2Options;
    return {
      type: argon2.argon2id,
      memoryCost,
      timeCost,
      parallelism,
      hashLength: 32,
    };
  }

  async hash(plainPassword: string): Promise<string> {
    return argon2.hash(plainPassword, this.options);
  }

  async verify(hash: string, plainPassword: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plainPassword);
    } catch (error) {
      this.logger.warn(
        { event: 'password.verify_failed', reason: (error as Error).name },
        'Password verification raised an error (malformed hash?)',
      );
      return false;
    }
  }

  /** Burns equivalent CPU time for unknown accounts. */
  async verifyDummy(): Promise<void> {
    const dummyHash = await this.dummyHashPromise;
    await argon2.verify(dummyHash, 'incorrect-password').catch(() => false);
  }

  /** True when a stored hash was produced with weaker parameters than current. */
  needsRehash(hash: string): boolean {
    try {
      return argon2.needsRehash(hash, this.options);
    } catch {
      return true;
    }
  }

  evaluate(password: string, context: { email?: string; name?: string } = {}): PasswordEvaluation {
    return evaluatePassword(
      password,
      { ...DEFAULT_PASSWORD_POLICY, minLength: this.config.passwordMinLength },
      context,
    );
  }

  /** Throws a validation-shaped error when the policy is not satisfied. */
  assertPolicy(password: string, context: { email?: string; name?: string } = {}): void {
    const evaluation = this.evaluate(password, context);
    if (!evaluation.valid) {
      throw new AppException({
        code: ErrorCode.PASSWORD_POLICY_VIOLATION,
        message: 'The password does not meet the security policy.',
        details: evaluation.errors.map((message) => ({
          field: 'password',
          constraint: 'passwordPolicy',
          message,
        })),
      });
    }
  }
}

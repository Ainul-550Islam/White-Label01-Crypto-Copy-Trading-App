import { z } from 'zod';

/**
 * Password policy. Deliberately stricter than the NIST minimum because these
 * accounts control API keys that can place live trades.
 */
export interface PasswordPolicyOptions {
  minLength: number;
  maxLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireDigit: boolean;
  requireSymbol: boolean;
  forbidCommonPasswords: boolean;
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicyOptions = {
  minLength: 12,
  maxLength: 128,
  requireUppercase: true,
  requireLowercase: true,
  requireDigit: true,
  requireSymbol: true,
  forbidCommonPasswords: true,
};

/**
 * Small embedded deny-list. In production this is complemented by a breached
 * password check (k-anonymity range query) executed inside the auth service.
 */
const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  'password',
  'password1',
  'password123',
  'passw0rd',
  '123456789',
  '1234567890',
  'qwertyuiop',
  'letmein123',
  'welcome123',
  'admin12345',
  'iloveyou123',
  'trustno1234',
  'bitcoin123',
  'crypto1234',
  'binance123',
  'copytrade123',
  'changeme123',
  'sunshine123',
  'football123',
  'dragon12345',
]);

export interface PasswordEvaluation {
  valid: boolean;
  errors: string[];
  score: 0 | 1 | 2 | 3 | 4;
}

function hasSequentialRun(value: string, runLength = 4): boolean {
  let ascending = 1;
  let descending = 1;
  for (let index = 1; index < value.length; index += 1) {
    const delta = value.charCodeAt(index) - value.charCodeAt(index - 1);
    ascending = delta === 1 ? ascending + 1 : 1;
    descending = delta === -1 ? descending + 1 : 1;
    if (ascending >= runLength || descending >= runLength) {
      return true;
    }
  }
  return false;
}

function hasRepeatedRun(value: string, runLength = 4): boolean {
  let run = 1;
  for (let index = 1; index < value.length; index += 1) {
    run = value[index] === value[index - 1] ? run + 1 : 1;
    if (run >= runLength) {
      return true;
    }
  }
  return false;
}

export function evaluatePassword(
  password: string,
  policy: PasswordPolicyOptions = DEFAULT_PASSWORD_POLICY,
  context: { email?: string; name?: string } = {},
): PasswordEvaluation {
  const errors: string[] = [];

  if (password.length < policy.minLength) {
    errors.push(`Password must be at least ${policy.minLength} characters long`);
  }
  if (password.length > policy.maxLength) {
    errors.push(`Password must be at most ${policy.maxLength} characters long`);
  }
  if (policy.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  if (policy.requireLowercase && !/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  if (policy.requireDigit && !/\d/.test(password)) {
    errors.push('Password must contain at least one digit');
  }
  if (policy.requireSymbol && !/[^A-Za-z0-9]/.test(password)) {
    errors.push('Password must contain at least one symbol');
  }
  if (policy.forbidCommonPasswords && COMMON_PASSWORDS.has(password.toLowerCase())) {
    errors.push('This password appears in common password lists');
  }
  if (hasRepeatedRun(password)) {
    errors.push('Password must not contain 4 or more repeated characters');
  }
  if (hasSequentialRun(password)) {
    errors.push('Password must not contain long character sequences such as "abcd" or "1234"');
  }
  if (context.email) {
    const localPart = context.email.split('@')[0]?.toLowerCase();
    if (localPart && localPart.length >= 3 && password.toLowerCase().includes(localPart)) {
      errors.push('Password must not contain your email address');
    }
  }
  if (context.name && context.name.length >= 3) {
    if (password.toLowerCase().includes(context.name.toLowerCase())) {
      errors.push('Password must not contain your name');
    }
  }

  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) =>
    pattern.test(password),
  ).length;
  const lengthScore = password.length >= 20 ? 2 : password.length >= 14 ? 1 : 0;
  const rawScore = Math.min(4, variety - 1 + lengthScore);
  const score = (errors.length > 0 ? Math.min(rawScore, 1) : Math.max(rawScore, 0)) as
    | 0
    | 1
    | 2
    | 3
    | 4;

  return { valid: errors.length === 0, errors, score };
}

export function buildPasswordSchema(
  policy: PasswordPolicyOptions = DEFAULT_PASSWORD_POLICY,
): z.ZodEffects<z.ZodString, string, string> {
  return z
    .string()
    .min(1, 'Password is required')
    .superRefine((value, ctx) => {
      const evaluation = evaluatePassword(value, policy);
      for (const message of evaluation.errors) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      }
    });
}

export const passwordSchema = buildPasswordSchema();

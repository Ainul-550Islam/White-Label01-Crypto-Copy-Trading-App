import { z } from 'zod';

/**
 * Browser -> BFF body for the second sign-in step. The challenge token and
 * device id are not part of it: they live in httpOnly cookies.
 */
export const twoFactorRequestSchema = z.object({
  code: z.string().trim().min(1).max(32),
  method: z.enum(['TOTP', 'RECOVERY']).default('TOTP'),
  trustDevice: z.boolean().optional(),
});

export type TwoFactorRequest = z.infer<typeof twoFactorRequestSchema>;

/**
 * BFF -> backend body for POST /v1/auth/two-factor/verify (VerifyTwoFactorDto).
 * Exactly one of code / recoveryCode is sent, and never `method`: the DTO is
 * validated with forbidNonWhitelisted, so any extra field is a 422.
 */
export function buildVerifyBody(
  challengeToken: string,
  deviceId: string,
  input: TwoFactorRequest
): Record<string, string | boolean> {
  const body: Record<string, string | boolean> = { challengeToken, deviceId };
  if (input.method === 'RECOVERY') {
    body.recoveryCode = input.code.trim().toUpperCase();
  } else {
    body.code = input.code.replace(/\s+/g, '');
  }
  if (input.trustDevice !== undefined) {
    body.trustDevice = input.trustDevice;
  }
  return body;
}

import { z } from 'zod';
import {
  deviceIdSchema,
  emailSchema,
  localeSchema,
  plainTextSchema,
  recoveryCodeSchema,
  totpCodeSchema,
} from './primitives';
import { passwordSchema } from './password.policy';

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: plainTextSchema(64).optional(),
  lastName: plainTextSchema(64).optional(),
  locale: localeSchema.optional(),
  referralCode: z.string().trim().max(32).optional(),
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the terms of service' }),
  }),
  deviceId: deviceIdSchema,
  deviceName: plainTextSchema(64).optional(),
  platform: z.enum(['ios', 'android', 'web', 'desktop']).optional(),
  appVersion: z.string().trim().max(32).optional(),
});
export type RegisterSchema = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(128),
  deviceId: deviceIdSchema,
  deviceName: plainTextSchema(64).optional(),
  platform: z.enum(['ios', 'android', 'web', 'desktop']).optional(),
  appVersion: z.string().trim().max(32).optional(),
  rememberDevice: z.boolean().default(false),
});
export type LoginSchema = z.infer<typeof loginSchema>;

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(20, 'Refresh token is malformed').max(4096),
  deviceId: deviceIdSchema,
});
export type RefreshTokenSchema = z.infer<typeof refreshTokenSchema>;

export const logoutSchema = z.object({
  refreshToken: z.string().min(20).max(4096).optional(),
  allDevices: z.boolean().default(false),
});
export type LogoutSchema = z.infer<typeof logoutSchema>;

export const verifyTwoFactorSchema = z
  .object({
    challengeToken: z.string().min(20).max(4096),
    code: totpCodeSchema.optional(),
    recoveryCode: recoveryCodeSchema.optional(),
    deviceId: deviceIdSchema,
    trustDevice: z.boolean().default(false),
  })
  .refine((value) => Boolean(value.code) !== Boolean(value.recoveryCode), {
    message: 'Provide either an authenticator code or a recovery code',
    path: ['code'],
  });
export type VerifyTwoFactorSchema = z.infer<typeof verifyTwoFactorSchema>;

export const enableTwoFactorSchema = z.object({
  password: z.string().min(1).max(128),
});
export type EnableTwoFactorSchema = z.infer<typeof enableTwoFactorSchema>;

export const confirmTwoFactorSchema = z.object({
  code: totpCodeSchema,
});
export type ConfirmTwoFactorSchema = z.infer<typeof confirmTwoFactorSchema>;

export const disableTwoFactorSchema = z
  .object({
    password: z.string().min(1).max(128),
    code: totpCodeSchema.optional(),
    recoveryCode: recoveryCodeSchema.optional(),
  })
  .refine((value) => Boolean(value.code) || Boolean(value.recoveryCode), {
    message: 'An authenticator or recovery code is required to disable 2FA',
    path: ['code'],
  });
export type DisableTwoFactorSchema = z.infer<typeof disableTwoFactorSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: passwordSchema,
    revokeOtherSessions: z.boolean().default(true),
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: 'New password must differ from the current password',
    path: ['newPassword'],
  });
export type ChangePasswordSchema = z.infer<typeof changePasswordSchema>;

export const requestPasswordResetSchema = z.object({
  email: emailSchema,
});
export type RequestPasswordResetSchema = z.infer<typeof requestPasswordResetSchema>;

export const confirmPasswordResetSchema = z.object({
  token: z.string().min(20).max(512),
  newPassword: passwordSchema,
});
export type ConfirmPasswordResetSchema = z.infer<typeof confirmPasswordResetSchema>;

export const verifyEmailSchema = z.object({
  token: z.string().min(20).max(512),
});
export type VerifyEmailSchema = z.infer<typeof verifyEmailSchema>;

export const revokeSessionSchema = z.object({
  sessionId: z.string().uuid(),
});
export type RevokeSessionSchema = z.infer<typeof revokeSessionSchema>;

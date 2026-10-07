import { apiClient } from './api-client';

/**
 * Customer Account & Profile API (/v1/users/me, /v1/auth/change-password).
 *
 * Every payload matches the backend DTOs (UpdateUserDto, ChangePasswordDto)
 * because the API runs with whitelist + forbidNonWhitelisted.
 */

export type SupportedLocaleCode = 'en' | 'es' | 'ar' | 'bn' | 'tr';
export type SupportedCurrencyCode = 'USD' | 'EUR' | 'GBP' | 'AED' | 'BDT' | 'TRY';

export interface UserProfileRecord {
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  countryCode: string | null;
  timezone: string;
  locale: SupportedLocaleCode;
  preferredCurrency: SupportedCurrencyCode;
  marketingOptIn: boolean;
}

export interface UserRoleAssignment {
  roleId: string;
  key: string;
  name: string;
  scope: string;
  tenantId: string | null;
  assignedAt: string;
  expiresAt: string | null;
}

export interface UserAccountDetail {
  id: string;
  tenantId: string;
  email: string;
  emailVerifiedAt: string | null;
  phone: string | null;
  phoneVerifiedAt: string | null;
  status: string;
  kycStatus: string;
  isPlatformUser: boolean;
  twoFactorEnabled: boolean;
  lastLoginAt: string | null;
  profile: UserProfileRecord | null;
  roles: UserRoleAssignment[];
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UpdateProfilePayload {
  firstName?: string;
  lastName?: string;
  displayName?: string;
  phone?: string;
  avatarUrl?: string;
  bio?: string;
  countryCode?: string;
  timezone?: string;
  locale?: SupportedLocaleCode;
  preferredCurrency?: SupportedCurrencyCode;
  marketingOptIn?: boolean;
}

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
  revokeOtherSessions?: boolean;
}

export interface ChangePasswordResult {
  changed: boolean;
  sessionsRevoked: number;
}

export const accountApi = {
  getMe: (): Promise<UserAccountDetail> =>
    apiClient.get<UserAccountDetail>('/v1/users/me'),

  updateProfile: (data: UpdateProfilePayload): Promise<UserAccountDetail> =>
    apiClient.patch<UserAccountDetail>('/v1/users/me', data),

  changePassword: (data: ChangePasswordPayload): Promise<ChangePasswordResult> =>
    apiClient.post<ChangePasswordResult>('/v1/auth/change-password', {
      currentPassword: data.currentPassword,
      newPassword: data.newPassword,
      revokeOtherSessions: data.revokeOtherSessions ?? true,
    }),
};

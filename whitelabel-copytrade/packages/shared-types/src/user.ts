import type { ISODateString, SupportedCurrency, SupportedLocale, UUID } from './common';
import type { SystemRole } from './rbac';

export enum UserStatus {
  PENDING_VERIFICATION = 'PENDING_VERIFICATION',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  LOCKED = 'LOCKED',
  DEACTIVATED = 'DEACTIVATED',
}

export enum KycStatus {
  NOT_STARTED = 'NOT_STARTED',
  PENDING = 'PENDING',
  IN_REVIEW = 'IN_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

export interface UserProfileDto {
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  countryCode: string | null;
  timezone: string;
  locale: SupportedLocale;
  preferredCurrency: SupportedCurrency;
  marketingOptIn: boolean;
}

export interface UserRoleDto {
  roleId: UUID;
  key: string;
  name: string;
  scope: string;
  tenantId: UUID | null;
  assignedAt: ISODateString;
  expiresAt: ISODateString | null;
}

export interface UserDto {
  id: UUID;
  tenantId: UUID;
  email: string;
  emailVerifiedAt: ISODateString | null;
  phone: string | null;
  phoneVerifiedAt: ISODateString | null;
  status: UserStatus;
  kycStatus: KycStatus;
  isPlatformUser: boolean;
  twoFactorEnabled: boolean;
  lastLoginAt: ISODateString | null;
  lastLoginIpHash: string | null;
  profile: UserProfileDto;
  roles: UserRoleDto[];
  permissions: string[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt: ISODateString | null;
}

export interface CreateUserInput {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  locale?: SupportedLocale;
  roleKeys?: SystemRole[];
  sendInvite?: boolean;
}

export interface UpdateUserInput {
  firstName?: string;
  lastName?: string;
  displayName?: string;
  phone?: string;
  avatarUrl?: string;
  bio?: string;
  countryCode?: string;
  timezone?: string;
  locale?: SupportedLocale;
  preferredCurrency?: SupportedCurrency;
  marketingOptIn?: boolean;
}

export interface UserSessionDto {
  id: UUID;
  deviceId: string;
  deviceName: string | null;
  platform: string | null;
  appVersion: string | null;
  ipHash: string;
  approximateLocation: string | null;
  userAgent: string | null;
  isCurrent: boolean;
  trusted: boolean;
  createdAt: ISODateString;
  lastSeenAt: ISODateString;
  expiresAt: ISODateString;
  revokedAt: ISODateString | null;
}

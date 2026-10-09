'use client';
import type { JSX } from 'react';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  accountApi,
  type SupportedCurrencyCode,
  type SupportedLocaleCode,
} from '@/api/account-api';
import { ApiError } from '@/api/api-errors';
import { useAuth } from '@/auth/auth.store';
import { PageContainer } from '@/layout/page-container';
import { StatusBadge } from '@/components/status-badge';
import { LoadingState } from '@/components/loading-state';
import { ErrorState } from '@/components/error-state';

type ProfileResponse = Awaited<ReturnType<typeof accountApi.getMe>>;

interface ProfileDraft {
  firstName: string;
  lastName: string;
  displayName: string;
  phone: string;
  bio: string;
  countryCode: string;
  timezone: string;
  locale: SupportedLocaleCode;
  preferredCurrency: SupportedCurrencyCode;
  marketingOptIn: boolean;
}

function profileDraftFromData(data: ProfileResponse | undefined): ProfileDraft {
  return {
    firstName: data?.profile?.firstName ?? '',
    lastName: data?.profile?.lastName ?? '',
    displayName: data?.profile?.displayName ?? '',
    phone: data?.phone ?? '',
    bio: data?.profile?.bio ?? '',
    countryCode: data?.profile?.countryCode ?? '',
    timezone: data?.profile?.timezone ?? 'UTC',
    locale: data?.profile?.locale ?? 'en',
    preferredCurrency: data?.profile?.preferredCurrency ?? 'USD',
    marketingOptIn: Boolean(data?.profile?.marketingOptIn),
  };
}

export function ProfilePage(): JSX.Element {
  const { session, refreshSession } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['users', 'me'],
    queryFn: () => accountApi.getMe(),
    enabled: Boolean(session),
  });

  const [draft, setDraft] = useState<Partial<ProfileDraft>>({});
  const profileValues: ProfileDraft = { ...profileDraftFromData(data), ...draft };
  const updateProfileField = <K extends keyof ProfileDraft,>(field: K, value: ProfileDraft[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const [savingProfile, setSavingProfile] = useState<boolean>(false);
  const [profileNotice, setProfileNotice] = useState<string>('');
  const [profileError, setProfileError] = useState<string>('');

  const [currentPassword, setCurrentPassword] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [revokeOtherSessions, setRevokeOtherSessions] = useState<boolean>(true);
  const [changingPassword, setChangingPassword] = useState<boolean>(false);
  const [passwordNotice, setPasswordNotice] = useState<string>('');
  const [passwordError, setPasswordError] = useState<string>('');

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setProfileNotice('');
    setProfileError('');
    try {
      await accountApi.updateProfile({
        ...(profileValues.firstName.trim() ? { firstName: profileValues.firstName.trim() } : {}),
        ...(profileValues.lastName.trim() ? { lastName: profileValues.lastName.trim() } : {}),
        ...(profileValues.displayName.trim() ? { displayName: profileValues.displayName.trim() } : {}),
        ...(profileValues.phone.trim() ? { phone: profileValues.phone.trim() } : {}),
        ...(profileValues.bio.trim() ? { bio: profileValues.bio.trim() } : {}),
        ...(profileValues.countryCode.trim() ? { countryCode: profileValues.countryCode.trim().toUpperCase() } : {}),
        ...(profileValues.timezone.trim() ? { timezone: profileValues.timezone.trim() } : {}),
        locale: profileValues.locale,
        preferredCurrency: profileValues.preferredCurrency,
        marketingOptIn: profileValues.marketingOptIn,
      });
      await queryClient.invalidateQueries({ queryKey: ['users', 'me'] });
      setDraft({});
      await refreshSession();
      setProfileNotice('Profile updated.');
    } catch (err) {
      setProfileError(
        err instanceof ApiError ? err.getUserMessage() : 'Could not update profile.',
      );
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangingPassword(true);
    setPasswordNotice('');
    setPasswordError('');
    try {
      const res = await accountApi.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions,
      });
      setCurrentPassword('');
      setNewPassword('');
      setPasswordNotice(
        `Password changed.${res.sessionsRevoked > 0 ? ` ${res.sessionsRevoked} other session(s) signed out.` : ''}`,
      );
    } catch (err) {
      setPasswordError(
        err instanceof ApiError ? err.getUserMessage() : 'Could not change password.',
      );
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <PageContainer
      title="Profile & Account Credentials"
      description="Customer profile and password settings from backend"
      actions={
        <div className="flex flex-wrap gap-2 text-xs">
          <Link href="/account" className="rounded border px-3 py-1.5 hover:bg-accent">
            Account Overview
          </Link>
          <Link href="/account/relationships" className="rounded border px-3 py-1.5 hover:bg-accent">
            Relationships
          </Link>
          <Link href="/account/restrictions" className="rounded border px-3 py-1.5 hover:bg-accent">
            Restrictions
          </Link>
          <Link href="/security" className="rounded border px-3 py-1.5 hover:bg-accent">
            Security &amp; MFA
          </Link>
        </div>
      }
    >
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <div className="space-y-6">
          <div className="rounded border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold">Identity &amp; Organisation Summary</h2>
                <p className="text-xs text-muted">
                  Authoritative session context for {session?.tenant.name}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusBadge status={data?.status ?? session?.user.status ?? 'ACTIVE'} />
                {data?.kycStatus && <StatusBadge status={`KYC: ${data.kycStatus}`} variant="info" />}
                <StatusBadge
                  status={data?.twoFactorEnabled ? 'MFA ENABLED' : 'MFA DISABLED'}
                  variant={data?.twoFactorEnabled ? 'success' : 'warning'}
                />
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-xs text-muted">Email</dt>
                <dd className="font-medium">{data?.email ?? session?.user.email}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Display Name</dt>
                <dd className="font-medium">
                  {data?.profile?.displayName ?? session?.user.displayName ?? 'Not set'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Tenant</dt>
                <dd className="font-medium">{session?.tenant.name}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Roles</dt>
                <dd className="font-medium">{session?.user.roles.join(', ')}</dd>
              </div>
            </dl>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <form onSubmit={handleSaveProfile} className="space-y-4 rounded border bg-card p-5">
              <div>
                <h3 className="text-sm font-semibold">Personal &amp; Regional Preferences</h3>
                <p className="text-xs text-muted">
                  Updates your profile via PATCH /v1/users/me
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-medium" htmlFor="profile-first-name">
                    First Name
                  </label>
                  <input
                    id="profile-first-name"
                    value={profileValues.firstName}
                    onChange={(e) => updateProfileField('firstName', e.target.value)}
                    maxLength={64}
                    className="mt-1 w-full rounded border px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium" htmlFor="profile-last-name">
                    Last Name
                  </label>
                  <input
                    id="profile-last-name"
                    value={profileValues.lastName}
                    onChange={(e) => updateProfileField('lastName', e.target.value)}
                    maxLength={64}
                    className="mt-1 w-full rounded border px-3 py-1.5 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-medium" htmlFor="profile-display-name">
                    Display Name
                  </label>
                  <input
                    id="profile-display-name"
                    value={profileValues.displayName}
                    onChange={(e) => updateProfileField('displayName', e.target.value)}
                    maxLength={64}
                    className="mt-1 w-full rounded border px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium" htmlFor="profile-phone">
                    Phone (E.164, e.g. +8801712345678)
                  </label>
                  <input
                    id="profile-phone"
                    value={profileValues.phone}
                    onChange={(e) => updateProfileField('phone', e.target.value)}
                    placeholder="+8801712345678"
                    className="mt-1 w-full rounded border px-3 py-1.5 font-mono text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="text-xs font-medium" htmlFor="profile-country">
                    Country (ISO-2)
                  </label>
                  <input
                    id="profile-country"
                    value={profileValues.countryCode}
                    onChange={(e) => updateProfileField('countryCode', e.target.value.toUpperCase())}
                    maxLength={2}
                    placeholder="BD"
                    className="mt-1 w-full rounded border px-3 py-1.5 font-mono text-sm uppercase"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium" htmlFor="profile-locale">
                    Language
                  </label>
                  <select
                    id="profile-locale"
                    value={profileValues.locale}
                    onChange={(e) => updateProfileField('locale', e.target.value as SupportedLocaleCode)}
                    className="mt-1 w-full rounded border px-3 py-1.5 text-sm"
                  >
                    <option value="en">English (en)</option>
                    <option value="bn">বাংলা (bn)</option>
                    <option value="es">Español (es)</option>
                    <option value="ar">العربية (ar)</option>
                    <option value="tr">Türkçe (tr)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium" htmlFor="profile-currency">
                    Display Currency
                  </label>
                  <select
                    id="profile-currency"
                    value={profileValues.preferredCurrency}
                    onChange={(e) => updateProfileField('preferredCurrency', e.target.value as SupportedCurrencyCode)}
                    className="mt-1 w-full rounded border px-3 py-1.5 text-sm"
                  >
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                    <option value="AED">AED</option>
                    <option value="BDT">BDT</option>
                    <option value="TRY">TRY</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium" htmlFor="profile-timezone">
                  Timezone
                </label>
                <input
                  id="profile-timezone"
                  value={profileValues.timezone}
                  onChange={(e) => updateProfileField('timezone', e.target.value)}
                  maxLength={64}
                  placeholder="Asia/Dhaka"
                  className="mt-1 w-full rounded border px-3 py-1.5 text-sm"
                />
              </div>

              <div>
                <label className="text-xs font-medium" htmlFor="profile-bio">
                  Bio (optional)
                </label>
                <textarea
                  id="profile-bio"
                  value={profileValues.bio}
                  onChange={(e) => updateProfileField('bio', e.target.value)}
                  maxLength={500}
                  rows={2}
                  className="mt-1 w-full rounded border px-3 py-1.5 text-sm"
                />
              </div>

              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={profileValues.marketingOptIn}
                  onChange={(e) => updateProfileField('marketingOptIn', e.target.checked)}
                />
                <span>Receive product and strategy announcements from my organisation</span>
              </label>

              {profileError && (
                <div className="rounded bg-red-50 p-2 text-xs text-red-700">{profileError}</div>
              )}
              {profileNotice && (
                <div className="rounded bg-green-50 p-2 text-xs text-green-800">{profileNotice}</div>
              )}

              <button
                type="submit"
                disabled={savingProfile}
                className="rounded bg-primary px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
              >
                {savingProfile ? 'Saving...' : 'Save Profile Changes'}
              </button>
            </form>

            <form onSubmit={handleChangePassword} className="space-y-4 rounded border bg-card p-5">
              <div>
                <h3 className="text-sm font-semibold">Change Password</h3>
                <p className="text-xs text-muted">
                  Requires your current password and a new 12+ character password with upper, lower, digit, and symbol.
                </p>
              </div>

              <div>
                <label className="text-xs font-medium" htmlFor="current-password">
                  Current Password
                </label>
                <input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  className="mt-1 w-full rounded border px-3 py-1.5 text-sm"
                />
              </div>

              <div>
                <label className="text-xs font-medium" htmlFor="new-password">
                  New Password (min 12 chars)
                </label>
                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={12}
                  maxLength={128}
                  className="mt-1 w-full rounded border px-3 py-1.5 text-sm"
                />
              </div>

              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={revokeOtherSessions}
                  onChange={(e) => setRevokeOtherSessions(e.target.checked)}
                />
                <span>Sign out all other devices after changing password</span>
              </label>

              {passwordError && (
                <div className="rounded bg-red-50 p-2 text-xs text-red-700">{passwordError}</div>
              )}
              {passwordNotice && (
                <div className="rounded bg-green-50 p-2 text-xs text-green-800">{passwordNotice}</div>
              )}

              <button
                type="submit"
                disabled={changingPassword || !currentPassword || newPassword.length < 12}
                className="rounded bg-primary px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
              >
                {changingPassword ? 'Updating Password...' : 'Update Password'}
              </button>
            </form>
          </div>
        </div>
      )}
    </PageContainer>
  );
}

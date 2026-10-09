'use client';
import type { JSX } from 'react';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authApi } from '@/api/auth-api';
import { ApiError } from '@/api/api-errors';
import { useAuth } from '@/auth/auth.store';
import { useTenant } from '@/tenant/tenant-context';
import { TenantLogo } from '@/tenant/tenant-branding';

type SupportedLocale = 'en' | 'es' | 'ar' | 'bn' | 'tr';

interface PasswordCheck {
  label: string;
  passed: boolean;
}

function evaluatePasswordRules(password: string, email: string): PasswordCheck[] {
  const localPart = email.split('@')[0]?.trim().toLowerCase() ?? '';
  const containsEmail =
    localPart.length >= 3 && password.toLowerCase().includes(localPart);
  return [
    { label: 'At least 12 characters', passed: password.length >= 12 },
    { label: 'At least one uppercase letter (A-Z)', passed: /[A-Z]/.test(password) },
    { label: 'At least one lowercase letter (a-z)', passed: /[a-z]/.test(password) },
    { label: 'At least one digit (0-9)', passed: /\d/.test(password) },
    { label: 'At least one symbol (!@#$...)', passed: /[^A-Za-z0-9]/.test(password) },
    { label: 'Does not contain your email username', passed: password.length > 0 && !containsEmail },
  ];
}

export default function RegisterPage(): JSX.Element {
  const [firstName, setFirstName] = useState<string>('');
  const [lastName, setLastName] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [locale, setLocale] = useState<SupportedLocale>('en');
  const [referralCode, setReferralCode] = useState<string>('');
  const [acceptedTerms, setAcceptedTerms] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const router = useRouter();
  const { refreshSession } = useAuth();
  const { tenant } = useTenant();

  const rules = evaluatePasswordRules(password, email);
  const passwordValid = rules.every((r) => r.passed);
  const canSubmit = Boolean(email.trim() && passwordValid && acceptedTerms && !loading);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError('');
    setFieldErrors({});
    try {
      const res = await authApi.register({
        email: email.trim(),
        password,
        ...(firstName.trim() ? { firstName: firstName.trim() } : {}),
        ...(lastName.trim() ? { lastName: lastName.trim() } : {}),
        locale,
        ...(referralCode.trim() ? { referralCode: referralCode.trim() } : {}),
        acceptedTerms,
      });
      await refreshSession();
      router.push(res.redirectTo || '/onboarding');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.getUserMessage());
        if (err.fieldErrors) {
          setFieldErrors(err.fieldErrors);
        }
      } else {
        setError('Account registration could not be completed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const brandName = tenant?.branding?.appName ?? tenant?.name ?? 'Copy Trading Platform';

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-lg rounded-lg border bg-card p-6 shadow">
        <div className="mb-6 text-center">
          <TenantLogo className="mx-auto h-12 w-12 rounded" />
          <h1 className="mt-3 text-xl font-bold">Create your {brandName} account</h1>
          <p className="text-xs text-muted">
            Non-custodial copy-trading account scoped to your organisation
          </p>
        </div>

        <form onSubmit={handleRegister} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium" htmlFor="register-first-name">
                First name
              </label>
              <input
                id="register-first-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                type="text"
                maxLength={64}
                autoComplete="given-name"
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
                placeholder="First name"
              />
              {fieldErrors.firstName?.[0] && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.firstName[0]}</p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="register-last-name">
                Last name
              </label>
              <input
                id="register-last-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                type="text"
                maxLength={64}
                autoComplete="family-name"
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
                placeholder="Last name"
              />
              {fieldErrors.lastName?.[0] && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.lastName[0]}</p>
              )}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium" htmlFor="register-email">
              Work or personal email <span className="text-red-600">*</span>
            </label>
            <input
              id="register-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              placeholder="you@example.com"
            />
            {fieldErrors.email?.[0] && (
              <p className="mt-1 text-xs text-red-600">{fieldErrors.email[0]}</p>
            )}
          </div>

          <div>
            <label className="text-sm font-medium" htmlFor="register-password">
              Password <span className="text-red-600">*</span>
            </label>
            <input
              id="register-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              placeholder="Minimum 12 characters"
            />
            {fieldErrors.password?.[0] && (
              <p className="mt-1 text-xs text-red-600">{fieldErrors.password[0]}</p>
            )}
            <ul className="mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
              {rules.map((rule) => (
                <li
                  key={rule.label}
                  className={rule.passed ? 'text-green-700' : 'text-muted'}
                >
                  {rule.passed ? '✓' : '○'} {rule.label}
                </li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium" htmlFor="register-locale">
                Preferred language
              </label>
              <select
                id="register-locale"
                value={locale}
                onChange={(e) => setLocale(e.target.value as SupportedLocale)}
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
              >
                <option value="en">English (EN)</option>
                <option value="bn">বাংলা (BN)</option>
                <option value="es">Español (ES)</option>
                <option value="ar">العربية (AR)</option>
                <option value="tr">Türkçe (TR)</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="register-referral">
                Referral code (optional)
              </label>
              <input
                id="register-referral"
                value={referralCode}
                onChange={(e) => setReferralCode(e.target.value)}
                type="text"
                maxLength={32}
                className="mt-1 w-full rounded border px-3 py-2 font-mono text-sm"
                placeholder="PARTNER-CODE"
              />
            </div>
          </div>

          <div className="rounded border bg-gray-50 p-3 text-xs">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
                required
                className="mt-0.5"
              />
              <span>
                I accept the{' '}
                <Link href="/terms" className="font-medium text-primary underline">
                  Terms of Service &amp; Copy-Trading Risk Disclosure
                </Link>{' '}
                and acknowledge the{' '}
                <Link href="/privacy" className="font-medium text-primary underline">
                  Privacy Policy
                </Link>
                . I understand that this platform is non-custodial and requires trade-only exchange API keys.
              </span>
            </label>
            {fieldErrors.acceptedTerms?.[0] && (
              <p className="mt-1 text-xs text-red-600">{fieldErrors.acceptedTerms[0]}</p>
            )}
          </div>

          {error && (
            <div className="rounded bg-red-50 p-2 text-xs text-red-700" role="alert">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full rounded bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <div className="mt-6 border-t pt-4 text-center text-xs text-muted">
          <p>
            Already have an account?{' '}
            <Link href="/login" className="font-medium text-primary underline">
              Sign in
            </Link>
          </p>
          <div className="mt-3 flex justify-center gap-4">
            <Link href="/" className="hover:underline">Home</Link>
            <Link href="/pricing" className="hover:underline">Pricing</Link>
            <Link href="/status" className="hover:underline">Status</Link>
            <Link href="/terms" className="hover:underline">Terms</Link>
            <Link href="/privacy" className="hover:underline">Privacy</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

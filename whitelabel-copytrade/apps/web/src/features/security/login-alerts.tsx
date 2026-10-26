// # Responsibility: lists recent sign-ins and devices with their anomaly flags, and lets the customer sign out a device or revoke the session behind an alert.
//
// WHAT THE CUSTOMER NEEDS FROM THIS SCREEN
// ----------------------------------------
// They arrive here because an alert said something looked wrong. So the screen
// has to answer three questions in order: which sign-ins happened, which of them
// look wrong and why, and what can I do about it right now.
//
// The action is therefore per device and immediate: revoking signs that device
// out of every session it holds. It is not hidden behind a settings page, and it
// is not optimistic - the row shows the revocation in progress and then disappears
// only when the server confirms, because a customer who thinks they evicted an
// intruder when they did not is worse off than one who saw an error.
//
// An UNKNOWN device country is shown as unknown, never guessed from the IP: a wrong
// country in a security alert destroys trust in the alert itself.
'use client';
import type { JSX } from 'react';

import { useState } from 'react';

import { EmptyState } from '@/components/empty-state';

export type LoginRiskLevel = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';

export interface LoginDeviceView {
  /** Stable id for the device (a keyed hash); never an address. */
  fingerprintHash: string;
  /** Coarse, user-safe description, e.g. "Chrome on macOS". */
  deviceLabel: string | null;
  countryCode: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  trusted: boolean;
  riskLevel: LoginRiskLevel;
  reasons: string[];
  /** Sessions currently held by this device, so "sign out" can revoke all of them. */
  sessionIds: string[];
}

const REASON_TEXT: Record<string, string> = {
  NEW_DEVICE: 'A device this account had not used before',
  NEW_COUNTRY: 'A country this account had not signed in from',
  IMPOSSIBLE_TRAVEL: 'Too far from the previous sign-in for the time between them',
  FAILURE_BURST: 'Several failed attempts just before this sign-in',
  KNOWN_DEVICE: 'A device this account already uses',
  TRUSTED_DEVICE: 'A device you marked as trusted',
};

function riskTone(level: LoginRiskLevel): string {
  switch (level) {
    case 'HIGH':
      return 'border-red-400 bg-red-50 text-red-900';
    case 'MEDIUM':
      return 'border-amber-300 bg-amber-50 text-amber-900';
    case 'LOW':
      return 'border-slate-300 bg-slate-50 text-slate-900';
    default:
      return 'border-emerald-200 bg-emerald-50 text-emerald-900';
  }
}

export interface LoginAlertsProps {
  devices: LoginDeviceView[];
  /** Revokes every session held by one device. Rejects when the server refuses. */
  onRevokeDevice: (device: LoginDeviceView) => Promise<void>;
  /** Marks a device trusted ("this was me"). */
  onTrustDevice?: (device: LoginDeviceView) => Promise<void>;
  /** Where to send someone who says "this was not me". */
  recoveryHref?: string;
}

export function LoginAlerts({
  devices,
  onRevokeDevice,
  onTrustDevice,
  recoveryHref = '/recovery',
}: LoginAlertsProps): JSX.Element {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ordered = [...devices].sort((a, b) => {
    const weight = (level: LoginRiskLevel): number =>
      level === 'HIGH' ? 3 : level === 'MEDIUM' ? 2 : level === 'LOW' ? 1 : 0;
    const byRisk = weight(b.riskLevel) - weight(a.riskLevel);
    if (byRisk !== 0) return byRisk;
    return Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt);
  });
  const suspicious = ordered.filter((device) => device.riskLevel === 'HIGH' || device.riskLevel === 'MEDIUM');

  async function revoke(device: LoginDeviceView): Promise<void> {
    setBusyId(device.fingerprintHash);
    setError(null);
    try {
      await onRevokeDevice(device);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'That device could not be signed out. Try again, or change your password.',
      );
    } finally {
      setBusyId(null);
    }
  }

  if (devices.length === 0) {
    return <EmptyState title="No sign-ins recorded" description="Sign-ins and devices will appear here." />;
  }

  return (
    <div className="grid gap-3">
      {suspicious.length > 0 && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
          <p className="font-semibold">
            {suspicious.length} sign-in{suspicious.length === 1 ? '' : 's'} need your attention
          </p>
          <p className="mt-1 text-xs">
            If you do not recognise them, sign the device out and secure your account.{' '}
            <a className="underline" href={recoveryHref}>
              This was not me
            </a>
            .
          </p>
        </div>
      )}

      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-900" role="alert">
          {error}
        </p>
      )}

      <ul className="grid gap-2">
        {ordered.map((device) => {
          const reasons = device.reasons.map((reason) => REASON_TEXT[reason] ?? reason);
          return (
            <li
              key={device.fingerprintHash}
              className={`rounded border p-3 text-sm ${riskTone(device.riskLevel)}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {device.deviceLabel ?? 'Unrecognised device'}
                    {device.trusted && <span className="ml-2 text-xs uppercase tracking-wide opacity-70">trusted</span>}
                  </p>
                  <p className="text-xs opacity-80">
                    {device.countryCode ? `From ${device.countryCode}` : 'Country unknown'} · last used{' '}
                    {new Date(device.lastSeenAt).toLocaleString()}
                  </p>
                  {reasons.length > 0 && (
                    <ul className="mt-1 list-disc pl-4 text-xs opacity-80">
                      {reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <button
                    type="button"
                    className="rounded border border-current px-3 py-1 text-xs font-medium disabled:opacity-50"
                    onClick={() => void revoke(device)}
                    disabled={busyId !== null}
                  >
                    {busyId === device.fingerprintHash ? 'Signing out…' : 'Sign this device out'}
                  </button>
                  {onTrustDevice && !device.trusted && (
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-xs underline disabled:opacity-50"
                      onClick={() => void onTrustDevice(device)}
                      disabled={busyId !== null}
                    >
                      This was me
                    </button>
                  )}
                </div>
              </div>
              <p className="mt-1 text-[11px] opacity-60">
                {device.sessionIds.length} active session{device.sessionIds.length === 1 ? '' : 's'} · first seen{' '}
                {new Date(device.firstSeenAt).toLocaleString()}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

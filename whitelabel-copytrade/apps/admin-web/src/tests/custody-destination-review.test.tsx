import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { DestinationAuditView } from '@/api/custody-admin-api';
import { DestinationTable } from '@/features/custody/destination-review';
import { formatDuration } from '@/features/shared/money';

const source = readFileSync(resolve(process.cwd(), 'src/features/custody/destination-review.tsx'), 'utf8');

function destination(overrides: Partial<DestinationAuditView> = {}): DestinationAuditView {
  return {
    id: 'dest-1',
    tenantId: 'tenant-1',
    userId: '22222222-2222-2222-2222-222222222222',
    network: 'ethereum',
    address: '0x8f3a1c4d5e6b7a8c9d0e1f2a3b4c5d6e7f8a9b0c',
    label: 'Cold storage',
    status: 'ACTIVE',
    activatesAt: '2026-10-18T09:00:00.000Z',
    revokedAt: null,
    createdAt: '2026-10-15T09:00:00.000Z',
    remainingCooldownMs: 0,
    decisions: [],
    ...overrides,
  };
}

describe('destination review states', () => {
  it('shows a live loading status', () => {
    const html = renderToStaticMarkup(<DestinationTable rows={[]} filter="ALL" loading error={null} />);

    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Loading destinations');
  });

  it('shows the API error as an alert and never as an empty allowlist', () => {
    const html = renderToStaticMarkup(<DestinationTable rows={[]} filter="ALL" loading={false} error="Destinations could not be loaded." />);

    expect(html).toContain('role="alert"');
    expect(html).toContain('Destinations could not be loaded.');
    expect(html).not.toContain('No withdrawal destinations');
  });

  it('distinguishes an unfiltered empty list from a filtered one', () => {
    expect(renderToStaticMarkup(<DestinationTable rows={[]} filter="ALL" loading={false} error={null} />)).toContain('No withdrawal destinations');
    expect(renderToStaticMarkup(<DestinationTable rows={[]} filter="PENDING" loading={false} error={null} />)).toContain(
      'No destinations with this status',
    );
  });

  it('renders the status, the owner and a shortened address', () => {
    const html = renderToStaticMarkup(<DestinationTable rows={[destination()]} filter="ALL" loading={false} error={null} />);

    expect(html).toContain('Cold storage');
    expect(html).toContain('ACTIVE');
    expect(html).toContain('22222222');
    expect(html).toContain('0x8f3a1c4d…7f8a9b0c');
  });

  it('marks a destination still inside its cooldown with the remaining wait', () => {
    const html = renderToStaticMarkup(
      <DestinationTable rows={[destination({ status: 'PENDING', remainingCooldownMs: 36 * 60 * 60 * 1000 })]} filter="ALL" loading={false} error={null} />,
    );

    expect(html).toContain('PENDING');
    expect(html).toContain('36 h');
  });

  it('shows a completed cooldown as complete rather than a countdown of zero', () => {
    const html = renderToStaticMarkup(<DestinationTable rows={[destination()]} filter="ALL" loading={false} error={null} />);

    expect(html).toContain('Complete');
    expect(html).not.toContain('0 min');
  });

  it('renders the revocation time when a destination has been revoked', () => {
    const html = renderToStaticMarkup(
      <DestinationTable
        rows={[destination({ status: 'REVOKED', revokedAt: '2026-10-19T12:00:00.000Z', label: '' })]}
        filter="REVOKED"
        loading={false}
        error={null}
      />,
    );

    expect(html).toContain('Revoked');
    expect(html).toContain('Untitled destination');
  });
});

describe('destination review is read-only by design', () => {
  it('offers no approve, activate, revoke or delete control', () => {
    const html = renderToStaticMarkup(<DestinationTable rows={[destination()]} filter="ALL" loading={false} error={null} />);

    expect(html).not.toMatch(/<button[^>]*>(?:(?!<\/button>).)*?(Approve|Activate|Revoke|Delete)/s);
    expect(source).not.toContain('custodyAdminApi.createDestination');
    expect(source).not.toContain('custodyAdminApi.revokeDestination');
  });

  it('explains the missing override so it is not mistaken for an unfinished screen', () => {
    expect(source).toContain('Why there is no override here');
    expect(source).toContain('stolen session');
  });

  it('only calls the GET route the controller exposes', () => {
    expect(source).toContain('custodyAdminApi.listDestinations');
    expect(source).not.toMatch(/custodyAdminApi\.(post|patch|delete|put)/);
  });
});

describe('cooldown formatting', () => {
  it('formats minutes, hours and days and treats an elapsed cooldown as ready', () => {
    expect(formatDuration(0)).toBe('Ready now');
    expect(formatDuration(-1)).toBe('Ready now');
    expect(formatDuration(30 * 60_000)).toBe('30 min');
    expect(formatDuration(5 * 3_600_000)).toBe('5 h');
    expect(formatDuration(72 * 3_600_000)).toBe('3 d');
  });
});

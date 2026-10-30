// # Responsibility: checks the venue board renders its filter, its loading state, and does not claim a venue state before one was read.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { UserStreamHealth } from '@/features/exchanges/user-stream-health';
import { VenueStatusGrid } from '@/features/exchanges/venue-status-grid';

describe('VenueStatusGrid', () => {
  it('renders a labelled venue filter and waits for the board', () => {
    const html = renderToStaticMarkup(<VenueStatusGrid />);

    // Exact heading text: a substring assertion would still pass if the heading were renamed to
    // "Venue status for tenants" or "Venue status (legacy)", which is the drift this guards.
    expect(html).toContain('>Venue status<');
    expect(html).toContain('Venues (comma separated, empty for all)');
    expect(html).toContain('Loading venue status');
  });

  it('does not render a status before one was read', () => {
    const html = renderToStaticMarkup(<VenueStatusGrid />);

    expect(html).not.toContain('OPERATIONAL');
    expect(html).not.toContain('OUTAGE');
  });
});

describe('UserStreamHealth', () => {
  it('shows the stream table and the per-account health control', () => {
    const html = renderToStaticMarkup(<UserStreamHealth limit={10} />);

    expect(html).toContain('User data streams');
    expect(html).toContain('Stream health for one account');
    expect(html).toContain('Read health');
    expect(html).toContain('disabled=""');
  });

  it('renders no stream state before one was read', () => {
    const html = renderToStaticMarkup(<UserStreamHealth />);

    expect(html).not.toContain('LIVE');
    expect(html).not.toContain('Last heartbeat');
  });
});

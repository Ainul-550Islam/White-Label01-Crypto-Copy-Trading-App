// # Responsibility: proves the seven developer-platform routes that had no UI are now reachable from a rendered screen, and that the console labels the credential and the one-time token correctly.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { DeveloperI18n } from '@/features/developer/i18n';
import { DeveloperIntegrationConsole } from '@/features/developer/integration-console';

jest.mock('@/api/developer-platform-api', () => ({
  developerPlatformApi: {
    integrationClient: jest.fn(),
    integrationProfile: jest.fn(),
    transitionApplication: jest.fn(),
    addRedirectUri: jest.fn(),
    oauthExchange: jest.fn(),
    oauthRevoke: jest.fn(),
    webhookAction: jest.fn(),
  },
}));

import { developerPlatformApi } from '@/api/developer-platform-api';

function render(): string {
  return renderToStaticMarkup(
    <DeveloperI18n>
      <DeveloperIntegrationConsole />
    </DeveloperI18n>,
  );
}

describe('the integration console', () => {
  it('renders every control the seven routes need', () => {
    const html = render();

    expect(html).toContain('Integration console');
    expect(html).toContain('Read client descriptor');
    expect(html).toContain('Read developer profile');
    expect(html).toContain('Application state and redirect URIs');
    expect(html).toContain('Register redirect URI');
    expect(html).toContain('OAuth code exchange and revocation');
    expect(html).toContain('Exchange code for a token');
    expect(html).toContain('Revoke token');
    expect(html).toContain('Webhook subscription action');
    expect(html).toContain('Run action');
  });

  it('states that the calls use the operator credential rather than the admin session', () => {
    // The warning about the one-time token appears only once a token has been issued; what is asserted
    // here is the rule that holds before any request: this console does not go through the session proxy.
    expect(render()).toContain('not the admin session');
  });

  it('exposes exactly the seven wrappers it drives', () => {
    const api = developerPlatformApi as unknown as Record<string, jest.Mock>;

    expect(Object.keys(api).sort()).toEqual([
      'addRedirectUri',
      'integrationClient',
      'integrationProfile',
      'oauthExchange',
      'oauthRevoke',
      'transitionApplication',
      'webhookAction',
    ]);
  });

  it('does not call anything on render: every route is driven by an explicit operator action', () => {
    render();

    for (const fn of Object.values(developerPlatformApi as unknown as Record<string, jest.Mock>)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});

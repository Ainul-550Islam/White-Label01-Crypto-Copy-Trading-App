'use client';

import { useRef, useState, type JSX } from 'react';

import {
  developerPlatformApi,
  type ApplicationState,
  type DeveloperEnvironment,
  type IntegrationClient,
  type IntegrationProfile,
} from '@/api/developer-platform-api';
import { useDeveloperI18n } from './i18n';

/**
 * The seven developer-platform routes that had a client wrapper but no screen.
 *
 * They are not billing or key-management flows - they are the calls a developer performs against the
 * integration environment, and support staff need to be able to reproduce them: read the client
 * descriptor the platform serves for an environment and API version, read the signed-in developer's
 * profile through that client, move an application through its state machine, register a redirect URI,
 * exchange and revoke an OAuth token, and pause/resume/revoke a webhook subscription.
 *
 * Two rules the panel keeps:
 *
 *   * the integration request is made with the caller's own credential against the tenant's API origin,
 *     never through the admin session proxy - so the operator sees what an integrator would see;
 *   * every mutation is sent with an Idempotency-Key that is only renewed after the API confirms, so a
 *     retry after a timeout is the same request. A one-time token is shown once and never stored.
 */
/** One key per intent, renewed only after the API confirms: a retry after a timeout is the same request. */
function keyFor(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

const APPLICATION_STATES: ApplicationState[] = ['PENDING', 'ACTIVE', 'SUSPENDED', 'REACTIVATION_REVIEW', 'REVOKED'];

export function DeveloperIntegrationConsole(): JSX.Element {
  const { t } = useDeveloperI18n();
  const [apiOrigin, setApiOrigin] = useState('');
  const [environment, setEnvironment] = useState<DeveloperEnvironment>('SANDBOX');
  // The integration route takes the lower-case environment name; the platform enum is upper case.
  const integrationEnvironment = (environment === 'PRODUCTION' ? 'production' : 'sandbox') as 'sandbox' | 'production';
  const [version, setVersion] = useState('v1');
  const [oauthToken, setOauthToken] = useState('');
  const [apiKeyId, setApiKeyId] = useState('');
  const [apiKeySecret, setApiKeySecret] = useState('');
  const [credentialType, setCredentialType] = useState<'oauth' | 'apiKey'>('oauth');

  const [applicationId, setApplicationId] = useState('');
  const [targetState, setTargetState] = useState<ApplicationState>('ACTIVE');
  const [reason, setReason] = useState('');
  const [redirectUri, setRedirectUri] = useState('');

  const [codeClientId, setCodeClientId] = useState('');
  const [code, setCode] = useState('');
  const [codeRedirectUri, setCodeRedirectUri] = useState('');
  const [codeVerifier, setCodeVerifier] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [revokeToken, setRevokeToken] = useState('');

  const [endpointId, setEndpointId] = useState('');
  const [webhookActionName, setWebhookActionName] = useState<'pause' | 'resume' | 'revoke'>('pause');

  const [client, setClient] = useState<IntegrationClient | null>(null);
  const [profile, setProfile] = useState<IntegrationProfile | null>(null);
  const [accessToken, setAccessToken] = useState('');
  const [status, setStatus] = useState('');
  const [problem, setProblem] = useState('');

  const transitionKey = useRef(keyFor('developer-transition'));
  const redirectKey = useRef(keyFor('developer-redirect'));
  const exchangeKey = useRef(keyFor('developer-oauth-exchange'));
  const revokeKey = useRef(keyFor('developer-oauth-revoke'));
  const webhookKey = useRef(keyFor('developer-webhook-action'));

  const run = async (action: () => Promise<string>): Promise<void> => {
    setProblem('');
    setStatus('');
    try {
      setStatus(await action());
    } catch (error) {
      // The API's own refusal text is user-facing; anything else becomes one sentence.
      setProblem(error instanceof Error && error.message ? error.message : t.failed);
    }
  };

  const credential = (): { type: 'oauth'; token: string } | { type: 'apiKey'; keyId: string; secret: string } =>
    credentialType === 'oauth'
      ? { type: 'oauth', token: oauthToken.trim() }
      : { type: 'apiKey', keyId: apiKeyId.trim(), secret: apiKeySecret.trim() };

  return (
    <section className="grid gap-4" aria-labelledby="integration-heading">
      <header>
        <h2 id="integration-heading" className="text-lg font-semibold">{t.integrationTitle}</h2>
        <p className="mt-1 text-sm text-muted">{t.integrationIntro}</p>
      </header>

      <fieldset className="grid gap-3 rounded border p-3">
        <legend className="text-sm font-semibold">{t.integrationRequest}</legend>
        <label className="block text-sm">{t.apiOrigin}
          <input className="mt-1 w-full rounded border px-3 py-2" value={apiOrigin} onChange={(event) => setApiOrigin(event.target.value)} />
        </label>
        <label className="block text-sm">{t.environmentLabel}
          <select className="mt-1 w-full rounded border px-3 py-2" value={environment} onChange={(event) => setEnvironment(event.target.value as DeveloperEnvironment)}>
            <option value="SANDBOX">{t.sandbox}</option>
            <option value="PRODUCTION">{t.production}</option>
          </select>
        </label>
        <label className="block text-sm">{t.apiVersion}
          <input className="mt-1 w-full rounded border px-3 py-2" value={version} onChange={(event) => setVersion(event.target.value)} />
        </label>
        <label className="block text-sm">{t.credentialType}
          <select className="mt-1 w-full rounded border px-3 py-2" value={credentialType} onChange={(event) => setCredentialType(event.target.value as 'oauth' | 'apiKey')}>
            <option value="oauth">{t.oauthToken}</option>
            <option value="apiKey">{t.apiKeyId}</option>
          </select>
        </label>
        {credentialType === 'oauth' ? (
          <label className="block text-sm">{t.oauthToken}
            <input className="mt-1 w-full rounded border px-3 py-2" value={oauthToken} onChange={(event) => setOauthToken(event.target.value)} autoComplete="off" />
          </label>
        ) : (
          <>
            <label className="block text-sm">{t.apiKeyId}
              <input className="mt-1 w-full rounded border px-3 py-2" value={apiKeyId} onChange={(event) => setApiKeyId(event.target.value)} autoComplete="off" />
            </label>
            <label className="block text-sm">{t.apiKeySecret}
              <input className="mt-1 w-full rounded border px-3 py-2" value={apiKeySecret} onChange={(event) => setApiKeySecret(event.target.value)} autoComplete="off" type="password" />
            </label>
          </>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded border px-3 py-2 text-sm"
            onClick={() => void run(async () => {
              const result = await developerPlatformApi.integrationClient({ apiOrigin, environment: integrationEnvironment, credential: credential(), version: version.trim() });
              setClient(result);
              return `${result.name} · ${result.clientId} · ${result.apiVersion}`;
            })}
          >
            {t.readClient}
          </button>
          <button
            type="button"
            className="rounded border px-3 py-2 text-sm"
            onClick={() => void run(async () => {
              const result = await developerPlatformApi.integrationProfile({ apiOrigin, environment: integrationEnvironment, credential: credential(), version: version.trim() });
              setProfile(result);
              return `${result.email} · ${result.id}`;
            })}
          >
            {t.readProfile}
          </button>
        </div>
        {client && <p className="text-xs text-muted">{t.readClient}: {client.clientId} ({client.environment})</p>}
        {profile && <p className="text-xs text-muted">{t.readProfile}: {profile.email}</p>}
      </fieldset>

      <fieldset className="grid gap-3 rounded border p-3">
        <legend className="text-sm font-semibold">{t.applicationStateTitle}</legend>
        <label className="block text-sm">{t.application}
          <input className="mt-1 w-full rounded border px-3 py-2" value={applicationId} onChange={(event) => setApplicationId(event.target.value)} />
        </label>
        <label className="block text-sm">{t.targetState}
          <select className="mt-1 w-full rounded border px-3 py-2" value={targetState} onChange={(event) => setTargetState(event.target.value as ApplicationState)}>
            {APPLICATION_STATES.map((state) => <option key={state} value={state}>{state}</option>)}
          </select>
        </label>
        <label className="block text-sm">{t.reason}
          <input className="mt-1 w-full rounded border px-3 py-2" value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
        <button
          type="button"
          className="w-fit rounded border px-3 py-2 text-sm"
          disabled={applicationId.trim().length === 0}
          onClick={() => void run(async () => {
            const result = await developerPlatformApi.transitionApplication(applicationId.trim(), { targetState, ...(reason ? { reason } : {}) }, transitionKey.current);
            transitionKey.current = keyFor('developer-transition');
            return `${t.applicationChanged}: ${result.state}`;
          })}
        >
          {t.save}
        </button>

        <label className="block text-sm">{t.redirectUri}
          <input className="mt-1 w-full rounded border px-3 py-2" value={redirectUri} onChange={(event) => setRedirectUri(event.target.value)} />
        </label>
        <button
          type="button"
          className="w-fit rounded border px-3 py-2 text-sm"
          disabled={applicationId.trim().length === 0 || redirectUri.trim().length === 0}
          onClick={() => void run(async () => {
            const result = await developerPlatformApi.addRedirectUri(applicationId.trim(), redirectUri.trim(), redirectKey.current);
            redirectKey.current = keyFor('developer-redirect');
            return `${t.redirectUri}: ${result.redirectUris.length}`;
          })}
        >
          {t.addRedirectUri}
        </button>
      </fieldset>

      <fieldset className="grid gap-3 rounded border p-3">
        <legend className="text-sm font-semibold">{t.oauthTitle}</legend>
        <label className="block text-sm">{t.clientId}
          <input className="mt-1 w-full rounded border px-3 py-2" value={codeClientId} onChange={(event) => setCodeClientId(event.target.value)} />
        </label>
        <label className="block text-sm">{t.authorizationCode}
          <input className="mt-1 w-full rounded border px-3 py-2" value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" />
        </label>
        <label className="block text-sm">{t.redirectUri}
          <input className="mt-1 w-full rounded border px-3 py-2" value={codeRedirectUri} onChange={(event) => setCodeRedirectUri(event.target.value)} />
        </label>
        <label className="block text-sm">{t.codeVerifier}
          <input className="mt-1 w-full rounded border px-3 py-2" value={codeVerifier} onChange={(event) => setCodeVerifier(event.target.value)} autoComplete="off" />
        </label>
        <label className="block text-sm">{t.clientSecret}
          <input className="mt-1 w-full rounded border px-3 py-2" type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} autoComplete="off" />
        </label>
        <button
          type="button"
          className="w-fit rounded border px-3 py-2 text-sm"
          onClick={() => void run(async () => {
            const result = await developerPlatformApi.oauthExchange(
              { clientId: codeClientId.trim(), code: code.trim(), redirectUri: codeRedirectUri.trim(), codeVerifier: codeVerifier.trim(), ...(clientSecret ? { clientSecret } : {}) },
              exchangeKey.current,
            );
            exchangeKey.current = keyFor('developer-oauth-exchange');
            setAccessToken(result.accessToken);
            return `${result.tokenType} · ${result.expiresIn}s · ${result.scope}`;
          })}
        >
          {t.exchangeCode}
        </button>
        {accessToken && <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">{t.tokenOnce}</p>}

        <label className="block text-sm">{t.oauthToken}
          <input className="mt-1 w-full rounded border px-3 py-2" value={revokeToken} onChange={(event) => setRevokeToken(event.target.value)} autoComplete="off" />
        </label>
        <button
          type="button"
          className="w-fit rounded border px-3 py-2 text-sm"
          disabled={revokeToken.trim().length === 0}
          onClick={() => void run(async () => {
            await developerPlatformApi.oauthRevoke(revokeToken.trim(), revokeKey.current);
            revokeKey.current = keyFor('developer-oauth-revoke');
            setRevokeToken('');
            return t.revokeAccepted;
          })}
        >
          {t.revokeToken}
        </button>
      </fieldset>

      <fieldset className="grid gap-3 rounded border p-3">
        <legend className="text-sm font-semibold">{t.webhookActionTitle}</legend>
        <label className="block text-sm">{t.endpointId}
          <input className="mt-1 w-full rounded border px-3 py-2" value={endpointId} onChange={(event) => setEndpointId(event.target.value)} />
        </label>
        <label className="block text-sm">{t.details}
          <select className="mt-1 w-full rounded border px-3 py-2" value={webhookActionName} onChange={(event) => setWebhookActionName(event.target.value as 'pause' | 'resume' | 'revoke')}>
            <option value="pause">{t.pause}</option>
            <option value="resume">{t.resume}</option>
            <option value="revoke">{t.revoke}</option>
          </select>
        </label>
        <button
          type="button"
          className="w-fit rounded border px-3 py-2 text-sm"
          disabled={endpointId.trim().length === 0}
          onClick={() => void run(async () => {
            const result = await developerPlatformApi.webhookAction(endpointId.trim(), { action: webhookActionName, ...(reason ? { reason } : {}) }, webhookKey.current);
            webhookKey.current = keyFor('developer-webhook-action');
            return `${t.webhookChanged}: ${result.state}`;
          })}
        >
          {t.runAction}
        </button>
      </fieldset>

      <p role="status" aria-live="polite" className="min-h-[1.25rem] text-sm">{problem ? <span className="text-danger">{problem}</span> : status || ''}</p>
    </section>
  );
}

import type { ApplicationInput, IssuedCredential, WebhookInput } from '@/api/developer-platform-api';

// Mutation status codes alone do not establish that the intended resource or
// one-time secret was returned. Treat ambiguous responses as uncertain and
// retain the caller's intent key so the operator can inspect before retrying.
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid mutation response');
  return value as Record<string, unknown>;
}
function nonempty(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function sameStrings(value: unknown, expected: string[]): boolean {
  return Array.isArray(value) && value.length === expected.length && value.every((item) => typeof item === 'string') &&
    new Set(value).size === expected.length && expected.every((item) => value.includes(item));
}

export function confirmApplicationCreate(value: unknown, input: ApplicationInput): void {
  const row = record(value);
  if (!nonempty(row.id) || !nonempty(row.clientId) || row.name !== input.name || row.description !== input.description ||
      row.environment !== (input.environment ?? 'SANDBOX') || !sameStrings(row.redirectUris, input.redirectUris) ||
      (input.requestedScopes && !sameStrings(row.scopes, input.requestedScopes))) throw new Error('Invalid application response');
}
export function confirmApplicationUpdate(value: unknown, id: string, input: Pick<ApplicationInput, 'name' | 'description' | 'redirectUris'>): void {
  const row = record(value);
  if (row.id !== id || row.name !== input.name || row.description !== input.description || !sameStrings(row.redirectUris, input.redirectUris)) throw new Error('Invalid application response');
}
export function confirmApplicationScopes(value: unknown, id: string, scopes: string[]): void {
  const row = record(value);
  if (row.id !== id || !sameStrings(row.scopes, scopes)) throw new Error('Invalid application response');
}
export function confirmState(value: unknown, id: string, states: readonly string[]): void {
  const row = record(value);
  if (row.id !== id || typeof row.state !== 'string' || !states.includes(row.state)) throw new Error('Invalid state response');
}
export function confirmIssuedCredential(value: unknown, previousKey?: string): asserts value is IssuedCredential {
  const issued = record(value);
  if (typeof issued.keyId !== 'string' || !/^devkey_[0-9a-f]{40}$/.test(issued.keyId) || issued.keyId === previousKey ||
      typeof issued.secret !== 'string' || !/^devsec_[0-9a-f]{64}$/.test(issued.secret) ||
      !Array.isArray(issued.scopes) || !issued.scopes.length || !issued.scopes.every(nonempty) ||
      !(issued.expiresAt === null || (typeof issued.expiresAt === 'string' && Number.isFinite(Date.parse(issued.expiresAt))))) {
    throw new Error('Invalid credential response');
  }
}
export function confirmWebhookSecret(value: unknown): asserts value is { secret: string } {
  const issued = record(value);
  if (typeof issued.secret !== 'string' || !/^whsec_[0-9a-f]{64}$/.test(issued.secret)) throw new Error('Invalid webhook secret response');
}
export function confirmWebhook(value: unknown, input: Pick<WebhookInput, 'applicationId' | 'endpointUrl' | 'eventTypes' | 'description'>, id?: string): void {
  const row = record(value);
  if (!nonempty(row.id) || (id !== undefined && row.id !== id) || row.applicationId !== input.applicationId ||
      row.endpointUrl !== input.endpointUrl || !sameStrings(row.eventTypes, input.eventTypes) ||
      (input.description !== undefined && row.description !== input.description)) throw new Error('Invalid webhook response');
}
export function confirmReplay(value: unknown, eventId: string): asserts value is { deliveryId: string; eventId: string } {
  const row = record(value);
  if (!nonempty(row.deliveryId) || row.eventId !== eventId) throw new Error('Invalid replay response');
}
export function confirmVersion(value: unknown, applicationId: string, version: string): void {
  const row = record(value);
  if (row.applicationId !== applicationId || row.version !== version) throw new Error('Invalid version response');
}

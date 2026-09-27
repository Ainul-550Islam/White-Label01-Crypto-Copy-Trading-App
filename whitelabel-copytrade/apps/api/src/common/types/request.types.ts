import type { Request } from 'express';
import type { AuthenticatedActor } from '@wlct/shared-types';

export interface TenantContext {
  tenantId: string;
  slug: string;
  status: string;
  /** How the tenant was identified; useful for auditing spoof attempts. */
  source: 'jwt' | 'domain' | 'subdomain' | 'header' | 'default';
  defaultLocale: string;
  defaultCurrency: string;
}

/** Express request enriched by the middleware/guard pipeline. */
export interface AppRequest extends Request {
  requestId: string;
  /** Part 9: cross-service correlation id. Always set - the middleware
   *  accepts an inbound x-correlation-id only when it is a UUID and
   *  otherwise mints one, exactly like requestId. */
  correlationId: string;
  startTime: number;
  ipHash: string;
  locale: string;
  tenantContext?: TenantContext;
  actor?: AuthenticatedActor;
}

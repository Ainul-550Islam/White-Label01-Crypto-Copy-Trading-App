/**
 * Part 10 - internal types for the SLO surface. The WIRE types live in
 * @wlct/shared-types (slo.ts) because the admin console and any future
 * machine consumer import them from there; this file holds only what the
 * service layer passes around internally.
 */

import type { SloConfigUpdateDto } from '@wlct/shared-types';

export interface SloActor {
  readonly userId: string;
  readonly tenantId: string;
  readonly platform: boolean;
  readonly requestId: string;
  readonly correlationId?: string;
}

export interface SloConfigCommand {
  readonly actor: SloActor;
  readonly sloId: string;
  readonly update: SloConfigUpdateDto;
}

export interface SloListFilter {
  readonly service?: string;
  readonly includeDisabled: boolean;
}

export interface SloEvaluationPage {
  readonly items: unknown[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
}

export interface SloEvaluateResult {
  // Mutable by design (and ONLY within the tick that created it): the
  // evaluator accumulates counters as it walks the definitions. Everything
  // the service RETURNS to callers is a fresh frozen snapshot conceptually -
  // no other code holds a reference mid-loop.
  evaluated: number;
  alertingSloIds: string[];
  skipped: Array<{ sloId: string; error: string }>;
  source: 'scheduled' | 'manual';
}

/** A stored version row decoded back into the engine's definition shape
 *  (payload JSON + columns), for evaluation and for the versions list. */
export interface SloStoredVersion {
  readonly id: string;
  readonly sloId: string;
  readonly version: number;
  readonly checksum: string;
  readonly enabled: boolean;
  readonly payload: Record<string, unknown>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

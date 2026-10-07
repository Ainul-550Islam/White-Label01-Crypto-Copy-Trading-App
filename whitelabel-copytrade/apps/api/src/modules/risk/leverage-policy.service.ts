// # Responsibility: resolves and validates customer leverage requests against server-authoritative ceilings and venue capability evidence.

import { Injectable } from '@nestjs/common';

export interface LeveragePolicyInput {
  requestedLeverage: number;
  maximumAllowed: number;
  venueMaximum: number | null;
  marginMode: 'CROSS' | 'ISOLATED';
  accountCanTrade: boolean;
}
export interface LeveragePolicyResult {
  allowed: boolean;
  effectiveMaximum: number | null;
  requestedLeverage: number;
  marginMode: 'CROSS' | 'ISOLATED';
  reason: string | null;
}

@Injectable()
export class LeveragePolicyService {
  evaluate(input: LeveragePolicyInput): LeveragePolicyResult {
    const fail = (reason: string): LeveragePolicyResult => ({ allowed: false, effectiveMaximum: null, requestedLeverage: input.requestedLeverage, marginMode: input.marginMode, reason });
    if (!Number.isInteger(input.requestedLeverage) || input.requestedLeverage < 1) return fail('Requested leverage must be a positive integer.');
    if (!Number.isInteger(input.maximumAllowed) || input.maximumAllowed < 1) return fail('A valid server policy ceiling is required.');
    if (!input.accountCanTrade) return fail('Account trade capability has not been verified.');
    if (input.venueMaximum === null || !Number.isInteger(input.venueMaximum) || input.venueMaximum < 1) return fail('Venue leverage capability is unavailable.');
    const maximum = Math.min(input.maximumAllowed, input.venueMaximum);
    if (input.requestedLeverage > maximum) return { ...fail(`Requested leverage exceeds the effective ceiling of ${maximum}x.`), effectiveMaximum: maximum };
    return { allowed: true, effectiveMaximum: maximum, requestedLeverage: input.requestedLeverage, marginMode: input.marginMode, reason: null };
  }
}

import { EU_COUNTRIES } from './tax.types';

/**
 * EU VAT number checks for B2B reverse charge.
 *
 * TAX_VAT_VALIDATION selects how much evidence a VAT number needs before an
 * invoice is issued without VAT (reverse charge):
 *  - `format` (default): the number must match the member state's VAT format
 *    (country prefix included). Cheap, catches typos, proves nothing about
 *    registration.
 *  - `vies`: the number must be confirmed valid by the European Commission's
 *    VIES REST service. If VIES cannot complete the check (member state
 *    offline, timeout, rate limit) the number is treated as NOT verified and
 *    VAT is charged: the business customer can recover wrongly charged VAT,
 *    the seller cannot recover VAT it failed to charge.
 *  - `none`: no check (the historical behaviour; not recommended).
 *
 * TAX_VIES_REQUESTER_VAT (optional, e.g. `IE1234567X`): the seller's own VAT
 * number. VIES then returns a consultation number (`requestIdentifier`) that
 * serves as audit evidence of the check.
 */

export type VatValidationMode = 'none' | 'format' | 'vies';

export type VatCheckStatus = 'VALID' | 'INVALID' | 'UNAVAILABLE' | 'SKIPPED';

export interface VatCheckResult {
  status: VatCheckStatus;
  countryCode: string;
  vatNumber: string;
  source: 'none' | 'format' | 'vies';
  name?: string;
  address?: string;
  consultationNumber?: string;
  checkedAt: string;
  error?: string;
}

export type ViesFetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<any>;
}>;

/**
 * VAT number formats per member state (after the prefix), from the
 * Commission's VIES format table. `EL` is Greece's VAT prefix.
 */
const EU_VAT_FORMATS: Record<string, RegExp> = {
  AT: /^U\d{8}$/,
  BE: /^[01]\d{9}$/,
  BG: /^\d{9,10}$/,
  CY: /^\d{8}[A-Z]$/,
  CZ: /^\d{8,10}$/,
  DE: /^\d{9}$/,
  DK: /^\d{8}$/,
  EE: /^\d{9}$/,
  EL: /^\d{9}$/,
  ES: /^[A-Z0-9]\d{7}[A-Z0-9]$/,
  FI: /^\d{8}$/,
  FR: /^[A-HJ-NP-Z0-9]{2}\d{9}$/,
  HR: /^\d{11}$/,
  HU: /^\d{8}$/,
  IE: /^(\d{7}[A-W][A-I]?|\d[A-Z+*]\d{5}[A-W])$/,
  IT: /^\d{11}$/,
  LT: /^(\d{9}|\d{12})$/,
  LU: /^\d{8}$/,
  LV: /^\d{11}$/,
  MT: /^\d{8}$/,
  NL: /^\d{9}B\d{2}$/,
  PL: /^\d{10}$/,
  PT: /^\d{9}$/,
  RO: /^\d{2,10}$/,
  SE: /^\d{12}$/,
  SI: /^\d{8}$/,
  SK: /^\d{10}$/,
};

/** ISO country code -> VIES member-state code (Greece is EL). */
export function viesMemberState(country: string): string {
  const cc = (country || '').trim().toUpperCase();
  return cc === 'GR' ? 'EL' : cc;
}

/**
 * Splits and normalises a VAT number for a billing country. Accepts it with
 * or without the member-state prefix and with spaces/dots/dashes. Returns
 * null when the number carries another member state's prefix.
 */
export function normaliseEuVat(
  country: string,
  raw: string,
): { memberState: string; number: string } | null {
  const memberState = viesMemberState(country);
  const value = (raw || '').toUpperCase().replace(/[\s.\-]/g, '');
  const format = EU_VAT_FORMATS[memberState];
  const ownPrefix =
    value.startsWith(memberState) || (memberState === 'EL' && value.startsWith('GR'));
  const stripped = ownPrefix ? value.slice(2) : null;
  // Prefer the reading that matches the national format (FR keys and ES/IE
  // numbers may themselves start with letters).
  if (format && stripped !== null && format.test(stripped))
    return { memberState, number: stripped };
  if (format && format.test(value)) return { memberState, number: value };
  if (stripped !== null) return { memberState, number: stripped };
  const foreign = value.slice(0, 2);
  if (
    /^[A-Z]{2}$/.test(foreign) &&
    (EU_COUNTRIES.has(foreign) || foreign === 'EL') &&
    foreign !== memberState
  )
    return null;
  return { memberState, number: value };
}

export function isEuVatFormatValid(country: string, raw: string): boolean {
  const n = normaliseEuVat(country, raw);
  if (!n) return false;
  const format = EU_VAT_FORMATS[n.memberState];
  return !!format && format.test(n.number);
}

export function vatValidationModeFromEnv(
  env: Record<string, string | undefined> = process.env,
): VatValidationMode {
  const mode = (env.TAX_VAT_VALIDATION || 'format').trim().toLowerCase();
  if (mode !== 'none' && mode !== 'format' && mode !== 'vies') {
    throw new Error('TAX_VAT_VALIDATION must be one of none | format | vies');
  }
  return mode;
}

const RETRYABLE_VIES_ERRORS = new Set([
  'SERVICE_UNAVAILABLE',
  'MS_UNAVAILABLE',
  'TIMEOUT',
  'GLOBAL_MAX_CONCURRENT_REQ',
  'GLOBAL_MAX_CONCURRENT_REQ_TIME',
  'MS_MAX_CONCURRENT_REQ',
  'MS_MAX_CONCURRENT_REQ_TIME',
]);

export interface ViesClientOptions {
  apiUrl?: string;
  requesterVat?: string;
  timeoutMs?: number;
  fetchImpl?: ViesFetchLike;
  now?: () => Date;
}

export class ViesVatClient {
  private readonly apiUrl: string;
  private readonly requester: { memberState: string; number: string } | null;
  private readonly timeoutMs: number;
  private readonly fetchImpl: ViesFetchLike | undefined;
  private readonly now: () => Date;

  constructor(options: ViesClientOptions = {}) {
    this.apiUrl =
      options.apiUrl ??
      process.env.TAX_VIES_API_URL ??
      'https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number';
    const requesterRaw = (options.requesterVat ?? process.env.TAX_VIES_REQUESTER_VAT ?? '')
      .trim()
      .toUpperCase()
      .replace(/[\s.\-]/g, '');
    this.requester = /^[A-Z]{2}[0-9A-Z+*]{2,13}$/.test(requesterRaw)
      ? { memberState: requesterRaw.slice(0, 2), number: requesterRaw.slice(2) }
      : null;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl =
      options.fetchImpl ??
      (typeof fetch === 'function' ? (fetch as unknown as ViesFetchLike) : undefined);
    this.now = options.now ?? (() => new Date());
  }

  async check(country: string, rawVat: string): Promise<VatCheckResult> {
    const checkedAt = this.now().toISOString();
    const n = normaliseEuVat(country, rawVat);
    const base = {
      countryCode: viesMemberState(country),
      vatNumber: n?.number ?? rawVat,
      source: 'vies' as const,
      checkedAt,
    };
    if (!n || !EU_VAT_FORMATS[n.memberState]) {
      return {
        ...base,
        status: 'INVALID',
        error: 'VAT number does not belong to an EU member state matching the billing country',
      };
    }
    if (!EU_VAT_FORMATS[n.memberState].test(n.number)) {
      return {
        ...base,
        status: 'INVALID',
        error: 'VAT number format is invalid for the member state',
      };
    }
    if (!this.fetchImpl) {
      return { ...base, status: 'UNAVAILABLE', error: 'fetch runtime unavailable' };
    }

    const body: Record<string, string> = { countryCode: n.memberState, vatNumber: n.number };
    if (this.requester) {
      body.requesterMemberStateCode = this.requester.memberState;
      body.requesterNumber = this.requester.number;
    }

    const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : undefined;
    let payload: any = null;
    let httpStatus = 0;
    try {
      const response = await this.fetchImpl(this.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal: controller?.signal,
      });
      httpStatus = response.status;
      payload = await response.json().catch(() => null);
      if (!response.ok && !payload) {
        return { ...base, status: 'UNAVAILABLE', error: `VIES HTTP ${response.status}` };
      }
    } catch (e) {
      return {
        ...base,
        status: 'UNAVAILABLE',
        error: `VIES request failed: ${(e as Error).name === 'AbortError' ? 'timeout' : (e as Error).message}`,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }

    // VIES can report a fault inside an HTTP 200 body: read the error fields before `valid`.
    const wrapped = Array.isArray(payload?.errorWrappers)
      ? payload.errorWrappers.map((w: any) => String(w?.error ?? '')).filter(Boolean)
      : [];
    const userError =
      payload?.userError && payload.userError !== 'VALID' && payload.userError !== 'INVALID'
        ? String(payload.userError)
        : '';
    const fault = payload?.actionSucceed === false || wrapped.length > 0 || !!userError;
    if (fault) {
      const code = wrapped[0] || userError || `HTTP_${httpStatus}`;
      if (code === 'INVALID_INPUT') {
        return { ...base, status: 'INVALID', error: 'VIES: INVALID_INPUT' };
      }
      return {
        ...base,
        status: 'UNAVAILABLE',
        error: `VIES: ${code}${RETRYABLE_VIES_ERRORS.has(code) ? ' (retry later)' : ''}`,
      };
    }
    if (typeof payload?.valid !== 'boolean') {
      return { ...base, status: 'UNAVAILABLE', error: 'VIES response had no validity flag' };
    }

    const clean = (v: unknown) =>
      typeof v === 'string' && v.trim() && v.trim() !== '---' ? v.trim() : undefined;
    return {
      ...base,
      status: payload.valid ? 'VALID' : 'INVALID',
      name: clean(payload.name),
      address: clean(payload.address),
      consultationNumber: clean(payload.requestIdentifier),
    };
  }
}

/** Applies TAX_VAT_VALIDATION to one VAT number. */
export async function verifyVatForReverseCharge(
  mode: VatValidationMode,
  country: string,
  vatNumber: string,
  vies: Pick<ViesVatClient, 'check'>,
  now: () => Date = () => new Date(),
): Promise<VatCheckResult> {
  const checkedAt = now().toISOString();
  const countryCode = viesMemberState(country);
  if (mode === 'none') {
    return { status: 'SKIPPED', countryCode, vatNumber, source: 'none', checkedAt };
  }
  if (mode === 'format') {
    return {
      status: isEuVatFormatValid(country, vatNumber) ? 'VALID' : 'INVALID',
      countryCode,
      vatNumber,
      source: 'format',
      checkedAt,
    };
  }
  return vies.check(country, vatNumber);
}

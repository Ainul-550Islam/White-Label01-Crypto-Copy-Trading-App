import {
  ViesVatClient,
  ViesFetchLike,
  isEuVatFormatValid,
  normaliseEuVat,
  vatValidationModeFromEnv,
  verifyVatForReverseCharge,
  viesMemberState,
} from './vies-vat.client';

function fakeFetch(response: { ok: boolean; status: number; body: any } | Error) {
  const calls: Array<{ url: string; init: any }> = [];
  const impl: ViesFetchLike = async (url, init) => {
    calls.push({ url, init });
    if (response instanceof Error) throw response;
    return { ok: response.ok, status: response.status, json: async () => response.body };
  };
  return { impl, calls };
}

const fixedNow = () => new Date('2026-09-28T10:00:00.000Z');

describe('EU VAT number formats', () => {
  it('normalises prefix, spacing and the Greek EL prefix', () => {
    expect(normaliseEuVat('DE', 'de 123.456-789')).toEqual({
      memberState: 'DE',
      number: '123456789',
    });
    expect(normaliseEuVat('DE', '123456789')).toEqual({ memberState: 'DE', number: '123456789' });
    expect(normaliseEuVat('GR', 'EL123456789')).toEqual({ memberState: 'EL', number: '123456789' });
    expect(normaliseEuVat('GR', 'GR123456789')).toEqual({ memberState: 'EL', number: '123456789' });
    expect(viesMemberState('gr')).toBe('EL');
  });

  it('keeps national numbers that start with letters (AT, FR key, ES)', () => {
    expect(isEuVatFormatValid('AT', 'ATU12345678')).toBe(true);
    expect(isEuVatFormatValid('AT', 'U12345678')).toBe(true);
    expect(isEuVatFormatValid('FR', 'FRXX123456789')).toBe(true);
    expect(isEuVatFormatValid('FR', 'XX123456789')).toBe(true);
    expect(isEuVatFormatValid('ES', 'ESA2801586J')).toBe(true);
    expect(isEuVatFormatValid('NL', 'NL123456789B01')).toBe(true);
  });

  it('rejects wrong lengths, non-EU countries and another member state prefix', () => {
    expect(isEuVatFormatValid('DE', 'DE12345678')).toBe(false);
    expect(isEuVatFormatValid('NL', 'NL123456789')).toBe(false);
    expect(isEuVatFormatValid('US', '12-3456789')).toBe(false);
    expect(normaliseEuVat('DE', 'FR12345678901')).toBeNull();
    expect(isEuVatFormatValid('DE', 'FR12345678901')).toBe(false);
  });

  it('TAX_VAT_VALIDATION defaults to format and rejects unknown values', () => {
    expect(vatValidationModeFromEnv({})).toBe('format');
    expect(vatValidationModeFromEnv({ TAX_VAT_VALIDATION: 'VIES' })).toBe('vies');
    expect(() => vatValidationModeFromEnv({ TAX_VAT_VALIDATION: 'strict' })).toThrow(
      /none \| format \| vies/,
    );
  });
});

describe('ViesVatClient', () => {
  it('posts country code and number without prefix, plus the requester for a consultation number', async () => {
    const { impl, calls } = fakeFetch({
      ok: true,
      status: 200,
      body: {
        countryCode: 'DE',
        vatNumber: '123456789',
        valid: true,
        name: 'ACME GMBH',
        address: 'Berlin',
        requestIdentifier: 'WAPIAAAAX1',
      },
    });
    const client = new ViesVatClient({
      fetchImpl: impl,
      requesterVat: 'IE 1234567X',
      now: fixedNow,
    });
    const r = await client.check('DE', 'DE123456789');
    expect(calls[0].url).toBe(
      'https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number',
    );
    expect(JSON.parse(calls[0].init.body)).toEqual({
      countryCode: 'DE',
      vatNumber: '123456789',
      requesterMemberStateCode: 'IE',
      requesterNumber: '1234567X',
    });
    expect(r).toMatchObject({
      status: 'VALID',
      name: 'ACME GMBH',
      consultationNumber: 'WAPIAAAAX1',
      source: 'vies',
      checkedAt: '2026-09-28T10:00:00.000Z',
    });
  });

  it('a completed lookup with valid:false is INVALID; "---" placeholders are dropped', async () => {
    const { impl } = fakeFetch({
      ok: true,
      status: 200,
      body: { valid: false, name: '---', address: '---' },
    });
    const r = await new ViesVatClient({ fetchImpl: impl }).check('DE', '123456789');
    expect(r.status).toBe('INVALID');
    expect(r.name).toBeUndefined();
  });

  it('reads the fault fields before `valid`: a fault inside HTTP 200 is UNAVAILABLE, never VALID', async () => {
    const { impl } = fakeFetch({
      ok: true,
      status: 200,
      body: { actionSucceed: false, errorWrappers: [{ error: 'MS_UNAVAILABLE' }], valid: true },
    });
    const r = await new ViesVatClient({ fetchImpl: impl }).check('DE', '123456789');
    expect(r.status).toBe('UNAVAILABLE');
    expect(r.error).toMatch(/MS_UNAVAILABLE \(retry later\)/);
  });

  it('INVALID_INPUT is INVALID; network errors and bodiless errors are UNAVAILABLE', async () => {
    const bad = await new ViesVatClient({
      fetchImpl: fakeFetch({
        ok: false,
        status: 400,
        body: { errorWrappers: [{ error: 'INVALID_INPUT' }] },
      }).impl,
    }).check('DE', '123456789');
    expect(bad.status).toBe('INVALID');
    const down = await new ViesVatClient({
      fetchImpl: fakeFetch(new Error('ECONNRESET')).impl,
    }).check('DE', '123456789');
    expect(down.status).toBe('UNAVAILABLE');
    const empty = await new ViesVatClient({
      fetchImpl: fakeFetch({ ok: false, status: 502, body: null }).impl,
    }).check('DE', '123456789');
    expect(empty).toMatchObject({ status: 'UNAVAILABLE', error: 'VIES HTTP 502' });
    const noFlag = await new ViesVatClient({
      fetchImpl: fakeFetch({ ok: true, status: 200, body: {} }).impl,
    }).check('DE', '123456789');
    expect(noFlag.status).toBe('UNAVAILABLE');
  });

  it('malformed or foreign numbers are INVALID without a network call', async () => {
    const { impl, calls } = fakeFetch({ ok: true, status: 200, body: { valid: true } });
    const client = new ViesVatClient({ fetchImpl: impl });
    expect((await client.check('DE', '12345')).status).toBe('INVALID');
    expect((await client.check('DE', 'FR12345678901')).status).toBe('INVALID');
    expect((await client.check('US', '123456789')).status).toBe('INVALID');
    expect(calls).toHaveLength(0);
  });
});

describe('verifyVatForReverseCharge', () => {
  const vies = {
    check: jest.fn(async () => ({
      status: 'VALID' as const,
      countryCode: 'DE',
      vatNumber: '123456789',
      source: 'vies' as const,
      checkedAt: 'x',
    })),
  };

  it('none -> SKIPPED, format -> format check, vies -> VIES', async () => {
    expect((await verifyVatForReverseCharge('none', 'DE', 'anything', vies, fixedNow)).status).toBe(
      'SKIPPED',
    );
    expect(
      (await verifyVatForReverseCharge('format', 'DE', 'DE123456789', vies, fixedNow)).status,
    ).toBe('VALID');
    expect((await verifyVatForReverseCharge('format', 'DE', 'DE1234', vies, fixedNow)).status).toBe(
      'INVALID',
    );
    expect(vies.check).not.toHaveBeenCalled();
    expect(
      (await verifyVatForReverseCharge('vies', 'DE', 'DE123456789', vies, fixedNow)).source,
    ).toBe('vies');
    expect(vies.check).toHaveBeenCalledWith('DE', 'DE123456789');
  });
});

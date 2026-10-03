import { TwilioSmsProvider, SmsFetchLike, maskPhone } from './twilio-sms.provider';
import { NotificationChannel } from './billing-notification.types';
import {
  ProviderDeliveryResultType,
  SendNotificationInput,
} from './notification-provider.interface';

const SID = 'AC' + '0123456789abcdef'.repeat(2);
const MG = 'MG' + 'fedcba9876543210'.repeat(2);
const MSG_SID = 'SM' + 'a'.repeat(32);

const input = (overrides: Partial<SendNotificationInput> = {}): SendNotificationInput => ({
  tenantId: 'tenant_1',
  recipientPhone: '+8801711000000',
  subject: 'Payment failed',
  body: 'Your payment failed. Please update your card.',
  channel: NotificationChannel.SMS,
  templateKey: 'payment_failed',
  safePayload: {},
  idempotencyKey: 'notif_123',
  ...overrides,
});

function fakeFetch(response: { ok: boolean; status: number; body: any } | Error) {
  const calls: Array<{ url: string; init: any }> = [];
  const impl: SmsFetchLike = async (url, init) => {
    calls.push({ url, init });
    if (response instanceof Error) throw response;
    return { ok: response.ok, status: response.status, json: async () => response.body };
  };
  return { impl, calls };
}

const configured = (fetchImpl: SmsFetchLike, extra: Record<string, string> = {}) =>
  new TwilioSmsProvider({
    accountSid: SID,
    authToken: 'secret-token',
    fromNumber: '+15005550006',
    fetchImpl,
    ...extra,
  });

describe('TwilioSmsProvider', () => {
  it('is unavailable (and throws, calling nothing) when configuration is incomplete', async () => {
    const { impl, calls } = fakeFetch({ ok: true, status: 201, body: {} });
    const cases = [
      new TwilioSmsProvider({ fetchImpl: impl, accountSid: '', authToken: '', fromNumber: '' }),
      new TwilioSmsProvider({
        fetchImpl: impl,
        accountSid: SID,
        authToken: '',
        fromNumber: '+15005550006',
      }),
      new TwilioSmsProvider({
        fetchImpl: impl,
        accountSid: SID,
        authToken: 't',
        fromNumber: '5550006',
      }),
      new TwilioSmsProvider({
        fetchImpl: impl,
        accountSid: 'AC123',
        authToken: 't',
        fromNumber: '+15005550006',
      }),
    ];
    for (const p of cases) {
      expect(p.isAvailable()).toBe(false);
      await expect(p.send(input())).rejects.toThrow(/not configured/);
    }
    expect(calls).toHaveLength(0);
    const problems = cases[0].configurationProblems().join(' ');
    expect(problems).toContain('TWILIO_ACCOUNT_SID');
    expect(problems).not.toContain('secret-token');
  });

  it('queues an SMS: Basic auth, From number, idempotency token, accepted only with a message sid', async () => {
    const { impl, calls } = fakeFetch({
      ok: true,
      status: 201,
      body: { sid: MSG_SID, status: 'queued', num_segments: '1' },
    });
    const r = await configured(impl).send(input());
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`);
    expect(calls[0].init.headers.Authorization).toBe(
      `Basic ${Buffer.from(`${SID}:secret-token`).toString('base64')}`,
    );
    expect(calls[0].init.headers['I-Twilio-Idempotency-Token']).toBe('notif_123');
    const form = new URLSearchParams(calls[0].init.body);
    expect(form.get('To')).toBe('+8801711000000');
    expect(form.get('From')).toBe('+15005550006');
    expect(form.get('Body')).toContain('payment failed');
    expect(r).toMatchObject({
      accepted: true,
      providerReference: MSG_SID,
      resultType: ProviderDeliveryResultType.ACCEPTED,
    });
    expect(JSON.stringify(r)).not.toContain('secret-token');
  });

  it('prefers a Messaging Service and an API key when configured', async () => {
    const { impl, calls } = fakeFetch({
      ok: true,
      status: 201,
      body: { sid: MSG_SID, status: 'accepted' },
    });
    const p = new TwilioSmsProvider({
      accountSid: SID,
      authToken: 'account-token',
      apiKeySid: 'SK' + 'b'.repeat(32),
      apiKeySecret: 'key-secret',
      messagingServiceSid: MG,
      fetchImpl: impl,
    });
    expect((await p.send(input())).accepted).toBe(true);
    const form = new URLSearchParams(calls[0].init.body);
    expect(form.get('MessagingServiceSid')).toBe(MG);
    expect(form.get('From')).toBeNull();
    expect(calls[0].init.headers.Authorization).toBe(
      `Basic ${Buffer.from(`SK${'b'.repeat(32)}:key-secret`).toString('base64')}`,
    );
  });

  it('a missing or non-E.164 recipient is a permanent failure without an API call', async () => {
    const { impl, calls } = fakeFetch({
      ok: true,
      status: 201,
      body: { sid: MSG_SID, status: 'queued' },
    });
    for (const recipientPhone of [undefined, '01711000000', '+0123', 'abc']) {
      const r = await configured(impl).send(input({ recipientPhone }));
      expect(r).toMatchObject({
        accepted: false,
        retryable: false,
        errorCode: 'SMS_INVALID_RECIPIENT',
      });
    }
    expect(calls).toHaveLength(0);
  });

  it('maps Twilio errors: 4xx permanent, 429/5xx/network retryable', async () => {
    const perm = await configured(
      fakeFetch({
        ok: false,
        status: 400,
        body: { code: 21211, message: "Invalid 'To' Phone Number" },
      }).impl,
    ).send(input());
    expect(perm).toMatchObject({
      accepted: false,
      retryable: false,
      errorCode: 'TWILIO_21211',
      resultType: ProviderDeliveryResultType.PERMANENT_FAILURE,
    });

    const limited = await configured(
      fakeFetch({ ok: false, status: 429, body: { code: 20429, message: 'Too Many Requests' } })
        .impl,
    ).send(input());
    expect(limited).toMatchObject({
      accepted: false,
      retryable: true,
      resultType: ProviderDeliveryResultType.TEMPORARY_FAILURE,
    });

    const down = await configured(fakeFetch({ ok: false, status: 503, body: null }).impl).send(
      input(),
    );
    expect(down).toMatchObject({ accepted: false, retryable: true, errorCode: 'TWILIO_HTTP_503' });

    const network = await configured(fakeFetch(new Error('ECONNRESET')).impl).send(input());
    expect(network).toMatchObject({
      accepted: false,
      retryable: true,
      errorCode: 'SMS_NETWORK_ERROR',
    });
  });

  it('a 2xx without a message sid, or with a failed status, is not accepted', async () => {
    const noSid = await configured(
      fakeFetch({ ok: true, status: 201, body: { status: 'queued' } }).impl,
    ).send(input());
    expect(noSid.accepted).toBe(false);
    const failed = await configured(
      fakeFetch({
        ok: true,
        status: 201,
        body: { sid: MSG_SID, status: 'failed', error_code: 30006 },
      }).impl,
    ).send(input());
    expect(failed).toMatchObject({ accepted: false, retryable: false, errorCode: 'TWILIO_30006' });
  });

  it('delivery status: delivered only when Twilio says delivered', async () => {
    const p = configured(fakeFetch({ ok: true, status: 200, body: { status: 'sent' } }).impl);
    expect(await p.getDeliveryStatus(MSG_SID)).toEqual({ delivered: false, status: 'sent' });
    const d = configured(fakeFetch({ ok: true, status: 200, body: { status: 'delivered' } }).impl);
    expect(await d.getDeliveryStatus(MSG_SID)).toEqual({ delivered: true, status: 'delivered' });
    await expect(d.getDeliveryStatus('inapp_1')).rejects.toThrow(/Not a Twilio message sid/);
  });

  it('masks phone numbers for logs', () => {
    expect(maskPhone('+8801711000000')).toBe('+88****00');
    expect(maskPhone(undefined)).toBe('(none)');
  });
});

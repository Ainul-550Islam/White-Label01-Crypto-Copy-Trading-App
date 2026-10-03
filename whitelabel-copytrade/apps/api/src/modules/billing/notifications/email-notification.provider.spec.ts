import { EmailNotificationProvider } from './email-notification.provider';
import { NotificationChannel } from './billing-notification.types';
import {
  ProviderDeliveryResultType,
  SendNotificationInput,
} from './notification-provider.interface';

const input = (overrides: Partial<SendNotificationInput> = {}): SendNotificationInput => ({
  tenantId: 'tenant_1',
  recipientEmail: 'billing@acme.example',
  subject: 'Invoice INV-0001',
  body: 'Your invoice is ready.',
  channel: NotificationChannel.EMAIL,
  templateKey: 'invoice_issued',
  safePayload: {},
  idempotencyKey: 'notif_1',
  ...overrides,
});

const SMTP_ENV = {
  SMTP_HOST: 'smtp.acme.example',
  SMTP_PORT: '587',
  SMTP_USER: 'mailer',
  SMTP_PASS: 'pw',
  SMTP_FROM: 'no-reply@acme.example',
};

describe('EmailNotificationProvider', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [...Object.keys(SMTP_ENV), 'EMAIL_HOST', 'EMAIL_FROM', 'EMAIL_USER']) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    jest.restoreAllMocks();
  });

  function configured(): EmailNotificationProvider {
    Object.assign(process.env, SMTP_ENV);
    return new EmailNotificationProvider();
  }

  it('refuses, never fakes, when the nodemailer transport cannot be loaded', async () => {
    jest.spyOn(EmailNotificationProvider, 'loadNodemailer').mockResolvedValue(null);
    const result = await configured().send(input());
    expect(result).toEqual({
      accepted: false,
      providerReference: null,
      resultType: ProviderDeliveryResultType.PERMANENT_FAILURE,
      retryable: false,
      errorCode: 'EMAIL_TRANSPORT_UNAVAILABLE',
      failureReason: 'Email transport unavailable: the nodemailer package is not installed.',
    });
  });

  it('accepts only after the SMTP server returned a message id', async () => {
    const sendMail = jest.fn(async () => ({ messageId: '<abc@acme.example>' }));
    const createTransport = jest.fn(() => ({ sendMail }));
    jest
      .spyOn(EmailNotificationProvider, 'loadNodemailer')
      .mockResolvedValue({ createTransport } as never);
    const result = await configured().send(input());
    expect(result).toMatchObject({
      accepted: true,
      providerReference: '<abc@acme.example>',
      resultType: ProviderDeliveryResultType.ACCEPTED,
    });
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.acme.example',
        port: 587,
        auth: { user: 'mailer', pass: 'pw' },
      }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'no-reply@acme.example',
        to: 'billing@acme.example',
        headers: expect.objectContaining({ 'X-Idempotency-Key': 'notif_1' }),
      }),
    );
  });

  it('classifies a temporary SMTP rejection as retryable', async () => {
    const sendMail = jest.fn(async () => {
      throw new Error('421 Service not available, try again later');
    });
    jest
      .spyOn(EmailNotificationProvider, 'loadNodemailer')
      .mockResolvedValue({ createTransport: () => ({ sendMail }) } as never);
    const result = await configured().send(input());
    expect(result).toMatchObject({
      accepted: false,
      retryable: true,
      errorCode: 'SMTP_TEMPORARY_FAILURE',
    });
  });

  it('classifies an authentication failure as permanent', async () => {
    const sendMail = jest.fn(async () => {
      throw new Error('535 Authentication failed');
    });
    jest
      .spyOn(EmailNotificationProvider, 'loadNodemailer')
      .mockResolvedValue({ createTransport: () => ({ sendMail }) } as never);
    const result = await configured().send(input());
    expect(result).toMatchObject({
      accepted: false,
      retryable: false,
      errorCode: 'SMTP_PERMANENT_FAILURE',
    });
  });

  it('reports SMTP_NOT_CONFIGURED without a host', async () => {
    const load = jest.spyOn(EmailNotificationProvider, 'loadNodemailer');
    const result = await new EmailNotificationProvider().send(input());
    expect(result).toMatchObject({ accepted: false, errorCode: 'SMTP_NOT_CONFIGURED' });
    expect(load).not.toHaveBeenCalled();
  });

  it('rejects an invalid recipient before touching the transport', async () => {
    const load = jest.spyOn(EmailNotificationProvider, 'loadNodemailer');
    const result = await configured().send(input({ recipientEmail: 'not-an-email' }));
    expect(result).toMatchObject({ accepted: false, errorCode: 'INVALID_EMAIL' });
    expect(load).not.toHaveBeenCalled();
  });

  it('loads the real nodemailer module in this workspace', async () => {
    const mod = await EmailNotificationProvider.loadNodemailer();
    expect(typeof mod?.createTransport).toBe('function');
  });
});

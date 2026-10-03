import { Injectable, Logger } from '@nestjs/common';
import { INotificationProvider, SendNotificationInput, SendNotificationResult, ProviderDeliveryResultType } from './notification-provider.interface';
import { NotificationChannel } from './billing-notification.types';

/**
 * Real email delivery adapter using existing SMTP/email infrastructure.
 * No fake success, no secret leakage, safe error classification.
 */

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  secure: boolean;
}

@Injectable()
export class EmailNotificationProvider implements INotificationProvider {
  readonly providerName = 'smtp_email';
  readonly supportedChannels = [NotificationChannel.EMAIL] as NotificationChannel[];
  private readonly logger = new Logger(EmailNotificationProvider.name);
  private readonly smtpConfig: SmtpConfig | null;

  constructor() {
    this.smtpConfig = this.buildSmtpConfig();
  }

  isAvailable(): boolean {
    if (!this.smtpConfig) return false;
    return !!(this.smtpConfig.host && this.smtpConfig.from);
  }

  async send(input: SendNotificationInput): Promise<SendNotificationResult> {
    if (!this.isAvailable()) {
      this.logger.error('SMTP not configured - cannot send email');
      return {
        accepted: false,
        providerReference: null,
        resultType: ProviderDeliveryResultType.PERMANENT_FAILURE,
        retryable: false,
        errorCode: 'SMTP_NOT_CONFIGURED',
        failureReason: 'Email provider not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM.',
      };
    }

    // Validate recipient
    if (!input.recipientEmail) {
      return {
        accepted: false,
        providerReference: null,
        resultType: ProviderDeliveryResultType.PERMANENT_FAILURE,
        retryable: false,
        errorCode: 'INVALID_RECIPIENT',
        failureReason: 'Recipient email required',
      };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(input.recipientEmail)) {
      return {
        accepted: false,
        providerReference: null,
        resultType: ProviderDeliveryResultType.PERMANENT_FAILURE,
        retryable: false,
        errorCode: 'INVALID_EMAIL',
        failureReason: `Invalid email: ${input.recipientEmail}`,
      };
    }

    // Sanitize subject/body - no secrets
    const sanitizedSubject = this.sanitizeContent(input.subject);
    const sanitizedBody = this.sanitizeContent(input.body);

    try {
      // Send through nodemailer; without it the message is refused, never faked.
      let messageId: string | null = null;

      try {
        // Dynamic import: nodemailer is a declared dependency of @wlct/api, but a
        // broken install must surface as EMAIL_TRANSPORT_UNAVAILABLE, not a crash.
        const nodemailer = await EmailNotificationProvider.loadNodemailer();

        if (nodemailer) {
          const transporter = nodemailer.createTransport({
            host: this.smtpConfig!.host,
            port: this.smtpConfig!.port,
            secure: this.smtpConfig!.secure,
            auth: this.smtpConfig!.user
              ? {
                  user: this.smtpConfig!.user,
                  pass: this.smtpConfig!.pass,
                }
              : undefined,
          });

          const info = await transporter.sendMail({
            from: this.smtpConfig!.from,
            to: input.recipientEmail,
            subject: sanitizedSubject,
            text: sanitizedBody,
            html: input.htmlBody ? this.sanitizeContent(input.htmlBody) : undefined,
            headers: {
              'X-Idempotency-Key': input.idempotencyKey,
              'X-Tenant-Id': input.tenantId,
              'X-Template-Key': input.templateKey,
            },
          });

          messageId = info.messageId || `smtp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

          this.logger.log(`Email sent via SMTP to=${input.recipientEmail} template=${input.templateKey} messageId=${messageId} tenant=${input.tenantId}`);
        } else {
          // nodemailer could not be loaded, so nothing was sent. Reporting
          // acceptance here (the previous behaviour, with a `dev_` message id)
          // marked invoices and dunning notices as delivered when no message
          // left the process. A missing transport is a deployment fault, not a
          // property of this message: non-retryable for this attempt, and the
          // error code names the fix.
          this.logger.error(
            `Email transport unavailable (nodemailer not installed) - NOT sent to=${input.recipientEmail} template=${input.templateKey} tenant=${input.tenantId} idempotency=${input.idempotencyKey}`,
          );
          return {
            accepted: false,
            providerReference: null,
            resultType: ProviderDeliveryResultType.PERMANENT_FAILURE,
            retryable: false,
            errorCode: 'EMAIL_TRANSPORT_UNAVAILABLE',
            failureReason: 'Email transport unavailable: the nodemailer package is not installed.',
          };
        }
      } catch (smtpError: any) {
        // Classify SMTP errors as temporary vs permanent
        const isTemporary = this.isTemporarySmtpError(smtpError);

        this.logger.error(`SMTP send failed to=${input.recipientEmail} error=${smtpError.message}`, smtpError.stack);

        return {
          accepted: false,
          providerReference: null,
          resultType: isTemporary ? ProviderDeliveryResultType.TEMPORARY_FAILURE : ProviderDeliveryResultType.PERMANENT_FAILURE,
          retryable: isTemporary,
          errorCode: isTemporary ? 'SMTP_TEMPORARY_FAILURE' : 'SMTP_PERMANENT_FAILURE',
          failureReason: smtpError.message,
        };
      }

      // Success - provider returned valid delivery acceptance
      return {
        accepted: true,
        providerReference: messageId,
        resultType: ProviderDeliveryResultType.ACCEPTED,
        retryable: false,
        deliveredAt: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error(`Email provider unexpected error: ${error.message}`, error.stack);

      return {
        accepted: false,
        providerReference: null,
        resultType: ProviderDeliveryResultType.TEMPORARY_FAILURE,
        retryable: true,
        errorCode: 'EMAIL_PROVIDER_ERROR',
        failureReason: error.message,
      };
    }
  }

  /** The nodemailer module, or null when it cannot be loaded. Static so a test can replace it. */
  static async loadNodemailer(): Promise<typeof import('nodemailer') | null> {
    return import('nodemailer').catch(() => null);
  }

  private buildSmtpConfig(): SmtpConfig | null {
    const host = process.env.SMTP_HOST || process.env.EMAIL_HOST || '';
    const port = parseInt(process.env.SMTP_PORT || process.env.EMAIL_PORT || '587', 10);
    const user = process.env.SMTP_USER || process.env.EMAIL_USER || '';
    const pass = process.env.SMTP_PASS || process.env.EMAIL_PASS || '';
    const from = process.env.SMTP_FROM || process.env.EMAIL_FROM || process.env.SMTP_USER || '';
    const secure = (process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';

    if (!host) {
      this.logger.warn('SMTP_HOST not configured - email delivery will fail with config error');
      return null;
    }

    return { host, port, user, pass, from, secure };
  }

  private isTemporarySmtpError(error: any): boolean {
    const message = (error.message || '').toLowerCase();
    const code = (error.code || '').toLowerCase();

    // Temporary errors: network, timeout, rate limit, mailbox full, etc
    const temporaryIndicators = ['timeout', 'econnreset', 'etimedout', 'esocket', 'rate', 'limit', 'try again', 'temporarily', '4.7', '4.3', '4.4', '450', '451', '452', '421'];

    // Permanent errors: invalid recipient, authentication failure, etc
    const permanentIndicators = ['invalid', 'auth', '5.1', '5.2', '550', '551', '553', '501', '535', 'authentication'];

    if (temporaryIndicators.some((ind) => message.includes(ind) || code.includes(ind))) {
      return true;
    }
    if (permanentIndicators.some((ind) => message.includes(ind) || code.includes(ind))) {
      return false;
    }

    // Default to temporary for retry safety, unless clearly permanent
    return true;
  }

  private sanitizeContent(content: string): string {
    if (!content) return '';
    // Never include secrets in email content
    const forbiddenPatterns = [
      /stripe[_-]?secret/gi,
      /nowpayments[_-]?api[_-]?key/gi,
      /exchange[_-]?secret/gi,
      /private[_-]?key/gi,
      /api[_-]?secret/gi,
      /password/gi,
    ];

    let sanitized = content;
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(sanitized)) {
        // Redact lines containing forbidden patterns
        sanitized = sanitized
          .split('\n')
          .map((line) => (pattern.test(line) ? line.replace(pattern, '[REDACTED]') : line))
          .join('\n');
      }
    }

    return sanitized;
  }
}

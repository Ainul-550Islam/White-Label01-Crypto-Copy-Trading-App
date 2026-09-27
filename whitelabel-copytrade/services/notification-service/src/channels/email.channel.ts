import { createTransport, type Transporter } from 'nodemailer';
import type { Logger } from 'pino';
import type { EmailJob } from '@wlct/shared-types';

import type { WorkerConfig } from '../config';
import { renderEmail } from '../templates/email.template';

export interface DeliveryResult {
  delivered: boolean;
  providerMessageId: string | null;
}

/**
 * Email delivery.
 *
 * `console` is the default driver so a developer never needs live credentials
 * to exercise the flow, and CI cannot accidentally mail real customers. SMTP is
 * the production driver; hosted providers (SES, SendGrid, Postmark) plug in the
 * same way and are rejected loudly until their adapter is configured, rather
 * than silently dropping mail.
 */
export class EmailChannel {
  private transporter: Transporter | null = null;

  constructor(
    private readonly config: WorkerConfig,
    private readonly logger: Logger,
  ) {
    if (config.MAIL_DRIVER === 'smtp') {
      this.transporter = createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT ?? 587,
        secure: config.SMTP_SECURE,
        auth:
          config.SMTP_USER && config.SMTP_PASSWORD
            ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD }
            : undefined,
        // Never fall back to an unverified certificate in production.
        tls: { rejectUnauthorized: config.NODE_ENV === 'production' },
      });
    }
  }

  async send(job: EmailJob): Promise<DeliveryResult> {
    const rendered = renderEmail(job);

    switch (this.config.MAIL_DRIVER) {
      case 'console': {
        this.logger.info(
          {
            event: 'email.console',
            // The recipient address is PII: log only the domain.
            recipientDomain: job.to.split('@')[1] ?? 'unknown',
            tenantId: job.tenantId,
            templateType: job.templateType,
            subject: rendered.subject,
          },
          'Email rendered (console driver, nothing sent)',
        );
        return { delivered: true, providerMessageId: null };
      }

      case 'smtp': {
        if (!this.transporter) {
          throw new Error('SMTP transport is not initialised');
        }

        const info = await this.transporter.sendMail({
          from: { name: this.config.MAIL_FROM_NAME, address: this.config.MAIL_FROM_ADDRESS },
          to: job.to,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
          headers: {
            'X-Tenant-Id': job.tenantId,
            'X-Template-Type': job.templateType,
          },
        });

        return { delivered: true, providerMessageId: info.messageId ?? null };
      }

      default: {
        // Refuse rather than pretend: a "delivered" result we cannot honour
        // would hide a misconfiguration until a customer complains.
        throw new Error(
          `Mail driver "${this.config.MAIL_DRIVER}" has no adapter configured in this deployment.`,
        );
      }
    }
  }

  async verify(): Promise<boolean> {
    if (this.config.MAIL_DRIVER !== 'smtp' || !this.transporter) {
      return true;
    }

    try {
      await this.transporter.verify();
      return true;
    } catch (error) {
      this.logger.error(
        {
          event: 'email.verify_failed',
          err: error instanceof Error ? { name: error.name, message: error.message } : undefined,
        },
        'SMTP transport verification failed',
      );
      return false;
    }
  }

  async close(): Promise<void> {
    this.transporter?.close();
  }
}

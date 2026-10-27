import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';

interface RecoverySmtpConfig { host: string; port: number; secure: boolean; from: string; user: string; password: string }

/** Dedicated transport: never logs the recipient, link, token or provider response. */
@Injectable()
export class AccountRecoveryMailer {
  constructor(private readonly appConfig: AppConfigService) {}

  private config(): RecoverySmtpConfig | null {
    if (this.appConfig.mailDriver !== 'smtp') return null;
    const { port, secure, user, password } = this.appConfig.smtpOptions;
    const host = this.appConfig.smtpOptions.host.trim();
    const from = this.appConfig.mailFrom.address.trim();
    if (!host || /[\s\r\n]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535 ||
        !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(from) || Boolean(user) !== Boolean(password)) return null;
    return { host, port, secure, from, user, password };
  }

  isConfigured(): boolean { return this.config() !== null; }

  private async transport() {
    const config = this.config();
    if (!config) throw new Error('RECOVERY_MAIL_NOT_CONFIGURED');
    const mail = await import('nodemailer');
    const client = mail.createTransport({
      host: config.host, port: config.port, secure: config.secure,
      requireTLS: !config.secure, tls: { rejectUnauthorized: true },
      connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000,
      ...(config.user ? { auth: { user: config.user, pass: config.password } } : {}),
    });
    return { client, from: config.from };
  }

  async verify(): Promise<boolean> {
    try {
      const { client } = await this.transport();
      try { return (await client.verify()) === true; } finally { client.close(); }
    } catch { return false; }
  }

  async send(recipient: string, link: string): Promise<void> {
    const { client, from } = await this.transport();
    try {
      const result = await client.sendMail({
        from, to: recipient, subject: 'Account recovery',
        text: `A password recovery was requested for your account.\n\nOpen this link within 30 minutes:\n${link}\n\nIf you did not request this, ignore this message. Your two-factor authentication settings remain unchanged.`,
        headers: { 'Auto-Submitted': 'auto-generated' },
      });
      const accepted = Array.isArray(result.accepted) && result.accepted.some((item: unknown) => {
        if (typeof item === 'string') return item.toLowerCase() === recipient.toLowerCase();
        return !!item && typeof item === 'object' && 'address' in item && typeof item.address === 'string' && item.address.toLowerCase() === recipient.toLowerCase();
      });
      if (!accepted) throw new Error('RECOVERY_MAIL_NOT_ACCEPTED');
    } catch {
      // SMTP exception messages can include addresses, bodies or credentials.
      throw new Error('RECOVERY_MAIL_DELIVERY_FAILED');
    } finally { client.close(); }
  }
}

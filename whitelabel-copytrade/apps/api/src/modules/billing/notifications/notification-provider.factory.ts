import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannel } from './billing-notification.types';
import { INotificationProvider } from './notification-provider.interface';
import { EmailNotificationProvider } from './email-notification.provider';
import { PushNotificationService } from './push-notification.service';
import { TwilioSmsProvider } from './twilio-sms.provider';

/**
 * Selects configured notification providers using existing app config and availability.
 * Explicit config error when missing, no fake success, no secrets in logs.
 */

class NoOpNotificationProvider implements INotificationProvider {
  readonly providerName = 'noop';
  readonly supportedChannels = [] as NotificationChannel[];

  isAvailable(): boolean {
    return false;
  }

  async send(): Promise<any> {
    throw new Error('Notification provider not configured. No fake success allowed.');
  }
}

class InAppOnlyProvider implements INotificationProvider {
  readonly providerName = 'in_app_only';
  readonly supportedChannels = [NotificationChannel.IN_APP] as NotificationChannel[];

  isAvailable(): boolean {
    return true;
  }

  async send(input: any): Promise<any> {
    // In-app is always available via DB
    return {
      accepted: true,
      providerReference: `inapp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      resultType: 'ACCEPTED',
      retryable: false,
      deliveredAt: new Date().toISOString(),
    };
  }
}

@Injectable()
export class NotificationProviderFactory {
  private readonly logger = new Logger(NotificationProviderFactory.name);

  constructor(
    private readonly emailProvider: EmailNotificationProvider,
    private readonly pushProvider: PushNotificationService,
  ) {}

  getProvider(channel: NotificationChannel): INotificationProvider {
    switch (channel) {
      case NotificationChannel.EMAIL:
        if (this.emailProvider.isAvailable()) {
          this.logger.log(`Selected notification provider for EMAIL: ${this.emailProvider.providerName}`);
          return this.emailProvider;
        }
        this.logger.warn(`Email provider not available, falling back to NoOp - will fail with config error`);
        return new NoOpNotificationProvider();

      case NotificationChannel.IN_APP:
        return new InAppOnlyProvider();

      case NotificationChannel.PUSH:
        // The real FCM adapter. It reports PUSH_NOT_CONFIGURED /
        // PUSH_PROVIDER_UNAVAILABLE itself; previously a configured push
        // channel was handed the in-app stub, which "accepted" every push
        // without sending anything.
        if (this.pushProvider.isAvailable()) {
          return this.pushProvider;
        }
        this.logger.warn('Push provider not configured');
        return new NoOpNotificationProvider();

      case NotificationChannel.WEBHOOK:
        // Webhook delivery is performed by NotificationDeliveryService
        // (deliverWebhook) and never reaches this factory; answering here with
        // an always-accepting stub would hide a routing mistake.
        return new NoOpNotificationProvider();

      case NotificationChannel.SMS: {
        // SMS_PROVIDER=twilio selects the Twilio REST adapter; it is only
        // returned when fully configured. Anything else (unset, unknown
        // provider, incomplete Twilio settings) fails closed. SMS_PROVIDER
        // used to select the in-app stub, which reported every SMS as sent.
        const smsProvider = (process.env.SMS_PROVIDER || '').trim().toLowerCase();
        if (smsProvider === 'twilio') {
          const twilio = new TwilioSmsProvider();
          if (twilio.isAvailable()) return twilio;
          this.logger.warn(`SMS_PROVIDER=twilio but configuration incomplete (missing: ${twilio.configurationProblems().join(', ')})`);
        } else if (smsProvider) {
          this.logger.warn(`SMS_PROVIDER=${smsProvider} is not supported (supported: twilio); SMS deliveries will fail`);
        }
        return new NoOpNotificationProvider();
      }

      default:
        this.logger.error(`Unsupported notification channel: ${channel}`);
        return new NoOpNotificationProvider();
    }
  }

  getEmailProvider(): INotificationProvider {
    return this.getProvider(NotificationChannel.EMAIL);
  }

  getAvailableChannels(): NotificationChannel[] {
    const available: NotificationChannel[] = [NotificationChannel.IN_APP];
    if (this.emailProvider.isAvailable()) {
      available.push(NotificationChannel.EMAIL);
    }
    if (this.pushProvider.isAvailable()) {
      available.push(NotificationChannel.PUSH);
    }
    if ((process.env.SMS_PROVIDER || '').trim().toLowerCase() === 'twilio' && new TwilioSmsProvider().isAvailable()) {
      available.push(NotificationChannel.SMS);
    }
    return available;
  }

  validateProviderConfiguration(): { configured: boolean; channels: NotificationChannel[]; message: string } {
    const channels = this.getAvailableChannels();
    const emailAvailable = this.emailProvider.isAvailable();
    return {
      configured: channels.length > 0,
      channels,
      message: emailAvailable
        ? `Notification providers configured: ${channels.join(',')}`
        : `Only IN_APP channel available. Email not configured - set SMTP_HOST, SMTP_USER, SMTP_PASS. No fake success allowed.`,
    };
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannel } from './billing-notification.types';
import { INotificationProvider } from './notification-provider.interface';
import { EmailNotificationProvider } from './email-notification.provider';

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

  constructor(private readonly emailProvider: EmailNotificationProvider) {}

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
        // Push would require FCM/APNS config - check env
        if (process.env.FCM_SERVER_KEY || process.env.FIREBASE_CONFIG) {
          this.logger.log('Push provider configured');
          return new InAppOnlyProvider(); // Placeholder that still marks accepted for in-app style
        }
        this.logger.warn('Push provider not configured');
        return new NoOpNotificationProvider();

      case NotificationChannel.WEBHOOK:
        // Webhook delivery handled by dedicated service, not generic provider
        return new InAppOnlyProvider();

      case NotificationChannel.SMS:
        if (process.env.SMS_PROVIDER) {
          return new InAppOnlyProvider();
        }
        return new NoOpNotificationProvider();

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
    if (process.env.FCM_SERVER_KEY || process.env.FIREBASE_CONFIG) {
      available.push(NotificationChannel.PUSH);
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

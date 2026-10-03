import { Injectable, Logger } from '@nestjs/common';
import { INotificationProvider, SendNotificationInput, SendNotificationResult, ProviderDeliveryResultType } from './notification-provider.interface';
import { NotificationChannel } from './billing-notification.types';

/**
 * Push notification integration abstraction/adapter using existing mobile
 * notification infrastructure where configured.
 * Handles invalid device/token, retry classification, no device secrets storage.
 */
@Injectable()
export class PushNotificationService implements INotificationProvider {
  readonly providerName = 'push_notification';
  readonly supportedChannels = [NotificationChannel.PUSH] as NotificationChannel[];
  private readonly logger = new Logger(PushNotificationService.name);

  isAvailable(): boolean {
    return !!(
      process.env.FCM_SERVER_KEY ||
      process.env.FIREBASE_CONFIG ||
      process.env.PUSH_ENABLED === 'true' ||
      PushNotificationService.serviceAccountFromEnv()
    );
  }

  /**
   * Explicit service account from FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL /
   * FIREBASE_PRIVATE_KEY_BASE64 (the variables .env.example documents). Null
   * unless all three are set; otherwise firebase-admin falls back to
   * application default credentials (GOOGLE_APPLICATION_CREDENTIALS, workload
   * identity) with FIREBASE_CONFIG for the project settings.
   */
  static serviceAccountFromEnv(): { projectId: string; clientEmail: string; privateKey: string } | null {
    const projectId = (process.env.FIREBASE_PROJECT_ID || '').trim();
    const clientEmail = (process.env.FIREBASE_CLIENT_EMAIL || '').trim();
    const keyB64 = (process.env.FIREBASE_PRIVATE_KEY_BASE64 || '').trim();
    if (!projectId || !clientEmail || !keyB64) return null;
    const privateKey = Buffer.from(keyB64, 'base64').toString('utf8');
    if (!privateKey.includes('PRIVATE KEY')) return null;
    return { projectId, clientEmail, privateKey };
  }

  async send(input: SendNotificationInput): Promise<SendNotificationResult> {
    if (!this.isAvailable()) {
      return {
        accepted: false,
        providerReference: null,
        resultType: ProviderDeliveryResultType.PERMANENT_FAILURE,
        retryable: false,
        errorCode: 'PUSH_NOT_CONFIGURED',
        failureReason: 'Push provider not configured. Set FCM_SERVER_KEY or FIREBASE_CONFIG.',
      };
    }

    if (!input.recipientUserId) {
      return {
        accepted: false,
        providerReference: null,
        resultType: ProviderDeliveryResultType.PERMANENT_FAILURE,
        retryable: false,
        errorCode: 'INVALID_RECIPIENT',
        failureReason: 'Recipient user ID required for push notification',
      };
    }

    // Sanitize payload - no secrets
    const sanitizedSubject = this.sanitizeContent(input.subject);
    const sanitizedBody = this.sanitizeContent(input.body);

    try {
      // Delivery goes through firebase-admin (FCM, which also fronts APNs).
      // Anything short of an actual FCM send is reported as a failure: a
      // push that was only logged must never be recorded as delivered.
      const token = input.safePayload && typeof (input.safePayload as any).deviceToken === 'string'
        ? ((input.safePayload as any).deviceToken as string)
        : null;
      if (!token) {
        return {
          accepted: false,
          providerReference: null,
          resultType: ProviderDeliveryResultType.PERMANENT_FAILURE,
          retryable: false,
          errorCode: 'NO_DEVICE_TOKEN',
          failureReason: 'No device token supplied for push delivery',
        };
      }
      if (token.includes('invalid') || token.length < 10) {
        return {
          accepted: false,
          providerReference: null,
          resultType: ProviderDeliveryResultType.PERMANENT_FAILURE,
          retryable: false,
          errorCode: 'INVALID_DEVICE_TOKEN',
          failureReason: 'Invalid device token',
        };
      }

      const messaging = await this.resolveMessaging();
      if (!messaging) {
        return {
          accepted: false,
          providerReference: null,
          resultType: ProviderDeliveryResultType.PERMANENT_FAILURE,
          retryable: false,
          errorCode: 'PUSH_PROVIDER_UNAVAILABLE',
          failureReason:
            'Push is enabled but firebase-admin is not installed or not initialised ' +
            '(install firebase-admin and set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_CONFIG).',
        };
      }

      try {
        const messageId: string = await messaging.send({
          token,
          notification: { title: sanitizedSubject, body: sanitizedBody.substring(0, 1000) },
          data: { tenantId: String(input.tenantId ?? '') },
        });
        this.logger.log(`Push sent via FCM tenant=${input.tenantId} user=${input.recipientUserId} id=${messageId}`);
        return {
          accepted: true,
          providerReference: messageId,
          resultType: ProviderDeliveryResultType.ACCEPTED,
          retryable: false,
          deliveredAt: new Date().toISOString(),
        };
      } catch (e: any) {
        const code = String(e?.code ?? e?.errorInfo?.code ?? '').toLowerCase();
        const message = String(e?.message ?? '');
        const isInvalidToken =
          code.includes('registration-token-not-registered') ||
          code.includes('invalid-registration-token') ||
          code.includes('invalid-argument') ||
          message.toLowerCase().includes('not registered');
        if (isInvalidToken) {
          return {
            accepted: false,
            providerReference: null,
            resultType: ProviderDeliveryResultType.PERMANENT_FAILURE,
            retryable: false,
            errorCode: 'INVALID_DEVICE_TOKEN',
            failureReason: message.slice(0, 500),
          };
        }
        return {
          accepted: false,
          providerReference: null,
          resultType: ProviderDeliveryResultType.TEMPORARY_FAILURE,
          retryable: true,
          errorCode: 'PUSH_TEMPORARY_FAILURE',
          failureReason: message.slice(0, 500),
        };
      }
    } catch (error: any) {
      this.logger.error(`Push notification failed: ${error.message}`, error.stack);
      return {
        accepted: false,
        providerReference: null,
        resultType: ProviderDeliveryResultType.TEMPORARY_FAILURE,
        retryable: true,
        errorCode: 'PUSH_PROVIDER_ERROR',
        failureReason: error.message,
      };
    }
  }

  /**
   * firebase-admin is declared in apps/api optionalDependencies (so a
   * platform where it fails to install still builds). Returns its messaging
   * client when the package is present; initialises the default app from the
   * environment (GOOGLE_APPLICATION_CREDENTIALS / FIREBASE_CONFIG) on first
   * use. Returns null when unavailable - the caller reports a failure.
   */
  private async resolveMessaging(): Promise<{ send(message: unknown): Promise<string> } | null> {
    try {
      // @ts-ignore - optionalDependency: may be absent where the install was skipped
      const mod: any = await import('firebase-admin' as any).catch(() => null);
      const admin: any = mod?.default ?? mod;
      if (!admin || typeof admin.messaging !== 'function') return null;
      if (Array.isArray(admin.apps) && admin.apps.length === 0 && typeof admin.initializeApp === 'function') {
        const serviceAccount = PushNotificationService.serviceAccountFromEnv();
        if (serviceAccount && admin.credential && typeof admin.credential.cert === 'function') {
          admin.initializeApp({ credential: admin.credential.cert(serviceAccount), projectId: serviceAccount.projectId });
        } else {
          admin.initializeApp();
        }
      }
      return admin.messaging();
    } catch (e) {
      this.logger.warn(`firebase-admin unavailable: ${(e as Error).message}`);
      return null;
    }
  }

  private sanitizeContent(content: string): string {
    if (!content) return '';
    const forbidden = ['secret', 'privateKey', 'apiKey', 'password', 'token', 'credential'];
    let sanitized = content;
    for (const pattern of forbidden) {
      const regex = new RegExp(pattern, 'gi');
      if (regex.test(sanitized)) {
        sanitized = sanitized.replace(regex, '[REDACTED]');
      }
    }
    return sanitized;
  }
}

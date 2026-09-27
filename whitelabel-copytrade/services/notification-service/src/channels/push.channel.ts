import type { Logger } from 'pino';

import type { WorkerConfig } from '../config';
import type { DeliveryResult } from './email.channel';

export interface PushMessage {
  tenantId: string;
  userId: string;
  deviceTokens: string[];
  title: string;
  body: string;
  data: Record<string, unknown>;
}

/**
 * Push delivery.
 *
 * The provider integration (FCM/APNs/Expo) arrives with the mobile release in a
 * later part. Until a provider is configured the channel reports "not
 * delivered" instead of claiming success, so the API records the attempt as
 * failed and nothing silently disappears.
 */
export class PushChannel {
  constructor(
    private readonly config: WorkerConfig,
    private readonly logger: Logger,
  ) {}

  get isConfigured(): boolean {
    return this.config.PUSH_PROVIDER !== 'none';
  }

  async send(message: PushMessage): Promise<DeliveryResult> {
    if (!this.isConfigured) {
      this.logger.warn(
        {
          event: 'push.not_configured',
          tenantId: message.tenantId,
          provider: this.config.PUSH_PROVIDER,
        },
        'Push provider is not configured; message not delivered',
      );
      return { delivered: false, providerMessageId: null };
    }

    throw new Error(
      `Push provider "${this.config.PUSH_PROVIDER}" is selected but its adapter is not deployed.`,
    );
  }
}

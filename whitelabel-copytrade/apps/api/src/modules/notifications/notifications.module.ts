// # Registers copy-trading and liquidation-risk notification processors
// # MODIFY — processor wiring
import { Global, Module } from '@nestjs/common';

import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationProcessor } from './processors/notification.processor';
import { PushDeviceController } from './push/push-device.controller';
import { PushDeviceService } from './push/push-device.service';
import { ApnsPushService } from './push/apns-push.service';
import { PushNotificationService } from '../billing/notifications/push-notification.service';
import {
  CopyTradingNotificationProcessor,
  type CopyTradingNotificationEventType,
  type CopyTradingNotificationPayload,
} from './processors/copy-trading-notification.processor';
import {
  LiquidationRiskNotificationProcessor,
  type LiquidationRiskAlertPayload,
  type LiquidationRiskDispatchResult,
} from './processors/liquidation-risk-notification.processor';
import {
  LoginAnomalyNotificationProcessor,
  type LoginAnomalyAlertPayload,
  type LoginAnomalyDispatchResult,
} from './processors/login-anomaly-notification.processor';

export {
  NotificationsService,
  NotificationsController,
  NotificationProcessor,
  CopyTradingNotificationProcessor,
  type CopyTradingNotificationEventType,
  type CopyTradingNotificationPayload,
  LiquidationRiskNotificationProcessor,
  type LiquidationRiskAlertPayload,
  type LiquidationRiskDispatchResult,
  LoginAnomalyNotificationProcessor,
  type LoginAnomalyAlertPayload,
  type LoginAnomalyDispatchResult,
};

/**
 * Transactional and copy-trading lifecycle notifications.
 * Marked Global so any domain module can enqueue or dispatch notifications
 * without introducing circular module dependencies.
 */
@Global()
@Module({
  controllers: [NotificationsController, PushDeviceController],
  providers: [
    NotificationsService,
    NotificationProcessor,
    PushDeviceService,
    ApnsPushService,
    PushNotificationService,
    CopyTradingNotificationProcessor,
    // GAP-65: liquidation/margin-health alerts. Exported because the risk monitor and the
    // execution engine's post-trade hook both dispatch through this one processor, so the
    // dedupe window and the preference rules cannot diverge between callers.
    LiquidationRiskNotificationProcessor,
    // GAP-79: sign-in anomaly alerts. Exported so the auth path can dispatch
    // straight after a scored sign-in, without a second dedupe window.
    LoginAnomalyNotificationProcessor,
  ],
  exports: [
    NotificationsService,
    CopyTradingNotificationProcessor,
    LiquidationRiskNotificationProcessor,
    LoginAnomalyNotificationProcessor,
  ],
})
export class NotificationsModule {}

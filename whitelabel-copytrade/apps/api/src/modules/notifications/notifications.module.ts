// # Registers copy-trading notification processor
// # MODIFY — processor wiring
import { Global, Module } from '@nestjs/common';

import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationProcessor } from './processors/notification.processor';
import {
  CopyTradingNotificationProcessor,
  type CopyTradingNotificationEventType,
  type CopyTradingNotificationPayload,
} from './processors/copy-trading-notification.processor';

export {
  NotificationsService,
  NotificationsController,
  NotificationProcessor,
  CopyTradingNotificationProcessor,
  type CopyTradingNotificationEventType,
  type CopyTradingNotificationPayload,
};

/**
 * Transactional and copy-trading lifecycle notifications.
 * Marked Global so any domain module can enqueue or dispatch notifications
 * without introducing circular module dependencies.
 */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationProcessor,
    CopyTradingNotificationProcessor,
  ],
  exports: [NotificationsService, CopyTradingNotificationProcessor],
})
export class NotificationsModule {}

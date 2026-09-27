import { Global, Module } from '@nestjs/common';

import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationProcessor } from './processors/notification.processor';

/**
 * Transactional notifications. Global so any module can enqueue a message
 * without importing this one, which keeps the dependency graph acyclic
 * (auth -> notifications -> queue -> redis).
 */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationProcessor],
  exports: [NotificationsService],
})
export class NotificationsModule {}

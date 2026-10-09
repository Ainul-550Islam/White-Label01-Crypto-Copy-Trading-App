// # NEW — Wires the transactional outbox writer and relay processor
import { Global, Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { ObservabilityModule } from '../../modules/observability/observability.module';
import { DeveloperModule } from '../../modules/developer-platform/developer.module';
import { NotificationsModule } from '../../modules/notifications/notifications.module';
import { OutboxRelayProcessor } from './outbox-relay.processor';
import { OutboxService } from './outbox.service';

/**
 * One outbox writer for domain modules and one leased relay per API process.
 * The destination modules are imports, not calls through the domain service
 * graph: event publication flows out of the transaction boundary and cannot
 * be a prerequisite for a trading operation to commit.
 */
@Global()
@Module({
  imports: [PrismaModule, ObservabilityModule, DeveloperModule, NotificationsModule],
  providers: [OutboxService, OutboxRelayProcessor],
  exports: [OutboxService],
})
export class OutboxModule {}

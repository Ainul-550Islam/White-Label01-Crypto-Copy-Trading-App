// # Responsibility: registers operator readiness probes and the platform-authorized commercial-readiness endpoint.
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { QueueModule } from '../queue/queue.module';
import { CommercialReadinessController } from './commercial-readiness.controller';
import { CommercialReadinessService } from './commercial-readiness.service';
@Module({ imports: [PrismaModule, RedisModule, QueueModule], controllers: [CommercialReadinessController], providers: [CommercialReadinessService], exports: [CommercialReadinessService] })
export class OpsModule {}

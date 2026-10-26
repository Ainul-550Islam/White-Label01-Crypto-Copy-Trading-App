// # Responsibility: wires the Batch 04 capability into the Nest application module graph.
// # Registers tenant-bound customer privacy request endpoints using the existing governance request, export, and deletion services.
import { Module } from '@nestjs/common';
import { GovernanceModule } from '../governance/governance.module';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { PrivacyExportDownloadService } from './privacy-export-download.service';
import { PrivacySelfServiceController } from './privacy-self-service.controller';

@Module({ imports: [GovernanceModule, PrismaModule, RedisModule], controllers: [PrivacySelfServiceController], providers: [PrivacyExportDownloadService] })
export class PrivacyModule {}

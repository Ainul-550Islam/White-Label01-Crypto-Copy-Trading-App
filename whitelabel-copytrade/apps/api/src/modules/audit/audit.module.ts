import { Global, Module } from '@nestjs/common';

import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditRepository } from './audit.repository';

/**
 * Append-only audit trail. Global because interceptors, guards and services
 * across every module need to emit records.
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditRepository],
  exports: [AuditService],
})
export class AuditModule {}

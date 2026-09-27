import { Global, Module } from '@nestjs/common';

import { PrismaService } from './prisma.service';
import { TenantScopedPrismaFactory } from './tenant-scoped-prisma.factory';

/**
 * Database access layer. Exported globally because virtually every module needs
 * repository access, but always through the tenant-aware helpers below.
 */
@Global()
@Module({
  providers: [PrismaService, TenantScopedPrismaFactory],
  exports: [PrismaService, TenantScopedPrismaFactory],
})
export class PrismaModule {}

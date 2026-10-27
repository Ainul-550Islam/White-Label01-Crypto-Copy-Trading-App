// # Wires step-up verification to the existing password, TOTP, lockout, Redis, audit, and session providers.
import { Global, Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth.module';
import { AppConfigModule } from '../../../config/app-config.module';
import { PrismaModule } from '../../../infrastructure/prisma/prisma.module';
import { RedisModule } from '../../../infrastructure/redis/redis.module';
import { CryptoModule } from '../../../infrastructure/crypto/crypto.module';
import { AuditModule } from '../../audit/audit.module';
import { StepUpService } from './step-up.service';

@Global()
@Module({
  imports: [
    forwardRef(() => AuthModule),
    AppConfigModule,
    PrismaModule,
    RedisModule,
    CryptoModule,
    AuditModule,
  ],
  // AuthModule provides the active controller and global single-use guard.
  providers: [StepUpService],
  exports: [StepUpService],
})
export class StepUpModule {}

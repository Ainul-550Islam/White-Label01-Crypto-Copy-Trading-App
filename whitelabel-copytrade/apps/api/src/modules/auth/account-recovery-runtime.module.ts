import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AccountRecoveryRuntimeService } from './account-recovery-runtime.service';
import { AccountRecoveryDeliveryProcessor } from './account-recovery-delivery.processor';
import { AccountRecoveryMailer } from './account-recovery-mailer.service';
import { RECOVERY_QUEUE } from './account-recovery-runtime.types';

/** API or worker replicas with validated SMTP configuration can consume this dedicated queue. */
@Module({
  imports: [BullModule.registerQueue({ name: RECOVERY_QUEUE })],
  providers: [AccountRecoveryRuntimeService, AccountRecoveryDeliveryProcessor, AccountRecoveryMailer],
  exports: [AccountRecoveryRuntimeService],
})
export class AccountRecoveryRuntimeModule {}

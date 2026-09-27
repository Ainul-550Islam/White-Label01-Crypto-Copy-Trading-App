import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { CustodyController } from './custody.controller';
import { CustodyPolicyService } from './custody-policy.service';
import { AssetRegistryService } from './asset-registry.service';
import { NetworkRegistryService } from './network-registry.service';
import { BlockchainProviderFactory } from './blockchain-provider.factory';
import { WalletRepository } from './wallet.repository';
import { WalletService } from './wallet.service';
import { WalletAddressService } from './wallet-address.service';
import { DepositAddressService } from './deposit-address.service';
import { DepositMonitoringService } from './deposit-monitoring.service';
import { WithdrawalPolicyService } from './withdrawal-policy.service';
import { WithdrawalOrchestrationService } from './withdrawal-orchestration.service';
import { TransactionService } from './transaction.service';
import { TransactionMonitoringService } from './transaction-monitoring.service';
import { ConfirmationService } from './confirmation.service';
import { BlockchainFeeService } from './blockchain-fee.service';
import { InternalTransferService } from './internal-transfer.service';
import { SettlementService } from './settlement.service';
import { TreasuryBalanceService } from './treasury-balance.service';
import { ReserveManagementService } from './reserve-management.service';
import { SweepService } from './sweep.service';
import { CustodyReconciliationService } from './custody-reconciliation.service';
import { CustodyAuditService } from './custody-audit.service';
import { CustodyVisibilityService } from './custody-visibility.service';

@Module({
  imports: [PrismaModule],
  controllers: [CustodyController],
  providers: [
    CustodyPolicyService,
    AssetRegistryService,
    NetworkRegistryService,
    BlockchainProviderFactory,
    WalletRepository,
    WalletService,
    WalletAddressService,
    DepositAddressService,
    DepositMonitoringService,
    WithdrawalPolicyService,
    WithdrawalOrchestrationService,
    TransactionService,
    TransactionMonitoringService,
    ConfirmationService,
    BlockchainFeeService,
    InternalTransferService,
    SettlementService,
    TreasuryBalanceService,
    ReserveManagementService,
    SweepService,
    CustodyReconciliationService,
    CustodyAuditService,
    CustodyVisibilityService,
  ],
  exports: [
    CustodyPolicyService,
    AssetRegistryService,
    NetworkRegistryService,
    BlockchainProviderFactory,
    WalletRepository,
    WalletService,
    WalletAddressService,
    DepositAddressService,
    DepositMonitoringService,
    WithdrawalPolicyService,
    WithdrawalOrchestrationService,
    TransactionService,
    TransactionMonitoringService,
    ConfirmationService,
    BlockchainFeeService,
    InternalTransferService,
    SettlementService,
    TreasuryBalanceService,
    ReserveManagementService,
    SweepService,
    CustodyReconciliationService,
    CustodyAuditService,
    CustodyVisibilityService,
  ],
})
export class CustodyModule {}

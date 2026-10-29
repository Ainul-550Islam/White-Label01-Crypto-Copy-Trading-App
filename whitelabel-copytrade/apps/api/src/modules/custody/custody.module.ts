import { Module } from '@nestjs/common';
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
import { WithdrawalDestinationController } from './withdrawal-destination.controller';
import { WithdrawalDestinationPolicyService } from './withdrawal-destination-policy.service';
import { PrismaWithdrawalDestinationRepository } from './withdrawal-destination-policy.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { WithdrawalDestinationAdminController } from './withdrawal-destination-admin.controller';
import { ChainObservationService } from './providers/chain-observation.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    CustodyController,
    WithdrawalDestinationController,
    // GAP-76: the operator audit surface. Read-only, and registered here so the
    // route exists in a running application and not only in its own spec.
    WithdrawalDestinationAdminController,
  ],
  providers: [
    // Batch 03: chain observation gateway for the custody surface.
    // CUSTODY_CHAIN_PROVIDERS_ENABLED=false (default) keeps it entirely
    // refusing; the MetricsRegistry binding drops in only when the
    // observability module's provider graph loads alongside custody.
    ChainObservationService,
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
    // Both are constructed through factories rather than decorated with
    // @Injectable: the policy service takes its store as a constructor PORT, so the
    // cooldown rules never import Prisma and can be tested without a database.
    {
      provide: PrismaWithdrawalDestinationRepository,
      useFactory: (prisma: PrismaService) => new PrismaWithdrawalDestinationRepository(prisma),
      inject: [PrismaService],
    },
    {
      provide: WithdrawalDestinationPolicyService,
      useFactory: (repository: PrismaWithdrawalDestinationRepository) =>
        new WithdrawalDestinationPolicyService(repository),
      inject: [PrismaWithdrawalDestinationRepository],
    },
  ],
  exports: [
    ChainObservationService,
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
    WithdrawalDestinationPolicyService,
  ],
})
export class CustodyModule {}

import { Controller, Get, Post, Body, Query, Param, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { WalletRepository } from './wallet.repository';
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
import { CustodyPolicyService } from './custody-policy.service';
import { AssetRegistryService } from './asset-registry.service';
import { NetworkRegistryService } from './network-registry.service';
import { BlockchainProviderFactory } from './blockchain-provider.factory';
import { CustodyScope } from './custody.types';

@Controller('custody')
export class CustodyController {
  constructor(
    private readonly walletService: WalletService,
    private readonly walletRepository: WalletRepository,
    private readonly walletAddressService: WalletAddressService,
    private readonly depositAddressService: DepositAddressService,
    private readonly depositMonitoringService: DepositMonitoringService,
    private readonly withdrawalPolicyService: WithdrawalPolicyService,
    private readonly withdrawalOrchestrationService: WithdrawalOrchestrationService,
    private readonly transactionService: TransactionService,
    private readonly transactionMonitoringService: TransactionMonitoringService,
    private readonly confirmationService: ConfirmationService,
    private readonly blockchainFeeService: BlockchainFeeService,
    private readonly internalTransferService: InternalTransferService,
    private readonly settlementService: SettlementService,
    private readonly treasuryBalanceService: TreasuryBalanceService,
    private readonly reserveService: ReserveManagementService,
    private readonly sweepService: SweepService,
    private readonly reconciliationService: CustodyReconciliationService,
    private readonly auditService: CustodyAuditService,
    private readonly visibilityService: CustodyVisibilityService,
    private readonly policyService: CustodyPolicyService,
    private readonly assetRegistry: AssetRegistryService,
    private readonly networkRegistry: NetworkRegistryService,
    private readonly providerFactory: BlockchainProviderFactory,
  ) {}

  private getScope(req: any): CustodyScope {
    const scope = req?.user?.custodyScope ?? req?.headers?.['x-custody-scope'] ?? 'TENANT_OWNER';
    return scope as CustodyScope;
  }

  private getTenantId(req: any, bodyTenantId?: string, queryTenantId?: string): string {
    return bodyTenantId ?? queryTenantId ?? req?.user?.tenantId ?? req?.headers?.['x-tenant-id'] ?? 'default-tenant';
  }

  // Wallet endpoints
  @Post('wallets')
  async createWallet(@Request() req: any, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.walletService.createWallet({ tenantId, ...body });
  }

  @Post('wallets/transition')
  async transitionWallet(@Request() req: any, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.walletService.transitionWallet({ tenantId, walletId: body.walletId, toState: body.toState, operatorId: body.operatorId, reason: body.reason, correlationId: body.correlationId });
  }

  @Get('wallets')
  async listWallets(@Request() req: any, @Query() query: any) {
    const tenantId = this.getTenantId(req, query.tenantId);
    return await this.walletService.listWallets({ tenantId, ...query, page: query.page ? parseInt(query.page) : 1, limit: query.limit ? parseInt(query.limit) : 50 });
  }

  @Get('wallets/:walletId')
  async getWallet(@Request() req: any, @Param('walletId') walletId: string, @Query() query: any) {
    const tenantId = this.getTenantId(req, query.tenantId);
    const scope = this.getScope(req);
    await this.visibilityService.assertCanAccessWallet({ tenantId, walletId, scope, clientProfileId: query.clientProfileId, accountId: query.accountId });
    return await this.walletService.getWallet({ tenantId, walletId });
  }

  // Address endpoints
  @Post('addresses')
  async createAddress(@Request() req: any, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.walletAddressService.createAddress({ tenantId, ...body });
  }

  @Get('addresses')
  async listAddresses(@Request() req: any, @Query() query: any) {
    const tenantId = this.getTenantId(req, query.tenantId);
    return await this.walletAddressService.listAddresses({ tenantId, ...query, page: query.page ? parseInt(query.page) : 1, limit: query.limit ? parseInt(query.limit) : 50 });
  }

  @Post('deposit-addresses/get-or-create')
  async getOrCreateDepositAddress(@Request() req: any, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.depositAddressService.getOrCreateDepositAddress({ tenantId, ...body });
  }

  // Deposit monitoring
  @Post('deposits/observe')
  async observeDeposit(@Request() req: any, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.depositMonitoringService.observeDeposit({ tenantId, ...body });
  }

  @Post('deposits/:depositId/confirmations')
  async updateDepositConfirmations(@Request() req: any, @Param('depositId') depositId: string, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.depositMonitoringService.updateDepositConfirmations({ tenantId, depositId, confirmationCount: body.confirmationCount, blockHash: body.blockHash, blockNumber: body.blockNumber, providerReference: body.providerReference });
  }

  @Post('deposits/:depositId/reorg')
  async handleDepositReorg(@Request() req: any, @Param('depositId') depositId: string, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.depositMonitoringService.handleReorg({ tenantId, depositId, reason: body.reason, providerReference: body.providerReference });
  }

  // Withdrawal policy & orchestration
  @Post('withdrawals/evaluate')
  async evaluateWithdrawal(@Request() req: any, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.withdrawalPolicyService.evaluateWithdrawalEligibility({ tenantId, ...body });
  }

  @Post('withdrawals/submit')
  async submitWithdrawal(@Request() req: any, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.withdrawalOrchestrationService.submitWithdrawal({ tenantId, custodyWithdrawalId: body.custodyWithdrawalId, operatorId: body.operatorId, correlationId: body.correlationId });
  }

  // Transaction endpoints
  @Post('transactions')
  async createTransaction(@Request() req: any, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.transactionService.createTransaction({ tenantId, ...body });
  }

  @Post('transactions/transition')
  async transitionTransaction(@Request() req: any, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.transactionService.transitionTransaction({ tenantId, transactionId: body.transactionId, toState: body.toState, blockHash: body.blockHash, blockNumber: body.blockNumber, confirmationCount: body.confirmationCount, actualFee: body.actualFee, failureReason: body.failureReason, operatorId: body.operatorId, correlationId: body.correlationId });
  }

  @Get('transactions')
  async listTransactions(@Request() req: any, @Query() query: any) {
    const tenantId = this.getTenantId(req, query.tenantId);
    return await this.transactionService.listTransactions({ tenantId, ...query, page: query.page ? parseInt(query.page) : 1, limit: query.limit ? parseInt(query.limit) : 50 });
  }

  @Get('transactions/:transactionId')
  async getTransaction(@Request() req: any, @Param('transactionId') transactionId: string, @Query() query: any) {
    const tenantId = this.getTenantId(req, query.tenantId);
    return await this.transactionService.getTransaction({ tenantId, transactionId });
  }

  @Post('transactions/:transactionId/poll')
  async pollTransaction(@Request() req: any, @Param('transactionId') transactionId: string, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.transactionMonitoringService.pollTransaction({ tenantId, transactionId });
  }

  @Post('transactions/:transactionId/reorg')
  async handleTransactionReorg(@Request() req: any, @Param('transactionId') transactionId: string, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.transactionMonitoringService.handleReorg({ tenantId, transactionId, reason: body.reason, newBlockHash: body.newBlockHash, newBlockNumber: body.newBlockNumber });
  }

  // Confirmation
  @Post('confirmations/observe')
  async observeConfirmation(@Request() req: any, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.confirmationService.observeConfirmation({ tenantId, ...body });
  }

  @Get('confirmations/:transactionId')
  async getConfirmations(@Request() req: any, @Param('transactionId') transactionId: string, @Query() query: any) {
    const tenantId = this.getTenantId(req, query.tenantId);
    return await this.confirmationService.getConfirmations({ tenantId, transactionId });
  }

  // Fees
  @Post('fees/estimate')
  async estimateFee(@Request() req: any, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.blockchainFeeService.estimateFee({ tenantId, ...body });
  }

  @Get('fees/:transactionId')
  async getActualFee(@Request() req: any, @Param('transactionId') transactionId: string, @Query() query: any) {
    const tenantId = this.getTenantId(req, query.tenantId);
    return await this.blockchainFeeService.getActualFee({ tenantId, transactionId });
  }

  // Internal transfers
  @Post('internal-transfers')
  async createInternalTransfer(@Request() req: any, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.internalTransferService.createInternalTransfer({ tenantId, ...body });
  }

  @Post('internal-transfers/approve')
  async approveInternalTransfer(@Request() req: any, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.internalTransferService.approveInternalTransfer({ tenantId, ...body });
  }

  @Post('internal-transfers/settle')
  async settleInternalTransfer(@Request() req: any, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.internalTransferService.settleInternalTransfer({ tenantId, ...body });
  }

  @Get('internal-transfers')
  async listInternalTransfers(@Request() req: any, @Query() query: any) {
    const tenantId = this.getTenantId(req, query.tenantId);
    return await this.internalTransferService.listInternalTransfers({ tenantId, ...query, page: query.page ? parseInt(query.page) : 1, limit: query.limit ? parseInt(query.limit) : 50 });
  }

  // Settlement
  @Post('settlement/deposit/finalize')
  async finalizeDepositSettlement(@Request() req: any, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.settlementService.finalizeDepositSettlement({ tenantId, depositId: body.depositId, operatorId: body.operatorId, correlationId: body.correlationId });
  }

  @Post('settlement/withdrawal/finalize')
  async finalizeWithdrawalSettlement(@Request() req: any, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.settlementService.finalizeWithdrawalSettlement({ tenantId, custodyWithdrawalId: body.custodyWithdrawalId, operatorId: body.operatorId, correlationId: body.correlationId });
  }

  // Treasury balances
  @Get('balances/wallet/:walletId')
  async getWalletBalance(@Request() req: any, @Param('walletId') walletId: string, @Query() query: any) {
    const tenantId = this.getTenantId(req, query.tenantId);
    return await this.treasuryBalanceService.getWalletBalance({ tenantId, walletId, assetId: query.assetId, networkId: query.networkId });
  }

  @Get('balances/treasury')
  async getTreasuryBalance(@Request() req: any, @Query() query: any) {
    const tenantId = this.getTenantId(req, query.tenantId);
    return await this.treasuryBalanceService.getTreasuryBalance({ tenantId, assetId: query.assetId, networkId: query.networkId });
  }

  // Reserves
  @Post('reserves')
  async createReserve(@Request() req: any, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.reserveService.createReserve({ tenantId, ...body });
  }

  @Get('reserves')
  async listReserves(@Request() req: any, @Query() query: any) {
    const tenantId = this.getTenantId(req, query.tenantId);
    return await this.reserveService.listReserves({ tenantId, ...query, page: query.page ? parseInt(query.page) : 1, limit: query.limit ? parseInt(query.limit) : 50 });
  }

  @Post('reserves/evaluate')
  async evaluateReserve(@Request() req: any, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.reserveService.evaluateReserveSufficiency({ tenantId, ...body });
  }

  // Sweeps
  @Post('sweeps')
  async createSweep(@Request() req: any, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.sweepService.createSweep({ tenantId, ...body });
  }

  @Post('sweeps/approve')
  async approveSweep(@Request() req: any, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.sweepService.approveSweep({ tenantId, ...body });
  }

  @Post('sweeps/execute')
  async executeSweep(@Request() req: any, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.sweepService.executeSweep({ tenantId, ...body });
  }

  @Get('sweeps')
  async listSweeps(@Request() req: any, @Query() query: any) {
    const tenantId = this.getTenantId(req, query.tenantId);
    return await this.sweepService.listSweeps({ tenantId, ...query, page: query.page ? parseInt(query.page) : 1, limit: query.limit ? parseInt(query.limit) : 50 });
  }

  // Reconciliation
  @Post('reconciliation/run')
  async runReconciliation(@Request() req: any, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.reconciliationService.runReconciliation({ tenantId, ...body });
  }

  @Get('reconciliation/findings')
  async listFindings(@Request() req: any, @Query() query: any) {
    const tenantId = this.getTenantId(req, query.tenantId);
    return await this.reconciliationService.listFindings({ tenantId, ...query, resolved: query.resolved ? query.resolved === 'true' : undefined, page: query.page ? parseInt(query.page) : 1, limit: query.limit ? parseInt(query.limit) : 50 });
  }

  @Post('reconciliation/resolve')
  async resolveFinding(@Request() req: any, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.reconciliationService.resolveFinding({ tenantId, ...body });
  }

  // Audit
  @Get('audits')
  async listAudits(@Request() req: any, @Query() query: any) {
    const tenantId = this.getTenantId(req, query.tenantId);
    return await this.auditService.listAudits({ tenantId, ...query, fromDate: query.fromDate ? new Date(query.fromDate) : undefined, toDate: query.toDate ? new Date(query.toDate) : undefined, page: query.page ? parseInt(query.page) : 1, limit: query.limit ? parseInt(query.limit) : 50 });
  }

  @Post('audits/export')
  async exportAudits(@Request() req: any, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.auditService.exportAudits({ tenantId, fromDate: new Date(body.fromDate), toDate: new Date(body.toDate), format: body.format });
  }

  // Policy & registries
  @Get('policy')
  async getPolicy(@Request() req: any, @Query() query: any) {
    const tenantId = this.getTenantId(req, query.tenantId);
    return await this.policyService.resolvePolicy({ tenantId, walletId: query.walletId, accountId: query.accountId });
  }

  @Get('assets')
  async listAssets(@Request() req: any, @Query() query: any) {
    const tenantId = this.getTenantId(req, query.tenantId);
    return await this.assetRegistry.listAssets({ tenantId, ...query, page: query.page ? parseInt(query.page) : 1, limit: query.limit ? parseInt(query.limit) : 50 });
  }

  @Get('networks')
  async listNetworks(@Request() req: any, @Query() query: any) {
    const tenantId = this.getTenantId(req, query.tenantId);
    return await this.networkRegistry.listNetworks({ tenantId, ...query, page: query.page ? parseInt(query.page) : 1, limit: query.limit ? parseInt(query.limit) : 50 });
  }

  @Get('providers/health')
  async getProvidersHealth(@Request() req: any, @Query() query: any) {
    const tenantId = this.getTenantId(req, query.tenantId);
    return await this.providerFactory.getProvidersHealth({ tenantId });
  }
}

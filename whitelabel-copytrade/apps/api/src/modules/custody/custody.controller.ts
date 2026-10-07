// # Exposes customer withdrawal request and admin approval/rejection endpoints
import { Controller, Get, Post, Body, Query, Param, UseGuards, Request, BadRequestException, ForbiddenException } from '@nestjs/common';
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
import { Permission, hasPermission } from '@wlct/shared-types';
import { isPlatformPrincipal } from '../../common/guards/request-principal';
import { PlatformOnly, RequireAnyPermission } from '../../common/decorators/permissions.decorator';
import { limitParam, pageParam } from '../../common/dto/pagination-params';

/**
 * Read-only custody oversight: staff-only permissions (platform, finance, tenant
 * administration, compliance). report:read and reconciliation:read are not used
 * because the system TRADER / FOLLOWER roles hold them for their own data.
 */
const CUSTODY_READ = [Permission.PLATFORM_MANAGE, Permission.PAYOUT_MANAGE, Permission.TENANT_UPDATE, Permission.COMPLIANCE_READ] as const;

/**
 * Custody is an operator surface: wallets, addresses, withdrawals, settlement,
 * sweeps, reserves and reconciliation move or attest to real funds. Nothing
 * here is scoped to an individual customer, so no customer role may call it;
 * customers ask for deposits and withdrawals through client-lifecycle funding
 * requests, which operators review.
 *
 * - default (every mutation): platform staff or finance (payout:manage)
 * - reads and audit export: additionally tenant administration / compliance (oversight)
 * - chain ingestion (observe, confirmations, reorg, poll): platform only, since
 *   a tenant user must never be able to fabricate an on-chain deposit
 * - reconciliation run / resolve: reconciliation:trigger / reconciliation:resolve
 */
@Controller('custody')
@RequireAnyPermission(Permission.PLATFORM_MANAGE, Permission.PAYOUT_MANAGE)
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

  /**
   * The custody scope comes only from the authenticated principal (a client-supplied
   * `x-custody-scope` header is ignored - Phase 3 fix).
   *
   * Round 7: it is DERIVED from the principal's permissions. No token issuer sets a
   * `custodyScope` claim, so the previous claim-only lookup resolved every caller -
   * tenant owners and finance included - to CLIENT, whose wallet check only passed
   * because it compared the wallet with itself. Derivation (first match wins):
   *   platform principal or platform:manage -> PLATFORM_ADMIN
   *   payout:manage (finance)              -> TREASURY_OPERATOR
   *   tenant:update (tenant administration) -> TENANT_OWNER
   *   compliance:read                      -> COMPLIANCE_REVIEWER
   *   anything else                        -> CLIENT (least privilege)
   * An explicit `custodyScope` claim may only NARROW that scope (to CLIENT, or the same
   * scope); it can never raise a principal above what its permissions grant.
   */
  private getScope(req: any): CustodyScope {
    const derived = this.derivedScope(req);
    const claimed = req?.user?.custodyScope;
    if (claimed === CustodyScope.CLIENT || claimed === derived) return claimed as CustodyScope;
    return derived;
  }

  private derivedScope(req: any): CustodyScope {
    const permissions: string[] = Array.isArray(req?.user?.permissions) ? req.user.permissions : [];
    if (isPlatformPrincipal(req) || hasPermission(permissions, Permission.PLATFORM_MANAGE)) return CustodyScope.PLATFORM_ADMIN;
    if (hasPermission(permissions, Permission.PAYOUT_MANAGE)) return CustodyScope.TREASURY_OPERATOR;
    if (hasPermission(permissions, Permission.TENANT_UPDATE)) return CustodyScope.TENANT_OWNER;
    if (hasPermission(permissions, Permission.COMPLIANCE_READ)) return CustodyScope.COMPLIANCE_REVIEWER;
    return CustodyScope.CLIENT;
  }

  /**
   * Phase 3 security fix: the tenant is the authenticated principal's tenant.
   * A tenantId in the body/query used to take precedence (any caller could
   * address another tenant's wallets) with a 'default-tenant' fallback; now a
   * mismatching tenantId is refused and a missing tenant context is an error.
   */
  private getTenantId(req: any, bodyTenantId?: string, queryTenantId?: string): string {
    const authTenant: string | undefined = req?.user?.tenantId;
    if (!authTenant) throw new ForbiddenException('Tenant context required');
    const requested = bodyTenantId ?? queryTenantId;
    if (requested && requested !== authTenant) throw new ForbiddenException('Cross-tenant custody access refused');
    return authTenant;
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

  @RequireAnyPermission(...CUSTODY_READ)
  @Get('wallets')
  async listWallets(@Request() req: any, @Query() query: any) {
    const tenantId = this.getTenantId(req, query.tenantId);
    return await this.walletService.listWallets({ tenantId, ...query, page: pageParam(query.page), limit: limitParam(query.limit, 50) });
  }

  @RequireAnyPermission(...CUSTODY_READ)
  @Get('wallets/:walletId')
  async getWallet(@Request() req: any, @Param('walletId') walletId: string, @Query() query: any) {
    const tenantId = this.getTenantId(req, query.tenantId);
    const scope = this.getScope(req);
    // No client-supplied clientProfileId/accountId: on this staff-only surface they would let the
    // caller name the owner it claims to be. A CLIENT-scoped principal is therefore refused.
    await this.visibilityService.assertCanAccessWallet({ tenantId, walletId, scope });
    return await this.walletService.getWallet({ tenantId, walletId });
  }

  // Address endpoints
  @Post('addresses')
  async createAddress(@Request() req: any, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.walletAddressService.createAddress({ tenantId, ...body });
  }

  @RequireAnyPermission(...CUSTODY_READ)
  @Get('addresses')
  async listAddresses(@Request() req: any, @Query() query: any) {
    const tenantId = this.getTenantId(req, query.tenantId);
    return await this.walletAddressService.listAddresses({ tenantId, ...query, page: pageParam(query.page), limit: limitParam(query.limit, 50) });
  }

  @Post('deposit-addresses/get-or-create')
  async getOrCreateDepositAddress(@Request() req: any, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.depositAddressService.getOrCreateDepositAddress({ tenantId, ...body });
  }

  // Deposit monitoring
  @PlatformOnly()
  @RequireAnyPermission(Permission.PLATFORM_MANAGE)
  @Post('deposits/observe')
  async observeDeposit(@Request() req: any, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.depositMonitoringService.observeDeposit({ tenantId, ...body });
  }

  @PlatformOnly()
  @RequireAnyPermission(Permission.PLATFORM_MANAGE)
  @Post('deposits/:depositId/confirmations')
  async updateDepositConfirmations(@Request() req: any, @Param('depositId') depositId: string, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.depositMonitoringService.updateDepositConfirmations({ tenantId, depositId, confirmationCount: body.confirmationCount, blockHash: body.blockHash, blockNumber: body.blockNumber, providerReference: body.providerReference });
  }

  @PlatformOnly()
  @RequireAnyPermission(Permission.PLATFORM_MANAGE)
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

  @RequireAnyPermission(...CUSTODY_READ)
  @Get('transactions')
  async listTransactions(@Request() req: any, @Query() query: any) {
    const tenantId = this.getTenantId(req, query.tenantId);
    return await this.transactionService.listTransactions({ tenantId, ...query, page: pageParam(query.page), limit: limitParam(query.limit, 50) });
  }

  @RequireAnyPermission(...CUSTODY_READ)
  @Get('transactions/:transactionId')
  async getTransaction(@Request() req: any, @Param('transactionId') transactionId: string, @Query() query: any) {
    const tenantId = this.getTenantId(req, query.tenantId);
    return await this.transactionService.getTransaction({ tenantId, transactionId });
  }

  @PlatformOnly()
  @RequireAnyPermission(Permission.PLATFORM_MANAGE)
  @Post('transactions/:transactionId/poll')
  async pollTransaction(@Request() req: any, @Param('transactionId') transactionId: string, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.transactionMonitoringService.pollTransaction({ tenantId, transactionId });
  }

  @PlatformOnly()
  @RequireAnyPermission(Permission.PLATFORM_MANAGE)
  @Post('transactions/:transactionId/reorg')
  async handleTransactionReorg(@Request() req: any, @Param('transactionId') transactionId: string, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.transactionMonitoringService.handleReorg({ tenantId, transactionId, reason: body.reason, newBlockHash: body.newBlockHash, newBlockNumber: body.newBlockNumber });
  }

  // Confirmation
  @PlatformOnly()
  @RequireAnyPermission(Permission.PLATFORM_MANAGE)
  @Post('confirmations/observe')
  async observeConfirmation(@Request() req: any, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.confirmationService.observeConfirmation({ tenantId, ...body });
  }

  @RequireAnyPermission(...CUSTODY_READ)
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

  @RequireAnyPermission(...CUSTODY_READ)
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

  @RequireAnyPermission(...CUSTODY_READ)
  @Get('internal-transfers')
  async listInternalTransfers(@Request() req: any, @Query() query: any) {
    const tenantId = this.getTenantId(req, query.tenantId);
    return await this.internalTransferService.listInternalTransfers({ tenantId, ...query, page: pageParam(query.page), limit: limitParam(query.limit, 50) });
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
  @RequireAnyPermission(...CUSTODY_READ)
  @Get('balances/wallet/:walletId')
  async getWalletBalance(@Request() req: any, @Param('walletId') walletId: string, @Query() query: any) {
    const tenantId = this.getTenantId(req, query.tenantId);
    return await this.treasuryBalanceService.getWalletBalance({ tenantId, walletId, assetId: query.assetId, networkId: query.networkId });
  }

  @RequireAnyPermission(...CUSTODY_READ)
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

  @RequireAnyPermission(...CUSTODY_READ)
  @Get('reserves')
  async listReserves(@Request() req: any, @Query() query: any) {
    const tenantId = this.getTenantId(req, query.tenantId);
    return await this.reserveService.listReserves({ tenantId, ...query, page: pageParam(query.page), limit: limitParam(query.limit, 50) });
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

  @RequireAnyPermission(...CUSTODY_READ)
  @Get('sweeps')
  async listSweeps(@Request() req: any, @Query() query: any) {
    const tenantId = this.getTenantId(req, query.tenantId);
    return await this.sweepService.listSweeps({ tenantId, ...query, page: pageParam(query.page), limit: limitParam(query.limit, 50) });
  }

  // Reconciliation
  @RequireAnyPermission(Permission.PLATFORM_MANAGE, Permission.RECONCILIATION_TRIGGER)
  @Post('reconciliation/run')
  async runReconciliation(@Request() req: any, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.reconciliationService.runReconciliation({ tenantId, ...body });
  }

  @RequireAnyPermission(...CUSTODY_READ)
  @Get('reconciliation/findings')
  async listFindings(@Request() req: any, @Query() query: any) {
    const tenantId = this.getTenantId(req, query.tenantId);
    return await this.reconciliationService.listFindings({ tenantId, ...query, resolved: query.resolved ? query.resolved === 'true' : undefined, page: pageParam(query.page), limit: limitParam(query.limit, 50) });
  }

  @RequireAnyPermission(Permission.PLATFORM_MANAGE, Permission.RECONCILIATION_RESOLVE)
  @Post('reconciliation/resolve')
  async resolveFinding(@Request() req: any, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.reconciliationService.resolveFinding({ tenantId, ...body });
  }

  // Audit
  @RequireAnyPermission(...CUSTODY_READ)
  @Get('audits')
  async listAudits(@Request() req: any, @Query() query: any) {
    const tenantId = this.getTenantId(req, query.tenantId);
    return await this.auditService.listAudits({ tenantId, ...query, fromDate: query.fromDate ? new Date(query.fromDate) : undefined, toDate: query.toDate ? new Date(query.toDate) : undefined, page: pageParam(query.page), limit: limitParam(query.limit, 50) });
  }

  @RequireAnyPermission(...CUSTODY_READ)
  @Post('audits/export')
  async exportAudits(@Request() req: any, @Body() body: any) {
    const tenantId = this.getTenantId(req, body.tenantId);
    return await this.auditService.exportAudits({ tenantId, fromDate: new Date(body.fromDate), toDate: new Date(body.toDate), format: body.format });
  }

  // Policy & registries
  @RequireAnyPermission(...CUSTODY_READ)
  @Get('policy')
  async getPolicy(@Request() req: any, @Query() query: any) {
    const tenantId = this.getTenantId(req, query.tenantId);
    return await this.policyService.resolvePolicy({ tenantId, walletId: query.walletId, accountId: query.accountId });
  }

  @RequireAnyPermission(...CUSTODY_READ)
  @Get('assets')
  async listAssets(@Request() req: any, @Query() query: any) {
    const tenantId = this.getTenantId(req, query.tenantId);
    return await this.assetRegistry.listAssets({ tenantId, ...query, page: pageParam(query.page), limit: limitParam(query.limit, 50) });
  }

  @RequireAnyPermission(...CUSTODY_READ)
  @Get('networks')
  async listNetworks(@Request() req: any, @Query() query: any) {
    const tenantId = this.getTenantId(req, query.tenantId);
    return await this.networkRegistry.listNetworks({ tenantId, ...query, page: pageParam(query.page), limit: limitParam(query.limit, 50) });
  }

  @RequireAnyPermission(...CUSTODY_READ)
  @Get('providers/health')
  async getProvidersHealth(@Request() req: any, @Query() query: any) {
    const tenantId = this.getTenantId(req, query.tenantId);
    return await this.providerFactory.getProvidersHealth({ tenantId });
  }
}

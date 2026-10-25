// # Responsibility: evaluate real tenant/account, allowlist, balance, reserve and maintenance evidence; unwired MFA/approval evidence or failed required reads never authorize a withdrawal.
import { Injectable } from '@nestjs/common';
import { type CustodyWallet, type InstitutionalAccount } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CustodyPolicyService } from './custody-policy.service';
import { AssetRegistryService } from './asset-registry.service';
import { NetworkRegistryService } from './network-registry.service';
import { TreasuryBalanceService } from './treasury-balance.service';
import { ReserveManagementService } from './reserve-management.service';
import { cmp, isValidDecimal } from './custody.types';

export interface WithdrawalEligibilityResult {
  eligible: boolean;
  blockingReasons: string[];
  checks: Array<{ check: string; passed: boolean; reason?: string }>;
}

@Injectable()
export class WithdrawalPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly custodyPolicyService: CustodyPolicyService,
    private readonly assetRegistry: AssetRegistryService,
    private readonly networkRegistry: NetworkRegistryService,
    private readonly treasuryBalanceService: TreasuryBalanceService,
    private readonly reserveService: ReserveManagementService,
  ) {}

  async evaluateWithdrawalEligibility(params: {
    tenantId: string; accountId?: string | null; walletId?: string | null; assetId: string; networkId: string;
    amount: string; destinationAddress: string; operatorId?: string | null;
  }): Promise<WithdrawalEligibilityResult> {
    const { tenantId, accountId = null, walletId = null, assetId, networkId, amount, destinationAddress } = params;
    const policy = await this.custodyPolicyService.resolvePolicy({ tenantId, walletId: walletId ?? undefined, accountId: accountId ?? undefined });
    const checks: WithdrawalEligibilityResult['checks'] = [];
    const addCheck = (check: string, passed: boolean, reason?: string): void => { checks.push({ check, passed, reason: passed ? undefined : reason ?? 'Required evidence unavailable' }); };
    addCheck('assetNetworkExplicit', Boolean(assetId && networkId), 'Asset and network must be explicit');
    let validAmount = false;
    try { validAmount = isValidDecimal(amount) && cmp(amount, '0') > 0; } catch { validAmount = false; }
    addCheck('positiveAmount', validAmount, 'Amount must be a positive supported-precision decimal');
    try { addCheck('assetSupported', await this.assetRegistry.isAssetSupported({ assetId, networkId }), 'Unsupported registered asset/network'); }
    catch { addCheck('assetSupported', false, 'Required asset evidence unavailable'); }
    try { addCheck('networkSupported', await this.networkRegistry.isNetworkSupported({ networkId }), 'Unsupported registered network'); }
    catch { addCheck('networkSupported', false, 'Required network evidence unavailable'); }

    let wallet: CustodyWallet | null = null;
    try {
      wallet = walletId ? await this.prisma.custodyWallet.findFirst({ where: { id: walletId, tenantId } }) : null;
      const matched = wallet !== null && wallet.state === 'ACTIVE' && wallet.isActive && wallet.assetId === assetId && wallet.networkId === networkId
        && (accountId === null || wallet.accountId === accountId);
      addCheck('walletActive', matched, 'Active tenant/account wallet must match the requested asset/network');
    } catch { addCheck('walletActive', false, 'Required wallet evidence unavailable'); }
    const effectiveAccountId = accountId ?? wallet?.accountId ?? null;
    let account: InstitutionalAccount | null = null;
    try {
      account = effectiveAccountId ? await this.prisma.institutionalAccount.findFirst({ where: { id: effectiveAccountId, tenantId } }) : null;
      addCheck('clientAccountActive', account !== null && account.state === 'ACTIVE' && account.isWithdrawalEnabled && account.deletedAt === null, 'Active tenant-bound account evidence is required');
      if (account) {
        const restrictions = await this.prisma.accountRestriction.findMany({ where: { tenantId, accountId: account.id, status: 'ACTIVE',
          restrictionType: { in: ['NO_WITHDRAWAL', 'ACCOUNT_LOCKED', 'COMPLIANCE_HOLD', 'SECURITY_HOLD', 'RISK_HOLD', 'OPERATIONAL_HOLD'] } } });
        addCheck('noWithdrawalRestriction', restrictions.length === 0, `Blocking restrictions: ${restrictions.map((row) => row.restrictionType).join(',')}`);
      } else addCheck('noWithdrawalRestriction', false, 'Restriction evidence unavailable without a matching account');
    } catch {
      addCheck('clientAccountEvidence', false, 'Required account/restriction evidence unavailable');
    }
    // Only explicit affirmative persisted status is evidence. Missing/unrecognized text is not a clearance.
    addCheck('complianceAllows', !policy.approvalPrerequisites.withdrawalRequiresCompliance || account?.complianceStatus === 'CLEAR',
      'Required affirmative compliance clearance unavailable');
    addCheck('riskAllows', !policy.approvalPrerequisites.withdrawalRequiresRisk || account?.riskStatus === 'CLEAR',
      'Required affirmative risk clearance unavailable');
    addCheck('securityMfa', !policy.approvalPrerequisites.withdrawalRequiresSecurity,
      'Authoritative session-bound Security/MFA evidence adapter is not configured');

    if (policy.addressAllowlisting.requireAllowlist) {
      try {
        const destination = await this.prisma.custodyWalletAddress.findFirst({ where: { tenantId, address: destinationAddress,
          assetId, networkId, status: 'ACTIVE', ...(policy.addressAllowlisting.verificationRequired ? { verified: true } : {}) } });
        addCheck('destinationAllowlisted', destination !== null, 'Required verified destination allowlist evidence unavailable');
      } catch { addCheck('destinationAllowlisted', false, 'Required destination allowlist read failed'); }
    } else addCheck('destinationAllowlisted', true);

    try {
      const balance = walletId && validAmount ? await this.treasuryBalanceService.getWalletBalance({ tenantId, walletId, assetId, networkId }) : null;
      addCheck('sufficientBalance', balance !== null && balance.dataCompleteness === 'PROVIDER_DERIVED' && balance.walletId === walletId
        && balance.assetId === assetId && balance.networkId === networkId && Boolean(balance.sourceReference)
        && balance.available !== null && isValidDecimal(balance.available) && cmp(balance.available, amount) >= 0,
      'Complete authoritative provider balance is unavailable or insufficient');
    } catch { addCheck('sufficientBalance', false, 'Required authoritative balance check failed'); }
    try {
      const reserve = walletId && validAmount ? await this.reserveService.evaluateReserveSufficiency({ tenantId, walletId, assetId, networkId, requestedAmount: amount }) : null;
      addCheck('reservePolicy', reserve !== null && reserve.sufficient && reserve.dataCompleteness === 'PROVIDER_DERIVED' && reserve.availableAfterReserve !== null,
        'Required authoritative reserve evidence unavailable or insufficient');
    } catch { addCheck('reservePolicy', false, 'Required reserve check failed'); }
    // The input has no verified approval-workflow reference; an operator id or internally requested state cannot substitute for it.
    addCheck('approvalExists', false, 'Authoritative linked approval evidence adapter is not configured');

    try {
      const threshold = policy.withdrawalLimits.maxSingleWithdrawal;
      addCheck('singleWithdrawalLimit', validAmount && (threshold === null || threshold === undefined || (isValidDecimal(threshold) && cmp(amount, threshold) <= 0)),
        'Single-withdrawal limit evidence invalid or exceeded');
      const maxPending = policy.withdrawalLimits.maxPendingWithdrawals;
      const pending = await this.prisma.custodyWithdrawal.count({ where: { tenantId, ...(walletId ? { walletId } : {}),
        ...(effectiveAccountId ? { accountId: effectiveAccountId } : {}), state: { in: ['REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'QUEUED', 'SUBMITTED', 'CONFIRMING'] } } });
      addCheck('pendingWithdrawalLimit', Number.isSafeInteger(maxPending) && maxPending > 0 && pending < maxPending,
        'Pending-withdrawal limit invalid or reached');
      // No unimplemented configured daily limit/cooldown may be treated as an evaluated pass.
      addCheck('dailyWithdrawalLimit', policy.withdrawalLimits.maxDailyWithdrawal === null || policy.withdrawalLimits.maxDailyWithdrawal === undefined,
        'Configured daily-withdrawal aggregate evidence adapter is not configured');
      addCheck('withdrawalCooldown', policy.cooldownRequirements.withdrawalCooldownMs === null || policy.cooldownRequirements.withdrawalCooldownMs === undefined,
        'Configured withdrawal cooldown evidence adapter is not configured');
      addCheck('newAddressCooldown', policy.cooldownRequirements.newAddressCooldownMs === null || policy.cooldownRequirements.newAddressCooldownMs === undefined,
        'Configured new-address cooldown evidence adapter is not configured');
    } catch { addCheck('withdrawalLimits', false, 'Required withdrawal-limit read failed'); }

    try {
      const maintenance = await this.prisma.operationalMaintenanceWindow.findFirst({ where: { state: 'ACTIVE',
        OR: [{ tenantId }, { tenantId: null }], scope: { in: ['PLATFORM', 'TENANT', 'TRADING_CAPABILITY'] } } });
      addCheck('noMaintenanceRestriction', !policy.maintenanceRestrictions.blockWithdrawalsDuringMaintenance || maintenance === null,
        'Applicable operational maintenance is active');
    } catch { addCheck('noMaintenanceRestriction', false, 'Required operational maintenance evidence unavailable'); }
    const blockingReasons = checks.filter((check) => !check.passed).map((check) => check.reason ?? `${check.check}: required evidence unavailable`);
    return { eligible: blockingReasons.length === 0, blockingReasons, checks };
  }
}

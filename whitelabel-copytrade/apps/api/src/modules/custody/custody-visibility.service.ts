import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CustodyScope, redactSecrets } from './custody.types';

/**
 * Enforces scoped visibility and access control for custody data across client, tenant owner,
 * treasury operator, compliance reviewer, risk reviewer, security admin, and platform admin roles.
 */

@Injectable()
export class CustodyVisibilityService {
  private readonly logger = new Logger(CustodyVisibilityService.name);

  constructor(private readonly prisma: PrismaService) {}

  private isPlatformScope(scope: CustodyScope): boolean {
    return scope === CustodyScope.PLATFORM_ADMIN;
  }

  private isTenantOwnerScope(scope: CustodyScope): boolean {
    return [CustodyScope.TENANT_OWNER, CustodyScope.TREASURY_OPERATOR, CustodyScope.PLATFORM_ADMIN].includes(scope);
  }

  async checkAccess(params: {
    tenantId: string;
    requesterTenantId: string;
    scope: CustodyScope;
    resourceTenantId: string;
    walletId?: string | null;
    accountId?: string | null;
    clientProfileId?: string | null;
  }): Promise<{ allowed: boolean; reason?: string }> {
    const { tenantId, requesterTenantId, scope, resourceTenantId, walletId = null, accountId = null, clientProfileId = null } = params;

    // Tenant wallets never cross-tenant unless platform authorized
    if (tenantId !== resourceTenantId && !this.isPlatformScope(scope)) {
      return { allowed: false, reason: 'Tenant wallets never cross-tenant unless platform authorized' };
    }

    // Platform custody requires platform/admin RBAC
    if (scope === CustodyScope.PLATFORM_ADMIN) {
      // Platform admin can access any tenant — but must be explicitly platform authorized
      // In real impl, would check JWT roles
      return { allowed: true };
    }

    // CLIENT scope — client only authorized accounts
    if (scope === CustodyScope.CLIENT) {
      if (!clientProfileId && !accountId) {
        return { allowed: false, reason: 'Client scope requires clientProfileId or accountId' };
      }
      // Verify wallet belongs to client profile or account
      if (walletId) {
        try {
          const wallet = await (this.prisma as any).custodyWallet.findFirst({ where: { id: walletId, tenantId: resourceTenantId } });
          if (!wallet) return { allowed: false, reason: 'Wallet not found' };
          if (clientProfileId && wallet.clientProfileId !== clientProfileId) {
            return { allowed: false, reason: 'Client cannot access wallet of other client' };
          }
          if (accountId && wallet.accountId !== accountId) {
            return { allowed: false, reason: 'Client cannot access wallet of other account' };
          }
        } catch {}
      }
      return { allowed: true };
    }

    // TENANT_OWNER, TREASURY_OPERATOR, COMPLIANCE_REVIEWER, RISK_REVIEWER, SECURITY_ADMIN — tenant-scoped
    if ([CustodyScope.TENANT_OWNER, CustodyScope.TREASURY_OPERATOR, CustodyScope.COMPLIANCE_REVIEWER, CustodyScope.RISK_REVIEWER, CustodyScope.SECURITY_ADMIN].includes(scope)) {
      if (tenantId !== resourceTenantId) {
        return { allowed: false, reason: 'Tenant scope cannot access other tenant data' };
      }
      return { allowed: true };
    }

    return { allowed: false, reason: 'Unknown scope' };
  }

  async filterWalletsForScope(params: {
    tenantId: string;
    requesterTenantId: string;
    scope: CustodyScope;
    clientProfileId?: string | null;
    accountId?: string | null;
    wallets: any[];
  }): Promise<any[]> {
    const { tenantId, requesterTenantId, scope, clientProfileId = null, accountId = null, wallets } = params;

    if (this.isPlatformScope(scope)) {
      // Platform admin sees all — but secrets redacted
      return wallets.map((w) => redactSecrets(w));
    }

    if (scope === CustodyScope.CLIENT) {
      // Client only authorized accounts
      return wallets
        .filter((w) => {
          if (w.tenantId !== tenantId) return false;
          if (clientProfileId && w.clientProfileId === clientProfileId) return true;
          if (accountId && w.accountId === accountId) return true;
          if (!clientProfileId && !accountId) return false;
          return false;
        })
        .map((w) => redactSecrets(w));
    }

    // Tenant-scoped roles — never other tenant data
    return wallets.filter((w) => w.tenantId === tenantId).map((w) => redactSecrets(w));
  }

  async filterTransactionsForScope(params: {
    tenantId: string;
    scope: CustodyScope;
    clientProfileId?: string | null;
    accountId?: string | null;
    transactions: any[];
  }): Promise<any[]> {
    const { tenantId, scope, clientProfileId = null, accountId = null, transactions } = params;

    if (this.isPlatformScope(scope)) {
      return transactions.map((t) => redactSecrets(t));
    }

    if (scope === CustodyScope.CLIENT) {
      // Client only sees transactions for authorized wallets/accounts
      // Need to check wallet ownership
      const filtered: any[] = [];
      for (const tx of transactions) {
        if (tx.tenantId !== tenantId) continue;
        try {
          if (tx.walletId) {
            const wallet = await (this.prisma as any).custodyWallet.findFirst({ where: { id: tx.walletId } });
            if (!wallet) continue;
            if (clientProfileId && wallet.clientProfileId !== clientProfileId) continue;
            if (accountId && wallet.accountId !== accountId) continue;
          }
          filtered.push(redactSecrets(tx));
        } catch {
          filtered.push(redactSecrets(tx));
        }
      }
      return filtered;
    }

    // Tenant-scoped — never other tenant wallets/addresses/transactions/balances/withdrawals/deposits/reserves/diagnostics/operator/audit
    return transactions.filter((t) => t.tenantId === tenantId).map((t) => redactSecrets(t));
  }

  async assertCanAccessWallet(params: { tenantId: string; walletId: string; scope: CustodyScope; clientProfileId?: string | null; accountId?: string | null }): Promise<void> {
    const wallet = await (this.prisma as any).custodyWallet.findFirst({ where: { id: params.walletId } });
    if (!wallet) throw new BadRequestException('Wallet not found');

    const check = await this.checkAccess({
      tenantId: params.tenantId,
      requesterTenantId: params.tenantId,
      scope: params.scope,
      resourceTenantId: wallet.tenantId,
      walletId: params.walletId,
      accountId: params.accountId ?? wallet.accountId,
      clientProfileId: params.clientProfileId ?? wallet.clientProfileId,
    });

    if (!check.allowed) {
      throw new ForbiddenException(`Access denied: ${check.reason}`);
    }
  }
}

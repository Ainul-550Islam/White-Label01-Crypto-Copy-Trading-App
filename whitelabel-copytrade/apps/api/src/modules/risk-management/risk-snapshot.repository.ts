import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RiskSnapshot, RiskState } from './risk-management.types';

/**
 * Risk snapshot repository: immutable/append-only, tenant/user/trader/follower/account scope,
 * timestamp/policy version/exposure/margin/leverage/drawdown/concentration/state/metric values/source timestamps.
 * Prevents duplicate snapshot events where same calculation repeated.
 * Tenant isolation enforced.
 */

@Injectable()
export class RiskManagementSnapshotRepository {
  private readonly logger = new Logger(RiskManagementSnapshotRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async saveSnapshot(snapshot: RiskSnapshot): Promise<{ id: string }> {
    // Dedupe: if same tenant/account/policyVersion/timestamp/metric hash exists, skip
    const existing = await this.prisma.riskManagementSnapshot.findFirst({
      where: {
        tenantId: snapshot.tenantId,
        accountId: snapshot.accountId ?? undefined,
        policyVersion: snapshot.policyVersion,
        capturedAt: { gte: new Date(new Date(snapshot.timestamp).getTime() - 1000), lte: new Date(new Date(snapshot.timestamp).getTime() + 1000) },
      },
    });

    if (existing) {
      // Check if metric values identical (prevent duplicate)
      const existingMetrics = JSON.stringify(existing.exposureJson ?? {});
      const newMetrics = JSON.stringify(snapshot.exposure ?? {});
      if (existingMetrics === newMetrics && existing.policyVersion === snapshot.policyVersion) {
        this.logger.log(`Duplicate snapshot detected for tenant ${snapshot.tenantId} account ${snapshot.accountId} policy ${snapshot.policyVersion}, skipping`);
        return { id: existing.id };
      }
    }

    const created = await this.prisma.riskManagementSnapshot.create({
      data: {
        tenantId: snapshot.tenantId,
        userId: snapshot.userId ?? null,
        traderId: snapshot.traderId ?? null,
        followerId: snapshot.followerId ?? null,
        accountId: snapshot.accountId ?? null,
        strategyId: snapshot.strategyId ?? null,
        policyVersion: snapshot.policyVersion,
        policyDigest: snapshot.policyDigest ?? null,
        state: snapshot.state as any,
        grossExposure: snapshot.exposure?.grossExposure ?? null,
        netExposure: snapshot.exposure?.netExposure ?? null,
        longExposure: snapshot.exposure?.longExposure ?? null,
        shortExposure: snapshot.exposure?.shortExposure ?? null,
        marginUtilization: snapshot.margin?.[0]?.marginUtilizationPercent ?? null,
        leverageGross: snapshot.leverage?.[0]?.grossLeverage ?? null,
        leverageNet: snapshot.leverage?.[0]?.netLeverage ?? null,
        drawdownAbs: snapshot.drawdown?.[0]?.drawdownAbs ?? null,
        drawdownPercent: snapshot.drawdown?.[0]?.drawdownPercent ?? null,
        dailyPnl: snapshot.dailyLoss?.[0]?.dailyPnl ?? null,
        dailyLossBudget: snapshot.dailyLoss?.[0]?.remainingBudget ?? null,
        concentrationJson: snapshot.concentration as any,
        exposureJson: snapshot.exposure as any,
        marginJson: snapshot.margin as any,
        leverageJson: snapshot.leverage as any,
        liquidationJson: snapshot.liquidation as any,
        correlationJson: snapshot.correlation as any,
        varJson: snapshot.var as any,
        stressJson: snapshot.stress as any,
        sourceTimestamps: snapshot.sourceTimestamps as any,
        capturedAt: new Date(snapshot.timestamp),
      },
    });

    return { id: created.id };
  }

  async getLatestSnapshot(params: { tenantId: string; accountId?: string; traderId?: string; followerId?: string; strategyId?: string }): Promise<RiskSnapshot | null> {
    const { tenantId, accountId, traderId, followerId, strategyId } = params;
    const row = await this.prisma.riskManagementSnapshot.findFirst({
      where: {
        tenantId,
        accountId: accountId ?? undefined,
        traderId: traderId ?? undefined,
        followerId: followerId ?? undefined,
        strategyId: strategyId ?? undefined,
      },
      orderBy: { capturedAt: 'desc' },
    });
    if (!row) return null;

    return {
      id: row.id,
      tenantId: row.tenantId,
      userId: row.userId ?? null,
      traderId: row.traderId ?? null,
      followerId: row.followerId ?? null,
      accountId: row.accountId ?? null,
      strategyId: row.strategyId ?? null,
      timestamp: row.capturedAt.toISOString(),
      policyVersion: row.policyVersion,
      policyDigest: row.policyDigest ?? null,
      state: row.state as RiskState,
      exposure: row.exposureJson as any,
      margin: (row.marginJson as any) ?? [],
      leverage: (row.leverageJson as any) ?? [],
      drawdown: [],
      concentration: (row.concentrationJson as any) ?? [],
      liquidation: (row.liquidationJson as any) ?? [],
      dailyLoss: [],
      var: (row.varJson as any) ?? [],
      stress: (row.stressJson as any) ?? [],
      correlation: (row.correlationJson as any) ?? [],
      circuitBreakers: [],
      killSwitch: null,
      metricValues: {},
      sourceTimestamps: (row.sourceTimestamps as any) ?? {},
    };
  }

  async getSnapshotsByTenant(tenantId: string, limit = 50): Promise<any[]> {
    return this.prisma.riskManagementSnapshot.findMany({
      where: { tenantId },
      orderBy: { capturedAt: 'desc' },
      take: limit,
    });
  }

  // High-water mark persistence for drawdown (separate from snapshot, but stored via snapshots table + TenantSetting fallback)

  async getHighWaterMark(params: { tenantId: string; scope: string; scopeId: string }): Promise<{ highWaterMark: string; timestamp: string } | null> {
    const { tenantId, scope, scopeId } = params;
    // Use TenantSetting with key hwm:<scope>:<scopeId> for quick lookup, plus snapshot history
    const key = `risk_hwm:${scope}:${scopeId}`;
    const setting = await this.prisma.tenantSetting.findFirst({
      where: { tenantId, key },
    });
    if (setting?.value && typeof setting.value === 'object') {
      const val = setting.value as any;
      if (val.highWaterMark && val.timestamp) {
        return { highWaterMark: val.highWaterMark, timestamp: val.timestamp };
      }
    }
    // Fallback: latest snapshot drawdown
    const latest = await this.prisma.riskManagementSnapshot.findFirst({
      where: { tenantId, ...(scope === 'TRADER' ? { traderId: scopeId } : scope === 'STRATEGY' ? { strategyId: scopeId } : scope === 'FOLLOWER' ? { followerId: scopeId } : { accountId: scopeId }) },
      orderBy: { capturedAt: 'desc' },
    });
    if (latest?.drawdownAbs) {
      // Not HWM, but we can approximate? Actually drawdown contains HWM? We stored drawdownAbs/percent but not HWM. So we need to search snapshot with HWM in exposureJson?
      // For now return null if not in TenantSetting.
    }
    return null;
  }

  async persistHighWaterMark(params: {
    tenantId: string;
    scope: string;
    scopeId: string;
    highWaterMark: string;
    timestamp: string;
    policyVersion: string;
  }): Promise<void> {
    const { tenantId, scope, scopeId, highWaterMark, timestamp, policyVersion } = params;
    const key = `risk_hwm:${scope}:${scopeId}`;
    await this.prisma.tenantSetting.upsert({
      where: { tenantId_key: { tenantId, key } },
      create: {
        tenantId,
        key,
        value: { highWaterMark, timestamp, policyVersion, scope, scopeId } as any,
        category: 'risk',
        description: `High-water mark for ${scope} ${scopeId}`,
      },
      update: {
        value: { highWaterMark, timestamp, policyVersion, scope, scopeId } as any,
        updatedAt: new Date(),
      },
    });
  }
}

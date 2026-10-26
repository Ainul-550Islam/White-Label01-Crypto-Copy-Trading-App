// # Responsibility: resolves effective-dated tenant/platform fee schedules and atomically publishes immutable versions.
import { Injectable, NotFoundException, ServiceUnavailableException, ConflictException } from '@nestjs/common';
import { Prisma, type FeeScheduleVersion } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { PublishFeeScheduleDto } from './fee-schedule.dto';

@Injectable()
export class FeeScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  async effective(tenantId: string | null, at = new Date()) {
    if (!Number.isFinite(at.getTime())) throw new ConflictException('Invalid schedule date');
    try {
      const tenant = tenantId ? await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } }) : null;
      const effectiveRows: FeeScheduleVersion[] = await this.prisma.feeScheduleVersion.findMany({
        where: { ...(tenant ? { OR: [{ tenantId: tenant.id }, { tenantId: null }] } : { tenantId: null }), effectiveFrom: { lte: at }, AND: [{ OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: at } }] }] },
        orderBy: { version: 'desc' },
      });
      const override = tenant ? effectiveRows.find((row) => row.tenantId === tenant.id) : undefined;
      const platform = effectiveRows.find((row) => row.tenantId === null);
      const selected = override ?? platform;
      if (!selected) throw new ServiceUnavailableException('No platform fee schedule is effective for the requested date');
      return this.publicProjection(selected, override ? 'tenant_override' : 'platform_default');
    } catch (error) {
      if (error instanceof ServiceUnavailableException || error instanceof ConflictException) throw error;
      throw new ServiceUnavailableException('Fee schedule is temporarily unavailable');
    }
  }

  async getPublicSchedule(tenantId: string | null, at = new Date()) {
    const current = await this.effective(tenantId, at);
    const scopeTenant = current.source === 'tenant_override' ? tenantId : null;
    const versions = await this.prisma.feeScheduleVersion.findMany({ where: { tenantId: scopeTenant }, orderBy: { version: 'desc' }, take: 10, select: { version: true, effectiveFrom: true, effectiveUntil: true, managementFeeRate: true, profitShareRate: true, currency: true } });
    return { ...current, versions: versions.map((v) => ({ version: v.version, effectiveFrom: v.effectiveFrom.toISOString(), effectiveUntil: v.effectiveUntil?.toISOString() ?? null, managementFeeRate: v.managementFeeRate, profitShareRate: v.profitShareRate, currency: v.currency })) };
  }

  async publish(input: PublishFeeScheduleDto, actorId: string) {
    const start = new Date(input.effectiveFrom);
    if (!Number.isFinite(start.getTime())) throw new ConflictException('Invalid effectiveFrom');
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const lock = `fee-schedule:${input.tenantId ?? 'platform'}`;
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${lock}))`);
        const previous = await tx.feeScheduleVersion.findFirst({ where: { tenantId: input.tenantId ?? null }, orderBy: { version: 'desc' } });
        if (previous && start <= previous.effectiveFrom) throw new ConflictException('New schedule effectiveFrom must be later than the most recent version start');
        const version = (previous?.version ?? 0) + 1;
        if (previous && previous.effectiveUntil === null) await tx.feeScheduleVersion.update({ where: { id: previous.id }, data: { effectiveUntil: start } });
        return tx.feeScheduleVersion.create({ data: { tenantId: input.tenantId ?? null, version, effectiveFrom: start, managementFeeRate: input.managementFeeRate, profitShareRate: input.profitShareRate, currency: input.currency, publishedBy: actorId } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return { ...this.publicProjection(created, created.tenantId ? 'tenant_override' : 'platform_default'), publishedBy: created.publishedBy };
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      throw new ServiceUnavailableException('Fee schedule could not be published');
    }
  }

  async diff(tenantId: string | null, fromVersion: number, toVersion: number) {
    const [from, to] = await Promise.all([
      this.prisma.feeScheduleVersion.findFirst({ where: { tenantId, version: fromVersion } }),
      this.prisma.feeScheduleVersion.findFirst({ where: { tenantId, version: toVersion } }),
    ]);
    if (!from || !to) throw new NotFoundException('Fee schedule version not found');
    return { fromVersion, toVersion, changes: { managementFeeRate: { from: from.managementFeeRate, to: to.managementFeeRate }, profitShareRate: { from: from.profitShareRate, to: to.profitShareRate }, currency: { from: from.currency, to: to.currency }, effectiveFrom: { from: from.effectiveFrom.toISOString(), to: to.effectiveFrom.toISOString() } } };
  }

  private publicProjection(row: FeeScheduleVersion, source: 'tenant_override' | 'platform_default') {
    return { version: row.version, effectiveFrom: row.effectiveFrom.toISOString(), effectiveUntil: row.effectiveUntil?.toISOString() ?? null, managementFeeRate: row.managementFeeRate, profitShareRate: row.profitShareRate, currency: row.currency, source };
  }
}

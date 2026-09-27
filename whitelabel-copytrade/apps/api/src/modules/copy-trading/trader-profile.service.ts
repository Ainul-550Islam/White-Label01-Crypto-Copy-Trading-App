import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TraderVerificationState, TraderProfile } from './copy-trading.types';
import { randomUUID } from 'crypto';

/**
 * Trader profile and public marketplace metadata: display profile, supported venues, risk profile, verified state, performance references, followers, and safe public statistics.
 * Performance must come from canonical trading data. Never accept client-provided profit/ROI/drawdown/win rate as authoritative.
 */
@Injectable()
export class TraderProfileService {
  private readonly logger = new Logger(TraderProfileService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createProfile(input: { tenantId: string; userId: string; displayName: string; bio?: string | null; avatarUrl?: string | null; supportedVenues?: string[]; supportedSymbols?: string[]; riskProfile?: Record<string, any>; isPublic?: boolean }): Promise<TraderProfile> {
    // Tenant ownership validation - user must belong to tenant
    const user = await this.prisma.user.findFirst({ where: { id: input.userId, tenantId: input.tenantId } });
    if (!user) throw new Error(`User ${input.userId} not found for tenant ${input.tenantId}`);

    // Prevent duplicate profile
    const existing = await (this.prisma as any).traderProfile?.findFirst({ where: { userId: input.userId, tenantId: input.tenantId } });
    if (existing) throw new Error(`Trader profile already exists for user ${input.userId}`);

    const id = randomUUID();
    const now = new Date();

    const data = {
      id,
      tenantId: input.tenantId,
      userId: input.userId,
      displayName: input.displayName,
      bio: input.bio || null,
      avatarUrl: input.avatarUrl || null,
      verificationState: TraderVerificationState.UNVERIFIED,
      supportedVenues: input.supportedVenues || [],
      supportedSymbols: input.supportedSymbols || [],
      riskProfile: input.riskProfile || {},
      isPublic: input.isPublic || false,
      isFeatured: false,
      followerCount: 0,
      totalVolume: '0',
      totalTrades: 0,
      createdAt: now,
      updatedAt: now,
    };

    const created = await (this.prisma as any).traderProfile.create({ data });
    this.logger.log(`Trader profile created id=${created.id} tenant=${input.tenantId} user=${input.userId}`);

    return this.mapToProfile(created);
  }

  async getProfile(tenantId: string, traderId: string): Promise<TraderProfile | null> {
    const profile = await (this.prisma as any).traderProfile?.findFirst({ where: { id: traderId, tenantId, deletedAt: null } });
    return profile ? this.mapToProfile(profile) : null;
  }

  async getProfileByUserId(tenantId: string, userId: string): Promise<TraderProfile | null> {
    const profile = await (this.prisma as any).traderProfile?.findFirst({ where: { userId, tenantId, deletedAt: null } });
    return profile ? this.mapToProfile(profile) : null;
  }

  async listPublicProfiles(tenantId: string, filters?: { isFeatured?: boolean; verificationState?: TraderVerificationState; search?: string; page?: number; limit?: number }): Promise<{ data: TraderProfile[]; total: number }> {
    const page = filters?.page || 1;
    const limit = Math.min(filters?.limit || 20, 100);
    const skip = (page - 1) * limit;

    const where: any = {
      tenantId,
      isPublic: true,
      deletedAt: null,
      ...(filters?.isFeatured !== undefined ? { isFeatured: filters.isFeatured } : {}),
      ...(filters?.verificationState ? { verificationState: filters.verificationState } : {}),
      ...(filters?.search ? { displayName: { contains: filters.search, mode: 'insensitive' } } : {}),
    };

    const [rows, total] = await Promise.all([
      (this.prisma as any).traderProfile?.findMany({ where, orderBy: { followerCount: 'desc' }, skip, take: limit }) || [],
      (this.prisma as any).traderProfile?.count({ where }) || 0,
    ]);

    return { data: rows.map((r: any) => this.mapToProfile(r)), total };
  }

  async listByTenant(tenantId: string, filters?: { userId?: string; verificationState?: TraderVerificationState; page?: number; limit?: number }): Promise<{ data: TraderProfile[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const skip = (page - 1) * limit;
    const where: any = { tenantId, deletedAt: null, ...(filters?.userId ? { userId: filters.userId } : {}), ...(filters?.verificationState ? { verificationState: filters.verificationState } : {}) };
    const [rows, total] = await Promise.all([
      (this.prisma as any).traderProfile?.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }) || [],
      (this.prisma as any).traderProfile?.count({ where }) || 0,
    ]);
    return { data: rows.map((r: any) => this.mapToProfile(r)), total };
  }

  async updateProfile(tenantId: string, traderId: string, updates: { displayName?: string; bio?: string | null; avatarUrl?: string | null; supportedVenues?: string[]; supportedSymbols?: string[]; riskProfile?: Record<string, any>; isPublic?: boolean }): Promise<TraderProfile | null> {
    try {
      const updated = await (this.prisma as any).traderProfile.update({
        where: { id: traderId },
        data: { ...updates, updatedAt: new Date() },
      });
      if (updated.tenantId !== tenantId) return null;
      return this.mapToProfile(updated);
    } catch {
      return null;
    }
  }

  async verifyTrader(tenantId: string, traderId: string, verifierId: string): Promise<TraderProfile | null> {
    try {
      const updated = await (this.prisma as any).traderProfile.update({
        where: { id: traderId },
        data: { verificationState: TraderVerificationState.VERIFIED, verifiedAt: new Date(), verifiedById: verifierId, updatedAt: new Date() },
      });
      if (updated.tenantId !== tenantId) return null;
      this.logger.log(`Trader verified id=${traderId} tenant=${tenantId} by=${verifierId}`);
      return this.mapToProfile(updated);
    } catch {
      return null;
    }
  }

  async incrementFollowerCount(tenantId: string, traderId: string): Promise<void> {
    try {
      await (this.prisma as any).traderProfile.update({ where: { id: traderId }, data: { followerCount: { increment: 1 }, updatedAt: new Date() } });
    } catch {}
  }

  async decrementFollowerCount(tenantId: string, traderId: string): Promise<void> {
    try {
      await (this.prisma as any).traderProfile.update({ where: { id: traderId }, data: { followerCount: { decrement: 1 }, updatedAt: new Date() } });
    } catch {}
  }

  async getSafePublicStatistics(tenantId: string, traderId: string): Promise<{ followerCount: number; totalVolume: string; totalTrades: number; verificationState: TraderVerificationState; isPublic: boolean; supportedVenues: string[]; supportedSymbols: string[] } | null> {
    const profile = await this.getProfile(tenantId, traderId);
    if (!profile) return null;

    // Performance must come from canonical trading data - we fetch from fills/orders
    // For safe public stats, we only return followerCount, totalVolume, totalTrades which are derived from canonical data
    // Never trust client-provided profit/ROI/drawdown/win rate

    // Derive totalVolume and totalTrades from canonical fills if available
    let totalVolume = profile.totalVolume;
    let totalTrades = profile.totalTrades;

    try {
      // Use existing validated trading data - fills
      const fills = await this.prisma.fill.findMany({ where: { order: { tenantId, account: { userId: profile.userId } } }, select: { quantity: true, price: true } });
      if (fills.length > 0) {
        let volume = 0;
        for (const f of fills) {
          const qty = parseFloat(f.quantity.toString());
          const price = parseFloat(f.price.toString());
          if (!isNaN(qty) && !isNaN(price)) volume += qty * price;
        }
        // We keep volume as string Decimal-safe - but for public stats we return as string
        // This is derived from canonical fills, not client-provided
        totalVolume = volume.toString();
        totalTrades = fills.length;
      }
    } catch {}

    return {
      followerCount: profile.followerCount,
      totalVolume,
      totalTrades,
      verificationState: profile.verificationState,
      isPublic: profile.isPublic,
      supportedVenues: profile.supportedVenues,
      supportedSymbols: profile.supportedSymbols,
    };
  }

  private mapToProfile(row: any): TraderProfile {
    return {
      traderId: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      displayName: row.displayName,
      bio: row.bio || null,
      avatarUrl: row.avatarUrl || null,
      verificationState: row.verificationState,
      verifiedAt: row.verifiedAt ? new Date(row.verifiedAt).toISOString() : null,
      supportedVenues: row.supportedVenues || [],
      supportedSymbols: row.supportedSymbols || [],
      riskProfile: row.riskProfile || {},
      isPublic: row.isPublic,
      isFeatured: row.isFeatured,
      followerCount: row.followerCount || 0,
      totalVolume: row.totalVolume?.toString() || '0',
      totalTrades: row.totalTrades || 0,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    };
  }
}

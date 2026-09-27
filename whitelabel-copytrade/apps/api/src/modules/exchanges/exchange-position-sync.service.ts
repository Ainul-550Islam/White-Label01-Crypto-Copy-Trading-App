import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ExchangeVenue, ExchangeEnvironment, ExchangeSyncState, ExchangePosition, normalizeTimestampMicros } from './exchange.types';
import { ExchangeProviderFactory } from './exchange-provider.factory';
import { ExchangeCredentialService } from './exchange-credential.service';
import { ExchangeAccountRepository } from './exchange-account.repository';
import { ExchangeAuditService } from './exchange-audit.service';
import { ExchangeProviderContext } from './exchange-provider.interface';
import { randomUUID } from 'crypto';

/**
 * Idempotent position synchronization with symbol, side, quantity, entry price, mark price, leverage, unrealized PnL, and exchange timestamp handling.
 * Normalize exchange-specific position models into platform's internal representation. Do not invent PnL when exchange provides validated values.
 */
@Injectable()
export class ExchangePositionSyncService {
  private readonly logger = new Logger(ExchangePositionSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: ExchangeProviderFactory,
    private readonly credentialService: ExchangeCredentialService,
    private readonly accountRepo: ExchangeAccountRepository,
    private readonly auditService: ExchangeAuditService,
  ) {}

  private toDecimalString(value: string | number | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') {
      if (!/^-?\d+(\.\d+)?$/.test(value.trim())) {
        if (value.trim() === '') return null;
        this.logger.warn(`Invalid decimal string for position: ${value}`);
        return null;
      }
      return value.trim();
    }
    this.logger.warn(`Position amount as number ${value} - should be string`);
    return value.toString();
  }

  async syncPositions(input: { tenantId: string; accountId: string; venue: ExchangeVenue; environment: ExchangeEnvironment; actorId?: string; requestId?: string }): Promise<{ state: ExchangeSyncState; processed: number; created: number; updated: number; skipped: number; durationMs: number }> {
    const start = Date.now();
    const isSandbox = input.environment !== ExchangeEnvironment.LIVE;

    const account = await this.accountRepo.findById(input.accountId, input.tenantId);
    if (!account) throw new Error(`Account ${input.accountId} not found`);

    let provider;
    try {
      provider = this.providerFactory.getProvider(input.venue, input.environment);
    } catch (e: any) {
      this.logger.warn(`Provider unavailable for position sync tenant=${input.tenantId} account=${input.accountId} error=${e.message}`);
      return { state: ExchangeSyncState.FAILED, processed: 0, created: 0, updated: 0, skipped: 0, durationMs: Date.now() - start };
    }

    let credentials;
    try {
      credentials = await this.credentialService.getDecryptedCredentialsForProvider(input.tenantId, input.accountId, input.venue, input.environment);
    } catch (e: any) {
      this.logger.warn(`Credential unavailable for position sync tenant=${input.tenantId} account=${input.accountId} error=${e.message}`);
      return { state: ExchangeSyncState.FAILED, processed: 0, created: 0, updated: 0, skipped: 0, durationMs: Date.now() - start };
    }

    const context: ExchangeProviderContext = {
      tenantId: input.tenantId,
      accountId: input.accountId,
      venue: input.venue,
      environment: input.environment,
      isSandbox,
      credentials: {
        apiKey: credentials.apiKey,
        apiSecret: credentials.apiSecret,
        passphrase: credentials.passphrase,
        environment: input.environment,
        isSandbox,
      },
      credentialRef: null,
    };

    let positions: ExchangePosition[];
    try {
      positions = await provider.getPositions(context);
    } catch (e: any) {
      this.logger.error(`Failed to fetch positions tenant=${input.tenantId} account=${input.accountId} venue=${input.venue} error=${e.message}`);
      await this.auditService.record({
        tenantId: input.tenantId,
        accountId: input.accountId,
        venue: input.venue,
        environment: input.environment,
        event: 'POSITION_SYNCED',
        result: 'FAILURE',
        actorId: input.actorId,
        safeMetadata: { errorCode: e.code || 'FETCH_FAILED', isSandbox },
        requestId: input.requestId,
      });
      return { state: ExchangeSyncState.FAILED, processed: 0, created: 0, updated: 0, skipped: 0, durationMs: Date.now() - start };
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;

    // For idempotency, we need to track providerPositionId or symbol+side
    for (const pos of positions) {
      try {
        const quantity = this.toDecimalString(pos.quantity);
        if (!quantity) {
          skipped++;
          continue;
        }

        const timestampMicros = normalizeTimestampMicros(pos.timestampMicros);

        // Find existing position by accountId + symbol (unique per account+symbol per schema)
        // TradingSymbol lookup required for position's symbolId
        const symbolRecord = await this.prisma.tradingSymbol.findFirst({
          where: { tenantId: input.tenantId, symbol: pos.symbol },
          select: { id: true },
        });

        if (!symbolRecord) {
          // If symbol not found, skip - do not create fake symbol
          this.logger.warn(`Symbol not found for position sync tenant=${input.tenantId} symbol=${pos.symbol}`);
          skipped++;
          continue;
        }

        const existing = await this.prisma.position.findFirst({
          where: { accountId: input.accountId, symbolId: symbolRecord.id },
        });

        const positionData = {
          quantity: quantity as any,
          side: pos.side as any,
          averageEntryPrice: this.toDecimalString(pos.entryPrice) as any,
          markPrice: this.toDecimalString(pos.markPrice) as any,
          realisedPnl: this.toDecimalString(pos.realizedPnl) as any,
          unrealisedPnl: this.toDecimalString(pos.unrealizedPnl) as any,
          // cumulativeFee not in exchange position, keep existing or 0
          containsSimulatedFills: pos.isSimulated,
          lastFillAt: new Date(Number(BigInt(timestampMicros) / BigInt(1000))),
          updatedAt: new Date(),
        };

        if (existing) {
          // Idempotent: check if same timestamp and same quantity - skip
          const existingQty = existing.quantity.toString();
          if (existingQty === quantity && existing.side === pos.side) {
            // Check timestamp awareness - only update if newer
            const existingLastFill = existing.lastFillAt ? existing.lastFillAt.getTime() : 0;
            const newTime = Number(BigInt(timestampMicros) / BigInt(1000));
            if (newTime <= existingLastFill) {
              skipped++;
              continue;
            }
          }

          await this.prisma.position.update({
            where: { id: existing.id },
            data: positionData,
          });
          updated++;
        } else {
          // Only create if quantity non-zero (FLAT positions may be skipped per business rule, but we create for completeness)
          if (quantity === '0' || pos.side === 'FLAT') {
            skipped++;
            continue;
          }

          await this.prisma.position.create({
            data: {
              id: randomUUID(),
              tenantId: input.tenantId,
              accountId: input.accountId,
              symbolId: symbolRecord.id,
              venue: input.venue as any,
              symbol: pos.symbol,
              quantity: quantity as any,
              side: pos.side as any,
              averageEntryPrice: this.toDecimalString(pos.entryPrice) as any,
              markPrice: this.toDecimalString(pos.markPrice) as any,
              realisedPnl: this.toDecimalString(pos.realizedPnl) as any || (0 as any),
              unrealisedPnl: this.toDecimalString(pos.unrealizedPnl) as any,
              cumulativeFee: 0 as any,
              containsSimulatedFills: pos.isSimulated,
              fillCount: 0,
              openedAt: new Date(),
              lastFillAt: new Date(Number(BigInt(timestampMicros) / BigInt(1000))),
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          });
          created++;
        }
      } catch (e: any) {
        this.logger.warn(`Failed to sync position symbol=${pos.symbol} tenant=${input.tenantId} account=${input.accountId} error=${e.message}`);
        skipped++;
      }
    }

    const durationMs = Date.now() - start;

    await this.accountRepo.updateSyncMetadata(input.accountId, input.tenantId, { lastSyncAt: new Date() });

    await this.auditService.record({
      tenantId: input.tenantId,
      accountId: input.accountId,
      venue: input.venue,
      environment: input.environment,
      event: 'POSITION_SYNCED',
      result: 'SUCCESS',
      actorId: input.actorId,
      safeMetadata: { processed: positions.length, created, updated, skipped, durationMs, isSandbox },
      requestId: input.requestId,
    });

    this.logger.log(`Position sync completed tenant=${input.tenantId} account=${input.accountId} processed=${positions.length} created=${created} updated=${updated} skipped=${skipped}`);

    return { state: ExchangeSyncState.COMPLETED, processed: positions.length, created, updated, skipped, durationMs };
  }
}

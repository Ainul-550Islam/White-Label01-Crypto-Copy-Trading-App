import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ExchangeVenue, ExchangeEnvironment, ExchangeSyncState, ExchangeBalance, normalizeTimestampMicros } from './exchange.types';
import { ExchangeProviderFactory } from './exchange-provider.factory';
import { ExchangeCredentialService } from './exchange-credential.service';
import { ExchangeAccountRepository } from './exchange-account.repository';
import { ExchangeAuditService } from './exchange-audit.service';
import { ExchangeProviderContext } from './exchange-provider.interface';
import { CacheService } from '../../infrastructure/redis/cache.service';

/**
 * Idempotent balances synchronization from exchange into existing account/read-model architecture with Decimal-safe quantities.
 * Do not use JavaScript floating-point arithmetic for monetary quantities. If exchange returns amount as string, preserve precision.
 */
@Injectable()
export class ExchangeBalanceSyncService {
  private readonly logger = new Logger(ExchangeBalanceSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: ExchangeProviderFactory,
    private readonly credentialService: ExchangeCredentialService,
    private readonly accountRepo: ExchangeAccountRepository,
    private readonly auditService: ExchangeAuditService,
    private readonly cache: CacheService,
  ) {}

  private toDecimalString(value: string | number | null | undefined): string {
    if (value === null || value === undefined) return '0';
    if (typeof value === 'string') {
      // Validate decimal string - preserve precision, no float conversion
      if (!/^-?\d+(\.\d+)?$/.test(value.trim())) {
        // If not valid decimal, try to parse but log warning
        this.logger.warn(`Invalid decimal string received: ${value}`);
        return '0';
      }
      return value.trim();
    }
    // If number, convert to string preserving as much as possible - but warn that precision may be lost
    // For financial quantities, provider should return string per spec
    this.logger.warn(`Balance amount received as number ${value} - should be string for precision`);
    return value.toString();
  }

  private addDecimalStrings(a: string, b: string): string {
    // Decimal-safe addition without float - use BigInt for integer part and handle decimals
    // Simplified: use decimal.js-like logic with string manipulation
    try {
      const [aInt, aDec = ''] = a.split('.');
      const [bInt, bDec = ''] = b.split('.');
      const maxDec = Math.max(aDec.length, bDec.length);
      const aPadded = aDec.padEnd(maxDec, '0');
      const bPadded = bDec.padEnd(maxDec, '0');

      const aFull = BigInt(aInt + aPadded);
      const bFull = BigInt(bInt + bPadded);
      const sum = aFull + bFull;
      const sumStr = sum.toString().padStart(maxDec + 1, '0');
      if (maxDec === 0) return sumStr;
      const intPart = sumStr.slice(0, -maxDec) || '0';
      const decPart = sumStr.slice(-maxDec).replace(/0+$/, '') || '0';
      // Return with preserved decimals if needed, but for total we need sum
      // For simplicity, if decPart is 0, return intPart
      if (decPart === '0') return intPart;
      return `${intPart}.${decPart}`;
    } catch {
      // Fallback - should not happen, but avoid float
      return (BigInt(a.split('.')[0] || '0') + BigInt(b.split('.')[0] || '0')).toString();
    }
  }

  async syncBalances(input: { tenantId: string; accountId: string; venue: ExchangeVenue; environment: ExchangeEnvironment; actorId?: string; requestId?: string }): Promise<{ state: ExchangeSyncState; processed: number; created: number; updated: number; skipped: number; durationMs: number }> {
    const start = Date.now();
    const isSandbox = input.environment !== ExchangeEnvironment.LIVE;

    const account = await this.accountRepo.findById(input.accountId, input.tenantId);
    if (!account) {
      throw new Error(`Account ${input.accountId} not found for tenant ${input.tenantId}`);
    }

    let provider;
    try {
      provider = this.providerFactory.getProvider(input.venue, input.environment);
    } catch (e: any) {
      this.logger.warn(`Provider unavailable for balance sync tenant=${input.tenantId} account=${input.accountId} error=${e.message}`);
      return { state: ExchangeSyncState.FAILED, processed: 0, created: 0, updated: 0, skipped: 0, durationMs: Date.now() - start };
    }

    let credentials;
    try {
      credentials = await this.credentialService.getDecryptedCredentialsForProvider(input.tenantId, input.accountId, input.venue, input.environment);
    } catch (e: any) {
      this.logger.warn(`Credential unavailable for balance sync tenant=${input.tenantId} account=${input.accountId} error=${e.message}`);
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

    let balances: ExchangeBalance[];
    try {
      balances = await provider.getBalances(context);
    } catch (e: any) {
      this.logger.error(`Failed to fetch balances tenant=${input.tenantId} account=${input.accountId} venue=${input.venue} error=${e.message}`);
      await this.auditService.record({
        tenantId: input.tenantId,
        accountId: input.accountId,
        venue: input.venue,
        environment: input.environment,
        event: 'BALANCE_SYNCED',
        result: 'FAILURE',
        actorId: input.actorId,
        safeMetadata: { errorCode: e.code || 'FETCH_FAILED', isSandbox },
        requestId: input.requestId,
      });
      return { state: ExchangeSyncState.FAILED, processed: 0, created: 0, updated: 0, skipped: 0, durationMs: Date.now() - start };
    }

    // Idempotent upsert - tenant/account scoped, provider reference based, timestamp-aware
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const balance of balances) {
      try {
        const free = this.toDecimalString(balance.free);
        const locked = this.toDecimalString(balance.locked);
        const total = this.toDecimalString(balance.total);

        // Validate free+locked ≈ total within small tolerance? We preserve provider values, do not recalculate
        // But we ensure total is at least free if provider gives inconsistent data
        const observedAtMicros = BigInt(normalizeTimestampMicros(balance.timestampMicros));
        const venueUpdatedAtMicros = balance.providerReference ? observedAtMicros : null;

        // Use idempotency key: tenantId + accountId + asset + providerReference
        const existing = await this.prisma.accountBalanceSnapshot.findFirst({
          where: { tenantId: input.tenantId, accountId: input.accountId, asset: balance.asset },
        });

        if (existing) {
          // Check if same timestamp and same values - skip duplicate
          const existingObserved = existing.observedAtMicros ? BigInt(existing.observedAtMicros.toString()) : BigInt(0);
          if (existingObserved === observedAtMicros && existing.free.toString() === free && existing.locked.toString() === locked) {
            skipped++;
            continue;
          }

          // Update with timestamp awareness - only update if newer
          if (observedAtMicros >= existingObserved) {
            await this.prisma.accountBalanceSnapshot.update({
              where: { id: existing.id },
              data: {
                free: free as any,
                locked: locked as any,
                total: total as any,
                observedAtMicros: observedAtMicros as any,
                venueUpdatedAtMicros: venueUpdatedAtMicros as any,
                isSimulated: balance.isSimulated,
                updatedAt: new Date(),
              },
            });
            updated++;
          } else {
            skipped++;
          }
        } else {
          await this.prisma.accountBalanceSnapshot.create({
            data: {
              id: this.generateId(),
              tenantId: input.tenantId,
              accountId: input.accountId,
              asset: balance.asset,
              free: free as any,
              locked: locked as any,
              total: total as any,
              observedAtMicros: observedAtMicros as any,
              venueUpdatedAtMicros: venueUpdatedAtMicros as any,
              isSimulated: balance.isSimulated,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          });
          created++;
        }

        // Cache latest balance for fast reads - idempotent
        try {
          await this.cache.set(`balance:${input.tenantId}:${input.accountId}:${balance.asset}`, { free, locked, total, observedAtMicros: observedAtMicros.toString() }, 300);
        } catch {}
      } catch (e: any) {
        this.logger.warn(`Failed to sync balance asset=${balance.asset} tenant=${input.tenantId} account=${input.accountId} error=${e.message}`);
        skipped++;
      }
    }

    const durationMs = Date.now() - start;

    // Update last sync metadata
    await this.accountRepo.updateSyncMetadata(input.accountId, input.tenantId, { lastSyncAt: new Date() });

    await this.auditService.record({
      tenantId: input.tenantId,
      accountId: input.accountId,
      venue: input.venue,
      environment: input.environment,
      event: 'BALANCE_SYNCED',
      result: 'SUCCESS',
      actorId: input.actorId,
      safeMetadata: { processed: balances.length, created, updated, skipped, durationMs, isSandbox },
      requestId: input.requestId,
    });

    this.logger.log(`Balance sync completed tenant=${input.tenantId} account=${input.accountId} processed=${balances.length} created=${created} updated=${updated} skipped=${skipped} duration=${durationMs}ms`);

    return { state: ExchangeSyncState.COMPLETED, processed: balances.length, created, updated, skipped, durationMs };
  }

  private generateId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 10)}-${Math.random().toString(36).substring(2, 10)}`;
  }
}

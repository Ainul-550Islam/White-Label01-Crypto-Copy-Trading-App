// # Responsibility: owner-scoped, versioned and audited per-account order-size ceilings.
import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { AuditActorType, AuditOutcome, type Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { Decimal } from '../../common/decimal-string';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONEY = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,12})?$/;
const KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const CURRENCY = /^[A-Z0-9]{2,16}$/;

type Policy = { max_base_quantity: Prisma.Decimal | null; max_order_notional: Prisma.Decimal | null;
  notional_currency: string | null; revision: string; updated_at: Date };
type OwnerAccount = { id: string; label: string; marketType: string; tradingMode: string; status: string };
export type AccountOrderSizeUpdate = {
  expectedRevision: string | null;
  maxBaseQuantity: string | null;
  maxOrderNotional: string | null;
  notionalCurrency: string | null;
};

function decimal(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !MONEY.test(value)) throw new BadRequestException('Limit must be a non-negative decimal string with at most 16 whole and 12 fractional digits.');
  return Decimal.parse(value).toString();
}
function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }

@Injectable()
export class AccountOrderSizeLimitService {
  constructor(private readonly prisma: PrismaService) {}

  async list(params: { tenantId: string; userId: string; page: number; limit: number }) {
    const { tenantId, userId, page, limit } = params;
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      throw new BadRequestException('Invalid pagination.');
    }
    return this.prisma.withTenantRls(tenantId, async (tx) => {
      const where = { tenantId, userId, deletedAt: null };
      const [accounts, total] = await Promise.all([
        tx.tradingAccount.findMany({ where, orderBy: { id: 'asc' }, skip: (page - 1) * limit, take: limit,
          select: { id: true, label: true, marketType: true, tradingMode: true, status: true } }),
        tx.tradingAccount.count({ where }),
      ]);
      return { data: accounts, total, page, limit };
    });
  }

  async get(params: { tenantId: string; userId: string; accountId: string }) {
    const { tenantId, userId, accountId } = params;
    if (!UUID.test(accountId)) throw new BadRequestException('Invalid account.');
    return this.prisma.withTenantRls(tenantId, async (tx) => {
      const account = await this.ownerAccount(tx, tenantId, userId, accountId);
      return this.view(tenantId, account, await this.policy(tx, tenantId, accountId));
    });
  }

  async update(params: { tenantId: string; userId: string; accountId: string; input: AccountOrderSizeUpdate;
    idempotencyKey: string; requestId?: string | null }) {
    const { tenantId, userId, accountId, input, idempotencyKey, requestId } = params;
    if (!UUID.test(accountId) || !KEY.test(idempotencyKey) || !input ||
        !Object.prototype.hasOwnProperty.call(input, 'expectedRevision') ||
        !(input.expectedRevision === null || (typeof input.expectedRevision === 'string' && UUID.test(input.expectedRevision))) ||
        !Object.prototype.hasOwnProperty.call(input, 'maxBaseQuantity') ||
        !Object.prototype.hasOwnProperty.call(input, 'maxOrderNotional') ||
        !Object.prototype.hasOwnProperty.call(input, 'notionalCurrency')) {
      throw new BadRequestException('A retry key, observed revision and complete limits are required.');
    }
    const maxBaseQuantity = decimal(input.maxBaseQuantity);
    const maxOrderNotional = decimal(input.maxOrderNotional);
    const notionalCurrency = input.notionalCurrency;
    if ((maxOrderNotional === null && notionalCurrency !== null) ||
        (maxOrderNotional !== null && (typeof notionalCurrency !== 'string' || !CURRENCY.test(notionalCurrency)))) {
      throw new BadRequestException('A notional cap requires one uppercase quote currency.');
    }
    const keyHash = hash(idempotencyKey);
    const intentHash = hash(JSON.stringify(['account-order-size-v1', accountId, input.expectedRevision,
      maxBaseQuantity, maxOrderNotional, notionalCurrency]));
    try {
      return await this.prisma.withTenantRls(tenantId, async (tx) => {
        // Serialise reuse of one key even when concurrent requests target
        // different accounts; an account lock alone does not do that.
        const keyLock = `account-order-size-key:${tenantId}:${userId}:${keyHash}`;
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${keyLock}, 0))::text`;
        const account = await this.ownerAccount(tx, tenantId, userId, accountId, true);
        await tx.$queryRaw`SELECT wlct_account_order_size_lock(${tenantId}::uuid, ${accountId}::uuid)::text`;
        const before = await this.policy(tx, tenantId, accountId);
        const [previous] = await tx.$queryRaw<Array<{ intent_hash: string }>>`
          SELECT intent_hash FROM "account_order_size_limit_update_intents"
          WHERE tenant_id=${tenantId}::uuid AND user_id=${userId}::uuid AND key_hash=${keyHash}
        `;
        if (previous) {
          if (previous.intent_hash !== intentHash) throw new ConflictException('Request key was used for a different limit update.');
          return this.view(tenantId, account, before);
        }
        if ((before?.revision ?? null) !== input.expectedRevision) {
          throw new ConflictException('Limits changed since they were loaded; refresh before editing.');
        }
        const [saved] = await tx.$queryRaw<Policy[]>`
          INSERT INTO "account_order_size_limits" (tenant_id, account_id, max_base_quantity, max_order_notional, notional_currency)
          VALUES (${tenantId}::uuid, ${accountId}::uuid, ${maxBaseQuantity}::numeric, ${maxOrderNotional}::numeric, ${notionalCurrency})
          ON CONFLICT (tenant_id, account_id) DO UPDATE SET max_base_quantity=EXCLUDED.max_base_quantity,
            max_order_notional=EXCLUDED.max_order_notional, notional_currency=EXCLUDED.notional_currency
          RETURNING max_base_quantity, max_order_notional, notional_currency, revision, updated_at
        `;
        if (!saved) throw new Error('Limit write did not return its revision');
        await tx.auditLog.create({ data: {
          tenantId, actorType: AuditActorType.USER, actorId: userId, action: 'ACCOUNT_ORDER_SIZE_LIMIT_UPDATED',
          outcome: AuditOutcome.SUCCESS, resourceType: 'ACCOUNT_ORDER_SIZE_LIMIT', resourceId: accountId,
          description: 'Updated owner-scoped per-order size ceilings.',
          changes: {
            maxBaseQuantity: { before: before?.max_base_quantity?.toFixed() ?? null, after: maxBaseQuantity },
            maxOrderNotional: { before: before?.max_order_notional?.toFixed() ?? null, after: maxOrderNotional },
            notionalCurrency: { before: before?.notional_currency ?? null, after: notionalCurrency },
          },
          metadata: { source: 'SELF_SERVICE', revision: saved.revision },
          requestId: typeof requestId === 'string' ? requestId.slice(0, 64) : null,
        } });
        await tx.$executeRaw`
          INSERT INTO "account_order_size_limit_update_intents" (tenant_id, user_id, key_hash, intent_hash)
          VALUES (${tenantId}::uuid, ${userId}::uuid, ${keyHash}, ${intentHash})
        `;
        return this.view(tenantId, account, saved);
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('ACCOUNT_ORDER_LIMIT_ACTIVE_ORDERS')) {
        throw new ConflictException({ code: 'ACCOUNT_ORDER_LIMIT_ACTIVE_ORDERS',
          message: 'Resolve active or unreconciled orders before changing this account limit.' });
      }
      throw error;
    }
  }

  private async ownerAccount(tx: Prisma.TransactionClient, tenantId: string, userId: string, accountId: string, lock = false): Promise<OwnerAccount> {
    if (lock) {
      const [row] = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "trading_accounts" WHERE tenant_id=${tenantId}::uuid AND user_id=${userId}::uuid
          AND id=${accountId}::uuid AND deleted_at IS NULL FOR SHARE
      `;
      if (!row) throw new ForbiddenException('The trading account is not available to this user.');
    }
    const account = await tx.tradingAccount.findFirst({ where: { tenantId, userId, id: accountId, deletedAt: null },
      select: { id: true, label: true, marketType: true, tradingMode: true, status: true } });
    if (!account) throw new ForbiddenException('The trading account is not available to this user.');
    return account;
  }

  private async policy(tx: Prisma.TransactionClient, tenantId: string, accountId: string): Promise<Policy | null> {
    const [row] = await tx.$queryRaw<Policy[]>`
      SELECT max_base_quantity, max_order_notional, notional_currency, revision, updated_at
      FROM "account_order_size_limits" WHERE tenant_id=${tenantId}::uuid AND account_id=${accountId}::uuid
    `;
    return row ?? null;
  }

  private view(tenantId: string, account: OwnerAccount, policy: Policy | null) {
    const maxBaseQuantity = policy?.max_base_quantity?.toFixed() ?? null;
    const maxOrderNotional = policy?.max_order_notional?.toFixed() ?? null;
    return { tenantId, account, limits: { maxBaseQuantity, maxOrderNotional, notionalCurrency: policy?.notional_currency ?? null },
      configured: maxBaseQuantity !== null || maxOrderNotional !== null, revision: policy?.revision ?? null,
      updatedAt: policy?.updated_at.toISOString() ?? null, asOf: new Date().toISOString() };
  }
}

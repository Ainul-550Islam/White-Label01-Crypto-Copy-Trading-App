import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { sha256Hex } from './developer.types';

/** Public mutations use a stable client-generated key, never a generated fallback. */
export function requireMutationKey(request: Request): string {
  const key = request.headers['idempotency-key'];
  if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw new BadRequestException('a valid idempotency key is required');
  }
  return key;
}

/**
 * Called only inside withTenantRls, in the very same transaction as the write.
 * A duplicate key is a conflict: secret-bearing responses are never replayed
 * or persisted and an uncertain client must inspect its resource list.
 */
export async function claimMutationIntent(
  tx: Prisma.TransactionClient,
  tenantId: string,
  key: string,
  operation: string,
  resource: string,
): Promise<void> {
  const hash = sha256Hex(key);
  const inserted = await tx.$executeRaw`
    INSERT INTO "developer_mutation_intents" ("tenant_id", "key_hash", "operation", "resource")
    VALUES (${tenantId}::uuid, ${hash}, ${operation}, ${resource})
    ON CONFLICT ("tenant_id", "key_hash") DO NOTHING
  `;
  if (inserted !== 1) throw new ConflictException('request key has already been used');
}

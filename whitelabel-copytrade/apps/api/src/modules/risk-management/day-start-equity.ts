import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * Day-start equity for a set of trading accounts, shared by the daily-loss
 * and intraday-drawdown rules so both measure against the SAME reference.
 *
 * The reference for one account is the equity on its FIRST risk snapshot
 * (`RiskSnapshotMetadata`, written by the execution engine on every risk
 * evaluation) captured on the given UTC trading day. It lives in the
 * database, so a service restart never resets it.
 *
 * For several accounts the references are summed - but only when every
 * account has one. A partial sum would understate the day-start equity and
 * hide a loss, so a single missing account makes the answer `null`, which the
 * callers turn into RiskState.UNKNOWN (fail closed).
 */
const SCALE = 1_000_000_000_000n;

function isValidDecimal(v: unknown): v is string {
  return typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v);
}

function parseScaled(s: string): bigint {
  const neg = s.startsWith('-');
  const clean = neg ? s.slice(1) : s;
  const [intP = '0', fracP = ''] = clean.split('.');
  const frac = (fracP + '0'.repeat(12)).slice(0, 12);
  const val = BigInt(intP) * SCALE + BigInt(frac || '0');
  return neg ? -val : val;
}

function formatScaled(b: bigint): string {
  const neg = b < 0n;
  const abs = neg ? -b : b;
  const intP = abs / SCALE;
  const frac = abs % SCALE;
  const fracStr = frac.toString().padStart(12, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + (fracStr ? `${intP}.${fracStr}` : `${intP}`);
}

export async function resolveDayStartEquity(
  prisma: Pick<PrismaService, 'riskSnapshotMetadata'>,
  tenantId: string,
  tradingDay: string,
  accountIds: Iterable<string>,
): Promise<string | null> {
  const ids = Array.from(new Set(accountIds));
  if (ids.length === 0) return null;
  const metas = await prisma.riskSnapshotMetadata.findMany({
    where: { tenantId, tradingDay, accountId: { in: ids }, equity: { not: null } },
    orderBy: { capturedAt: 'asc' },
    select: { accountId: true, equity: true, capturedAt: true },
  });
  const firstByAccount = new Map<string, string>();
  for (const m of metas) {
    if (firstByAccount.has(m.accountId) || m.equity === null || m.equity === undefined) continue;
    const value = m.equity.toString();
    if (isValidDecimal(value)) firstByAccount.set(m.accountId, value);
  }
  let total = 0n;
  for (const id of ids) {
    const value = firstByAccount.get(id);
    if (value === undefined) return null;
    total += parseScaled(value);
  }
  return formatScaled(total);
}

/** The accounts a tenant-wide (or single-account) risk evaluation covers. */
export function scopeAccountIdsOf(accountId: string | undefined, rows: Array<{ accountId: string | null | undefined }>): Set<string> {
  const ids = new Set<string>();
  if (accountId) {
    ids.add(accountId);
    return ids;
  }
  for (const r of rows) if (r.accountId) ids.add(r.accountId);
  return ids;
}

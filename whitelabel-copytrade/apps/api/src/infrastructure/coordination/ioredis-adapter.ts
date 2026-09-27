/**
 * The production {@link CoordinationRedis} port over an ioredis connection.
 *
 * This adapter exists so NOTHING in partitions/lease code ever sees ioredis:
 * the Lua scripts are shipped through EVAL with an explicit key count, SET
 * arguments in the real order, and nothing else. Every method here is three
 * lines and a lie detector - if it grows logic, that logic belongs above it.
 *
 * Connection choice is deliberate: callers pass a DEDICATED connection
 * (`RedisService.duplicate()`). Coordination traffic is small but
 * latency-sensitive (claims renew between batches); sharing the command
 * pipeline would let a fat GET queue ahead of a lease renewal and turn a
 * busy API into a partition flapper.
 */

import type Redis from 'ioredis';

import type { CoordinationRedis } from './lease';
import type { MembershipEvalRedis } from './membership';

export class IoredisCoordinationClient
  implements CoordinationRedis, MembershipEvalRedis
{
  public constructor(private readonly client: Pick<Redis, 'eval' | 'get' | 'set'>) {}

  /** SET name value PX px NX - true only when the key was actually taken. */
  public async setIfAbsent(name: string, value: string, pxMillis: number): Promise<boolean> {
    const reply = await this.client.set(name, value, 'PX', pxMillis, 'NX');
    return reply === 'OK';
  }

  public async get(name: string): Promise<string | null> {
    return this.client.get(name);
  }

  /** EVAL with exactly one key. The scripts shipped in lease.ts touch one
   * claim/lease key each; hardcoding the count here keeps a future
   * two-argument call from silently misrouting key vs argv. */
  public async eval(script: string, key: string, ...argv: string[]): Promise<number> {
    const reply = await this.client.eval(script, 1, key, ...argv);
    return typeof reply === 'number' ? reply : Number(reply);
  }

  /** EVAL with exactly one key, reply passed through UNCOERCED - the
   * membership scripts answer flat member/score arrays, and the numeric
   * coercion above would turn them into NaN. Same hardcoding rule as
   * `eval`: the key count is 1 by protocol, checked nowhere else. */
  public async evalFlat(script: string, key: string, ...argv: string[]): Promise<unknown> {
    return this.client.eval(script, 1, key, ...argv);
  }
}

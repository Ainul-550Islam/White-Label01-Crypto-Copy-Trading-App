// # Serves one copied order's attempt-by-attempt timeline to the follower who owns it.
//
// WHAT THIS ROUTE HAS TO GET RIGHT
// --------------------------------
// The timeline is the answer to "my leader bought and I did not". It is assembled
// from rows the execution service already wrote, by `buildCopyExecutionTimeline`,
// which copies `retryCount` and the failure code exactly as stored: nothing here
// recomputes a number the customer can check against their statement.
//
// Ownership is checked against the ROW, not a parameter: the id in the path is a
// claim, and a follower who guesses another follower's execution id must get the
// same 404 as one that does not exist. That is also why the route is a customer
// route (`ORDER_READ`) rather than an operator one - a follower needs this without
// asking support, and support already has the operator surfaces.
import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { Permission, type AuthenticatedActor } from '@wlct/shared-types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/current-tenant.decorator';
import { RequireAnyPermission } from '../../common/decorators/permissions.decorator';
import { buildCopyExecutionTimeline, type CopyExecutionTimeline } from './copy-execution-status';
import { CopyExecutionRepository } from './copy-execution.repository';

@Controller('copy-trading/executions')
export class CopyExecutionTimelineController {
  constructor(private readonly executions: CopyExecutionRepository) {}

  /**
   * The attempts for one execution chain, oldest first.
   *
   * `findById` is tenant-scoped; the follower check is applied afterwards on the row
   * itself. Both are needed: the first stops a cross-tenant read, the second stops a
   * cross-user read inside a tenant where many followers share it.
   */
  @Get(':executionId/timeline')
  @RequireAnyPermission(Permission.ORDER_READ, Permission.COPY_SUBSCRIPTION_READ)
  async timeline(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
    @Param('executionId') executionId: string,
  ): Promise<CopyExecutionTimeline> {
    const row = await this.executions.findById(executionId, tenantId);
    const followerId = row && typeof row === 'object' ? (row as { followerId?: unknown }).followerId : undefined;
    // Same answer for "does not exist", "another tenant" and "another follower":
    // anything else would let a follower enumerate ids.
    if (!row || String(followerId ?? '') !== user.userId) {
      throw new NotFoundException('Copy execution not found');
    }

    const leaderEventId = (row as { leaderEventId?: unknown }).leaderEventId;
    const subscriptionId = (row as { subscriptionId?: unknown }).subscriptionId;

    // The chain is the set of attempts for the same leader event on the same
    // subscription. When the row predates the leader-event link (or the ids are
    // absent) the timeline is the single row rather than a guess at a chain.
    let rows = [row];
    if (typeof subscriptionId === 'string' && typeof leaderEventId === 'string') {
      const listed = await this.executions.listBySubscription(tenantId, subscriptionId, { limit: 100 });
      const chain = listed.data.filter(
        (candidate: unknown) =>
          candidate &&
          typeof candidate === 'object' &&
          String((candidate as { leaderEventId?: unknown }).leaderEventId ?? '') === leaderEventId,
      );
      if (chain.length > 0) rows = chain;
    }

    const timeline = buildCopyExecutionTimeline(rows as never);
    if (!timeline) throw new NotFoundException('Copy execution not found');
    return timeline;
  }
}

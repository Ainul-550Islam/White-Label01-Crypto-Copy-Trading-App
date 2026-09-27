import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { JOB_NAMES, QUEUE_NAMES } from '@wlct/config';

import { QueueService } from '../queue/queue.service';
import { AppConfigService } from '../../config/app-config.service';
import { ServiceUnavailableException } from '../../common/errors/app.exception';
import type { CommandAcceptedView } from './execution.types';

/**
 * Producer for the four execution commands that require venue credentials.
 *
 * The API process cannot perform any of these itself, and that is a deliberate
 * architectural property rather than an oversight. Verifying a key, reading a
 * balance, reconciling an account and re-syncing a private stream all require
 * an HMAC over a canonical query string using the tenant's API secret. The
 * signing code lives in `wlct_trading`, the credential provider lives in the
 * trading worker, and neither is importable from here.
 *
 * The result is that the credential boundary is enforced by process topology.
 * An injection bug, a careless `select`, or a future contributor's convenience
 * helper in this codebase cannot reach a secret, because the secret was never
 * in this address space.
 *
 * Every method returns an acknowledgement, not a result. Commands are
 * asynchronous by nature - a balance refresh costs rate-limit weight against a
 * venue that may currently be rate-limiting us - and pretending otherwise would
 * mean holding an HTTP request open across a network call to a third party.
 */
@Injectable()
export class ExecutionCommandsService {
  constructor(
    private readonly queue: QueueService,
    private readonly config: AppConfigService,
    @InjectPinoLogger(ExecutionCommandsService.name) private readonly logger: PinoLogger,
  ) {}

  async verifyCredentials(
    tenantId: string,
    accountId: string,
    requestedBy: string,
  ): Promise<CommandAcceptedView> {
    return this.dispatch({
      command: JOB_NAMES.VERIFY_EXCHANGE_CREDENTIALS,
      tenantId,
      accountId,
      requestedBy,
      note:
        'Credential verification was queued. The trading worker will query the venue and ' +
        'update the account status; poll the connectivity endpoint for the outcome.',
    });
  }

  async refreshBalances(
    tenantId: string,
    accountId: string,
    requestedBy: string,
  ): Promise<CommandAcceptedView> {
    return this.dispatch({
      command: JOB_NAMES.REFRESH_ACCOUNT_BALANCES,
      tenantId,
      accountId,
      requestedBy,
      note:
        'Balance refresh was queued. Venue balances cost rate-limit weight, so the worker ' +
        'may coalesce this with an in-flight refresh.',
    });
  }

  async reconcileAccount(
    tenantId: string,
    accountId: string,
    requestedBy: string,
    trigger: string,
  ): Promise<CommandAcceptedView> {
    return this.dispatch({
      command: JOB_NAMES.RECONCILE_TRADING_ACCOUNT,
      tenantId,
      accountId,
      requestedBy,
      extra: { trigger },
      note:
        'Reconciliation was queued. If a pass is already running for this account the new ' +
        'run is recorded as SKIPPED rather than running concurrently.',
    });
  }

  async resyncPrivateStream(
    tenantId: string,
    accountId: string,
    requestedBy: string,
  ): Promise<CommandAcceptedView> {
    return this.dispatch({
      command: JOB_NAMES.RESYNC_PRIVATE_STREAM,
      tenantId,
      accountId,
      requestedBy,
      note:
        'Private stream resync was queued. The worker will obtain a fresh listen key, ' +
        'reconnect, and reconcile the account because missed events are not replayed.',
    });
  }

  private async dispatch(input: {
    command: string;
    tenantId: string;
    accountId: string;
    requestedBy: string;
    note: string;
    extra?: Record<string, unknown>;
  }): Promise<CommandAcceptedView> {
    const payload = {
      tenantId: input.tenantId,
      accountId: input.accountId,
      requestedByUserId: input.requestedBy,
      requestedAt: new Date().toISOString(),
      ...(input.extra ?? {}),
    };

    // `enqueueOrThrow`, not `enqueue`. The fire-and-forget variant is right for
    // an audit record - losing one is regrettable but harmless. It is wrong
    // here: an operator who clicks "verify credentials" and gets a 202 while
    // Redis is down will sit and watch a status that never changes. A 503 tells
    // them the truth.
    let jobId: string;
    try {
      const enqueuedId = await this.queue.enqueueOrThrow(
        QUEUE_NAMES.TRADE_EXECUTION,
        input.command,
        payload,
        {
          // Deduplicate concurrent requests for the same account and command.
          // Two operators pressing the same button produce one job.
          jobId: `${input.command}:${input.accountId}`,
          // These are user-initiated and idempotent at the worker; a couple of
          // retries is right, an exponential storm against a rate-limited
          // venue is not.
          attempts: 3,
        },
      );
      jobId = enqueuedId.length > 0 ? enqueuedId : `${input.command}:${input.accountId}`;
    } catch (error) {
      this.logger.error(
        {
          event: 'execution.command_enqueue_failed',
          command: input.command,
          tenantId: input.tenantId,
          accountId: input.accountId,
          message: (error as Error).message,
        },
        'Failed to queue execution command',
      );
      throw new ServiceUnavailableException(
        'The trading worker queue is unavailable, so this command could not be scheduled. ' +
          'No change was made.',
      );
    }

    this.logger.info(
      {
        event: 'execution.command_queued',
        command: input.command,
        tenantId: input.tenantId,
        accountId: input.accountId,
        requestedByUserId: input.requestedBy,
        jobId,
        tradingMode: this.config.tradingMode,
      },
      'Execution command queued',
    );

    return {
      accepted: true,
      jobId,
      command: input.command,
      accountId: input.accountId,
      note: input.note,
    };
  }
}

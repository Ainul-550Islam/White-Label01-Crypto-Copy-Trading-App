/**
 * HTTP client for the execution engine (services/execution-engine).
 *
 * The division of labour this client exists to enforce: the worker owns the
 * queue, correlation and admission control; the engine owns venue contact,
 * credentials and the durable execution record. This file transports a
 * validated command across that boundary and NOTHING else - no retry logic
 * (BullMQ retries; a second retry loop under it multiplies load into a
 * degraded venue, which is the opposite of backpressure), no fallback to
 * "assume it worked", and no request body or response ever echoed into a
 * log line (the payloads contain account ids; the error messages may contain
 * whatever the venue said).
 *
 * Failure taxonomy - the whole point of this class:
 *  - retryable: transport failure, timeout, 5xx. The job throws and BullMQ
 *    re-delivers within its attempt budget.
 *  - terminal: 401/403 (misconfigured wiring; retrying a secret mismatch is
 *    how you lock yourself out), 404/409/422 (this job, as written, can
 *    never succeed), 501 (command not wired in the engine build).
 *    These surface as EngineCallError.terminal so the processor can fail the
 *    job with the engine's own reason string rather than retry it to dust.
 */

import { Injectable } from '@nestjs/common';
import { JOB_NAMES } from '@wlct/config';

import { AppConfigService } from '../../config/app-config.service';
import {
  EngineStatusShapeError,
  parseEngineStatus,
  type EngineStatus,
} from './engine-status-contract';
import type {
  AccountCommandPayload,
  CancelOrderPayload,
} from './worker.types';

/** Re-exported so the two consumers of the contract (this gate and the operations
 * read in modules/observability) import the SAME type from one place; the interface
 * itself lives in `engine-status-contract.ts`, because a mirror declared twice is a
 * mirror that drifts, which is the defect this part exists to close. */
export type { EngineStatus } from './engine-status-contract';
export { EngineStatusShapeError } from './engine-status-contract';

export interface EngineCallErrorInit {
  readonly kind: 'retryable' | 'terminal';
  readonly status: number | null;
  readonly code: string;
  readonly message: string;
  readonly correlationId?: string;
}

const ENGINE_URL_PATTERN = /^https?:\/\//;

export class EngineCallError extends Error {
  public readonly kind: 'retryable' | 'terminal';
  public readonly status: number | null;
  public readonly code: string;
  public readonly correlationId?: string;

  public constructor(init: EngineCallErrorInit) {
    super(`execution engine call failed [${init.code}] ${init.message}`);
    this.name = 'EngineCallError';
    this.kind = init.kind;
    this.status = init.status;
    this.code = init.code;
    this.correlationId = init.correlationId;
  }

  public get isTerminal(): boolean {
    return this.kind === 'terminal';
  }
}

export interface EngineCommandReceipt {
  readonly outcome: 'ok' | 'rejected';
  readonly code: string;
  readonly detail: Readonly<Record<string, unknown>>;
}

/** The wiring this client refuses to run without, as one predicate.
 *
 * Exported because a second consumer (Part 20's operations read) has to answer the
 * same question BEFORE constructing one - and `EngineInternalClient`'s constructor
 * raises on purpose, so a module that merely wanted to be polite about an
 * unconfigured deployment would otherwise have to catch a programmer-error at
 * request time. One law, two call sites, no copy of the 32-character rule. */
export const engineInternalClientConfigured = (config: AppConfigService): boolean => {
  const token = config.executionEngineToken;
  return (
    /^https?:\/\//.test(config.executionEngineUrl) &&
    token !== undefined &&
    token.length >= ENGINE_TOKEN_MIN_LENGTH
  );
};

/** The engine's own minimum (`services/execution-engine/app/security.py` accepts no
 * shorter token on the receiving side), restated here only as a number, never as a
 * second validation path. */
const ENGINE_TOKEN_MIN_LENGTH = 32;

const STATUS_CACHE_TTL_MS = 10_000;

@Injectable()
export class EngineInternalClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private statusCache: { value: EngineStatus; fetchedAtMs: number } | null = null;

  public constructor(config: AppConfigService) {
    const url = config.executionEngineUrl;
    if (!ENGINE_URL_PATTERN.test(url)) {
      throw new Error(
        'EXECUTION_ENGINE_URL must be an http(s) URL; refusing to construct an ' +
          'engine client that cannot be aimed at a real service',
      );
    }
    this.baseUrl = url.replace(/\/+$/, '');
    const token = config.executionEngineToken;
    if (token === undefined || token.length < ENGINE_TOKEN_MIN_LENGTH) {
      throw new Error(
        'EXECUTION_ENGINE_TOKEN (>= 32 characters) is required by the worker: ' +
          'this process forwards commands into the service holding venue credentials',
      );
    }
    this.token = token;
  }

  /** Startup gate for worker.ts: the engine must at least answer, speak the
   * same command set, and be in the mode this deployment believes it is in.
   * A worker that starts before its engine and "queues work" into a void is
   * the deployment race this check exists to make impossible; the 10s
   * cache is only for the periodic health view, not for this decision.
   * That view existed only as a sentence until Part 20: the operations panel's
   * execution section now reads the engine through `getStatus()` here, so the
   * cache is load-bearing (a panel refresh must not be a fresh dependency on a
   * service that owns venue connections) and the `force` argument stays reserved
   * for startup, which is the one moment a stale answer must not be trusted. */
  public async assertEngineCompatible(): Promise<EngineStatus> {
    let status: EngineStatus;
    try {
      status = await this.getStatus(true);
    } catch (error) {
      if (error instanceof EngineStatusShapeError) {
        // Terminal on purpose. A transport failure is retryable and BullMQ (or a
        // restart) will ask again; an engine that answers with something that is not
        // the contract will answer the same way every time, and a worker that retried
        // into it is a worker that never starts while looking like it is trying.
        throw new EngineCallError({
          kind: 'terminal',
          status: null,
          code: 'ENGINE_STATUS_SHAPE',
          message: error.message,
        });
      }
      throw error;
    }
    if (status.mode !== 'simulated') {
      throw new Error(
        `execution engine reports mode "${status.mode}"; this worker build forwards ` +
          'only into the simulated runtime (live is not wired)',
      );
    }
    if (status.storeDurable) {
      // Part 13 re-review (docs/PART13_DURABLE_STORE.md §ack; closes the
      // forcing function parked in docs/PART11_WORKER_SCALING.md §13.3):
      // the ack law - engine 2xx means done, business rejection is ALSO
      // done, only 5xx/transport retries - survives durability unchanged,
      // because every engine command that writes is replay-safe on the
      // durable store: submission idempotency is the (tenant,
      // client_order_id) unique index (a retry of a reserved order resumes
      // it, never double-books), fill recording is ON CONFLICT against the
      // (tenant, fill_id) index (a replayed execution answers "already
      // recorded"), and the event journal appends with no update path to
      // corrupt. Durability makes 2xx MORE trustworthy, not differently.
      // What this gate now refuses is the INCONSISTENT claim: a durable
      // store is only credible when the engine also names its backend -
      // the store class that could produce storeDurable=true declares
      // storeBackend=postgres, and an engine that claims durability while
      // reporting anything else (or nothing, pre-Part-13 wire shape) is a
      // contradiction this worker will not forward into.
      if (status.storeBackend !== 'postgres') {
        throw new Error(
          'execution engine reports a DURABLE store without storeBackend "postgres" ' +
            `(got "${status.storeBackend}"); the Part 13 durability contract is ` +
            'unproven on this engine and the worker only forwards under a reviewed store',
        );
      }
    }
    return status;
  }

  /** When the cached status was actually fetched, or null when nothing has been read.
   * Part 20 added this accessor for the operations panel: an age reported by the reader
   * ("I just looked") is not an age, it is a tautology, and the number an operator needs
   * is how long ago the ENGINE answered. */
  public statusFetchedAtMs(): number | null {
    return this.statusCache === null ? null : this.statusCache.fetchedAtMs;
  }

  public async getStatus(force = false): Promise<EngineStatus> {
    const cached = this.statusCache;
    if (
      !force &&
      cached !== null &&
      Date.now() - cached.fetchedAtMs < STATUS_CACHE_TTL_MS
    ) {
      return cached.value;
    }
    const response = await this.call('/internal/v1/status', {
      method: 'GET',
      correlationId: undefined,
    });
    const body: unknown = await response.json();
    // Parsed against the contract, never plucked key by key. The difference matters
    // on the failure path only: `String(body.mode ?? '')` turned a service answering
    // with a proxy's HTML page or a half-migrated engine into `mode: ''`, which the
    // gate below then read as "not simulated" - a refusal with a message blaming the
    // engine's mode instead of naming what actually happened, and eleven keys simply
    // absent from the object. A shape failure is now a shape failure, and it says
    // which key.
    const status = parseEngineStatus(body);
    this.statusCache = { value: status, fetchedAtMs: Date.now() };
    return status;
  }

  public async executeAccountCommand(
    command: string,
    payload: AccountCommandPayload,
    correlationId: string,
  ): Promise<EngineCommandReceipt> {
    const path = ACCOUNT_COMMAND_PATHS[command];
    if (path === undefined) {
      throw new EngineCallError({
        kind: 'terminal',
        status: null,
        code: 'COMMAND_UNROUTED',
        message: `no engine route for command ${JSON.stringify(command)}`,
      });
    }
    const response = await this.call(path, {
      method: 'POST',
      body: JSON.stringify({
        tenantId: payload.tenantId,
        accountId: payload.accountId,
        ...(payload.requestedByUserId !== undefined
          ? { requestedByUserId: payload.requestedByUserId }
          : {}),
        ...(payload.requestedAt !== undefined ? { requestedAt: payload.requestedAt } : {}),
      }),
      tenantId: payload.tenantId,
      correlationId,
    });
    const body = (await response.json()) as Record<string, unknown>;
    return this.receipt('ok', response.status, body);
  }

  public async cancelOrder(
    payload: CancelOrderPayload,
    correlationId: string,
  ): Promise<EngineCommandReceipt> {
    const response = await this.call('/internal/v1/orders/cancel', {
      method: 'POST',
      body: JSON.stringify({
        tenantId: payload.tenantId,
        accountId: payload.accountId,
        orderId: payload.orderId,
        clientOrderId: payload.clientOrderId,
        symbol: payload.symbol,
        ...(payload.requestedByUserId !== undefined
          ? { requestedByUserId: payload.requestedByUserId }
          : {}),
        ...(payload.requestedAt !== undefined ? { requestedAt: payload.requestedAt } : {}),
      }),
      tenantId: payload.tenantId,
      correlationId,
    });
    const body = (await response.json()) as Record<string, unknown>;
    // 200 + outcome is a COMPLETED job regardless of the business verdict;
    // the engine's contract says so. Only non-ok HTTP is an error path here.
    const outcome =
      typeof body.outcome === 'string' && body.outcome !== 'ACCEPTED' ? 'rejected' : 'ok';
    return this.receipt(outcome, response.status, body);
  }

  private receipt(
    outcome: EngineCommandReceipt['outcome'],
    status: number,
    body: Record<string, unknown>,
  ): EngineCommandReceipt {
    return {
      outcome,
      code: typeof body.code === 'string' ? body.code : `HTTP_${status}`,
      detail: body,
    };
  }

  private async call(
    path: string,
    init: {
      method: 'GET' | 'POST';
      body?: string;
      tenantId?: string;
      correlationId?: string;
    },
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-internal-token': this.token,
    };
    if (init.tenantId !== undefined) {
      headers['x-tenant-id'] = init.tenantId;
    }
    if (init.correlationId !== undefined) {
      headers['x-request-id'] = init.correlationId;
    }
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: init.method,
        headers,
        ...(init.body !== undefined ? { body: init.body } : {}),
        // The engine owns venue timeouts (EXECUTION_REQUEST_TIMEOUT_MS);
        // this is only the queue-hop guard so a hung engine cannot hold a
        // BullMQ job slot forever. 30s comfortably exceeds 5s + retries.
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      // The message may embed the URL (never the headers: fetch errors do
      // not print them, and this comment is the reminder that the token
      // lives ONLY there).
      throw new EngineCallError({
        kind: 'retryable',
        status: null,
        code: 'ENGINE_UNREACHABLE',
        message: error instanceof Error ? error.message : 'transport failure',
      });
    }

    if (response.ok) {
      return response;
    }

    const correlationId = response.headers.get('x-correlation-id') ?? undefined;
    const errorBody = await this.readErrorBody(response);
    const terminalByStatus =
      response.status === 401 ||
      response.status === 403 ||
      response.status === 404 ||
      response.status === 409 ||
      response.status === 422 ||
      response.status === 501;
    throw new EngineCallError({
      kind: terminalByStatus ? 'terminal' : 'retryable',
      status: response.status,
      code: errorBody.code,
      message: errorBody.message,
      ...(correlationId !== undefined ? { correlationId } : {}),
    });
  }

  private async readErrorBody(
    response: Response,
  ): Promise<{ code: string; message: string }> {
    try {
      const parsed = (await response.json()) as { code?: unknown; message?: unknown };
      return {
        code: typeof parsed.code === 'string' ? parsed.code : `HTTP_${response.status}`,
        // 256 chars: enough for an operator to act on, short enough that a
        // hostile venue string cannot bloat the queue's failure record.
        message:
          typeof parsed.message === 'string'
            ? parsed.message.slice(0, 256)
            : `engine responded ${response.status}`,
      };
    } catch {
      return {
        code: `HTTP_${response.status}`,
        message: `engine responded ${response.status} with an unreadable body`,
      };
    }
  }

}

/** Command → engine route. One table, module-private: adding a command to
 * worker.types without routing it here fails the worker's own spec loudly
 * (unrouted commands throw EngineCallError.COMMAND_UNROUTED - never a
 * silent send to the wrong path). */
const ACCOUNT_COMMAND_PATHS: Readonly<Record<string, string>> = {
  [JOB_NAMES.VERIFY_EXCHANGE_CREDENTIALS]: '/internal/v1/accounts/verify-credentials',
  [JOB_NAMES.REFRESH_ACCOUNT_BALANCES]: '/internal/v1/accounts/refresh-balances',
  [JOB_NAMES.RECONCILE_TRADING_ACCOUNT]: '/internal/v1/accounts/reconcile',
  [JOB_NAMES.RESYNC_PRIVATE_STREAM]: '/internal/v1/accounts/resync-private-stream',
};

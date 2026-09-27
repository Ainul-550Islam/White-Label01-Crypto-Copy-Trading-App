/**
 * Part 20 — the execution engine's own account of itself, on the operator's page.
 *
 * What this service is for. The engine has published `/internal/v1/status` since
 * Part 11 and, through Parts 13-19, filled it with the operational facts that explain
 * every refusal it makes: which credential source it was willing to read, whether a
 * confirmation verifier is installed, how the live-enablement grading came out, whether
 * its incident sink is durable, whether anything is measuring it at all. Until now the
 * only reader of that document was the worker's startup gate, and that gate looked at
 * nine of the twenty keys. So the platform had a service that answered questions nobody
 * asked it, and an operations panel that answered them from the trading engine's view of
 * whether it could reach an adapter (`observability.service.ts`, `executionPanel`) plus a
 * 24-hour order mix - which is a description of the traffic, not of the machinery.
 *
 * Two boundaries this file keeps.
 *
 * **Speedometer, not brakes.** Nothing here can block, refuse, or resolve anything; the
 * read never throws, and every failure of the engine to answer becomes a row saying
 * `unverified` with the reason. It follows the same rule as `worker-coordination-read.service.ts`
 * two files over, including the part that matters most: absence is reported as absence,
 * never as health. A panel that renders "no answer" as green is worse than no panel.
 *
 * **One reader, one parser.** The status document is parsed by
 * `modules/worker/engine-status-contract.ts` and nowhere else, and this service reaches
 * the engine through the worker's own client. A second HTTP call written for the panel
 * would be a second opinion about the same wire, and the two would disagree in the ways
 * that only show up during an incident.
 *
 * Why the engine is not in `OBS_PUBLISHER_SERVICES`. That list is the Redis health-mirror
 * channel, and the execution engine owns no Redis client at all - by design, since its
 * durable state lives in Postgres and its instruments are rendered at scrape time (Part
 * 18). Making it a publisher would mean introducing both a Redis handle and a background
 * task purely to copy facts the process already answers on request. The reader goes to the
 * author instead of the author duplicating itself into a cache, which is also why the age
 * of the answer is a first-class field here: this view is only as fresh as its last read.
 */

import { Inject, Injectable, Optional } from '@nestjs/common';

import { EngineCallError, EngineInternalClient } from '../worker/engine-internal.client';
import type { EngineStatus } from '../worker/engine-status-contract';
import type { OpsOverviewSection } from './observability.types';

/** The panel's own budget. The client's 30-second timeout is the queue-hop guard, sized
 * against a venue round trip; an operations page must not be able to wait that long on a
 * service it is only asking "how are you". A read that exceeds this becomes `unverified`
 * here, and the client's request is left running: when it eventually lands it fills the
 * 10-second cache, so the next refresh shows the answer. Nothing is cancelled and
 * nothing is faked. */
const PANEL_READ_BUDGET_MS = 2_000;

/** The provider token. A string token rather than the class, because what this module
 * binds is "a client, if this deployment is wired for one" - and binding the class to
 * `null` would leave the API with a constructor that throws on a missing token, which is
 * the client's correct behaviour for the worker and a wrong one for a panel. */
export const ENGINE_POSTURE_CLIENT = 'ENGINE_POSTURE_CLIENT';

export type EnginePostureState = 'reported' | 'unverified' | 'unconfigured';

export interface EnginePostureView {
  readonly state: EnginePostureState;
  /** When the engine last ANSWERED, taken from the client's cache stamp, or null when it
   * never has. Not "when this read ran": that would be a tautology wearing the word
   * "age". The freshness an operator needs here is how long ago the engine spoke, since
   * the wiring it describes does not change while it runs. */
  readonly checkedAtMs: number | null;
  readonly status: EngineStatus | null;
  /** The refusal, in the engine's or the transport's own words, cut to the same length
   * the client's error body uses. Never a stack, never a token. */
  readonly reason: string | null;
  /** `ENGINE_UNREACHABLE`, `ENGINE_STATUS_SHAPE`, `HTTP_500`, or the panel's own
   * `PANEL_BUDGET`. A code, because an operator greps for these. */
  readonly code: string | null;
}

const REASON_MAX_LENGTH = 256;

@Injectable()
export class EnginePostureService {
  public constructor(
    @Optional()
    @Inject(ENGINE_POSTURE_CLIENT)
    private readonly client: EngineInternalClient | null = null,
  ) {}

  /** Whether a client is bound. The configuration question was asked once, by the module's
   * factory, and asking it again here would put a second copy of that law on the read path
   * - where it could disagree with the binding and report "not wired" next to live data.
   * What this reports is therefore what the panel can actually do: read, or not. */
  public get wired(): boolean {
    return this.client !== null;
  }

  public async read(): Promise<EnginePostureView> {
    if (this.client === null) {
      return {
        state: 'unconfigured',
        checkedAtMs: null,
        status: null,
        reason:
          'no engine client: EXECUTION_ENGINE_URL and an EXECUTION_ENGINE_TOKEN of at least 32 characters are required',
        code: 'UNCONFIGURED',
      };
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const status = await Promise.race([
        this.client.getStatus(),
        new Promise<'budget'>((resolve) => {
          timer = setTimeout(() => resolve('budget'), PANEL_READ_BUDGET_MS);
        }),
      ]);
      if (status === 'budget') {
        return {
          state: 'unverified',
          // The last ANSWER's timestamp, not this read's: the operator's question on a
          // timeout is "how long has this been unknown", and only the fetch time answers it.
          checkedAtMs: this.client.statusFetchedAtMs(),
          status: null,
          reason: `the engine did not answer within the panel's ${PANEL_READ_BUDGET_MS}ms budget; the read is still running and the next refresh will show it`,
          code: 'PANEL_BUDGET',
        };
      }
      return {
        state: 'reported',
        checkedAtMs: this.client.statusFetchedAtMs(),
        status,
        reason: null,
        code: null,
      };
    } catch (error) {
      const code = error instanceof EngineCallError ? error.code : 'ENGINE_POSTURE_FAILED';
      const message = error instanceof Error ? error.message : String(error);
      return {
        state: 'unverified',
        // Same reasoning as the budget path: the age of the last answer is the useful
        // number when this one failed.
        checkedAtMs: this.client.statusFetchedAtMs(),
        status: null,
        reason: message.slice(0, REASON_MAX_LENGTH),
        code,
      };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** The EXECUTION-section rows the operations panel appends. Rendered as one section per
   * state so a failure cannot half-populate: `unverified` gets exactly the rows it can
   * honestly show, and the shape is stable enough for a UI to key on. */
  public async section(): Promise<OpsOverviewSection> {
    const view = await this.read();
    return {
      title: 'ENGINE POSTURE',
      rows: this.rows(view),
    };
  }

  /** Tone law, stated once: `ok` is reserved for a fact the engine reported about a
   * component that is doing what it was configured to do. A missing answer is `warn`,
   * a reported contradiction is `bad`, and a fact with nothing right or wrong about it
   * (which mode this is, which store class, how long the retention window is) is
   * `neutral`. There is no path in this file that renders absence as `ok`, and
   * `engine-posture.service.spec.ts` asserts that by walking every state. */
  public rows(view: EnginePostureView): OpsOverviewSection['rows'] {
    if (view.state !== 'reported' || view.status === null) {
      return [
        {
          label: 'engine posture',
          value: view.state === 'unconfigured' ? 'unconfigured' : 'unverified',
          detail: `${view.code ?? 'UNKNOWN'} - ${view.reason ?? 'no reason reported'}`,
          tone: 'warn',
        },
        {
          label: 'engine last answered',
          value:
            view.checkedAtMs === null
              ? 'never'
              : `${Math.max(0, Date.now() - view.checkedAtMs)}ms ago (this read did not answer)`,
          tone: 'warn',
        },
      ];
    }
    const status = view.status;
    const durableContradiction = status.storeDurable && status.storeBackend !== 'postgres';
    const placement = status.placement;
    const enablement = status.liveEnablement;
    // "the deployment asked for the check" and "the deployment can satisfy it" are the
    // two halves Part 19 refused to let a reader conflate, and this row is where that
    // distinction pays for itself: the ask lives in the policy block, the having in the
    // two booleans, and either source saying "wired" counts as wired.
    const confirmationAsked = placement?.policy['requireOperatorConfirmation'] === true;
    const confirmationHeld =
      status.operatorConfirmation === true || placement?.confirmationConfigured === true;
    const ageMs = view.checkedAtMs === null ? null : Math.max(0, Date.now() - view.checkedAtMs);
    return [
      {
        label: 'engine instance',
        value: status.instanceId === '' ? '(unnamed)' : status.instanceId,
        detail: `mode=${status.mode} dryRun=${String(status.dryRun)} commands=${status.commands.length}`,
        tone: 'neutral',
      },
      {
        label: 'durable store',
        value: status.storeDurable
          ? `durable (${status.storeBackend})`
          : `${status.store}, as configured`,
        tone: durableContradiction ? 'bad' : 'neutral',
        ...(durableContradiction
          ? {
              detail:
                'the engine claims a durable store without naming postgres as its backend - the worker refuses to forward into this state',
            }
          : {}),
      },
      {
        label: 'distributed locks',
        value: status.locksDistributed ? 'distributed' : 'in-process',
        tone: 'neutral',
      },
      {
        label: 'credential source',
        value:
          status.credentialFetcher === null
            ? status.credentialSource
            : `${status.credentialSource} via ${status.credentialFetcher}`,
        tone: status.credentialSource === 'none' ? 'neutral' : 'ok',
      },
      {
        label: 'operator confirmation',
        value: confirmationHeld
          ? 'verifier wired'
          : confirmationAsked
            ? 'asked for and absent'
            : 'not wired',
        tone: confirmationHeld ? 'ok' : confirmationAsked ? 'bad' : 'neutral',
        ...(confirmationAsked && !confirmationHeld
          ? {
              detail:
                'the placement policy requests an operator confirmation this process cannot satisfy; every order it reviews is refused for that reason',
            }
          : {}),
      },
      {
        label: 'live enablement',
        value:
          enablement === null
            ? 'not reported by this engine'
            : `${enablement.liveRefused ? 'refused' : 'not refused'}; ${enablement.missing.length} missing, ${enablement.satisfied.length} satisfied`,
        detail:
          enablement === null
            ? 'an engine predating Part 19 cannot grade itself; the answer is absent, not favourable'
            : enablement.missingCodes.join(', ') || undefined,
        // The tone law for this row is the one a reader is most likely to get wrong, so
        // it is written out: a refusal this build cannot configure away is the DESIGNED
        // state and reads neutral; a refusal with no hard blocker means live is one
        // configuration step away, which is worth a warning on any deployment that did not
        // plan for it; and no answer at all is a warning, because an engine too old to
        // grade itself has not graded anything in favour of live either.
        tone:
          enablement === null
            ? 'warn'
            : enablement.hardBlockersPresent
              ? 'neutral'
              : 'warn',
      },
      {
        label: 'incident sink',
        value:
          status.incidents === null
            ? 'not reported by this engine'
            : status.incidents.durable
              ? `durable (${status.incidents.sink})`
              : `${status.incidents.sink}, process-local`,
        tone: status.incidents === null ? 'warn' : status.incidents.durable ? 'ok' : 'neutral',
      },
      {
        label: 'instrumented',
        value: status.metricsConfigured ? '/metrics wired' : 'no exposition',
        tone: status.metricsConfigured ? 'ok' : 'warn',
      },
      {
        label: 'journal retention',
        value: status.retentionEnabled ? `on, ${status.retentionEventDays}d` : 'off',
        detail: `enablement evidence window ${status.enablementMaxAgeDays}d`,
        tone: 'neutral',
      },
      {
        label: 'placement review',
        value:
          placement === null
            ? 'not reported by this engine'
            : `${placement.label} via ${placement.attestorSource}`,
        tone: placement === null ? 'warn' : 'neutral',
      },
      ...(status.unmappedKeys.length > 0
        ? [
            {
              label: 'keys this build does not mirror',
              value: String(status.unmappedKeys.length),
              detail: `${status.unmappedKeys.join(', ')} - the engine is newer than the reader; the parity spec pins the difference`,
              tone: 'warn' as const,
            },
          ]
        : []),
      {
        // The same label as the failure branch, on purpose: a panel that keys on labels
        // should not have to know whether the read succeeded to find the age, and the
        // age is the one number that tells it the difference.
        label: 'engine last answered',
        value: ageMs === null ? 'no answer yet' : `${ageMs}ms since the engine answered`,
        tone: 'neutral',
      },
    ];
  }
}

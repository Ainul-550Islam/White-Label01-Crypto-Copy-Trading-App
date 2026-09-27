# The scrape bundle

The deployment side of the platform's telemetry: which process reads the exposition this
code already publishes, and which rules it may evaluate. Everything under `prometheus/` here
is generated from files elsewhere in the repository, so the two cannot disagree by accident.

## Generate and verify

```sh
python3 libs/trading-core/scripts/gen_observability_bundle.py --check
python3 libs/trading-core/scripts/gen_observability_bundle.py --emit
python3 libs/trading-core/scripts/gen_observability_bundle.py --catalog
python3 libs/trading-core/scripts/gen_observability_bundle.py --rules
```

`--check` is what CI runs and it writes nothing; exit 0 means the committed bundle matches a
fresh render, 1 means drift, 2 means an input this bundle depends on is missing or unreadable,
3 means the command itself was refused. `--emit` refuses to overwrite a file it did not
generate unless `--force` is passed, because a hand-edited artifact is a fact about somebody's
intent that a generator has no business destroying.

## Seeing the dashboard this format already has

```sh
curl -s http://127.0.0.1:9090/api/v1/query?query=up > /dev/null   # not run by this tool
curl -s http://execution-engine:8093/metrics \
  | python3 libs/trading-core/scripts/gen_observability_bundle.py \
      --dashboard execution-engine --from -
```

The second command is the whole `--dashboard` mode: exposition text in, the repository's own
dashboard document out, with the families a service registers but the scrape did not
contain listed as absent rather than as zero. Nothing synthesises a value, so an idle service renders as absent or
zero rather than healthy, and this tool never performs the curl itself.

## Deploy

```sh
docker compose -f docker-compose.yml -f docker-compose.observability.yml up -d prometheus
```

The extra file adds one service. It mounts this directory read-only, publishes 9090 on
127.0.0.1 only like Postgres and Redis publish theirs, and sets no lifecycle endpoint, so
changing the config means a restart - which is what makes a check that fails loudly worth
having.

## What is scraped

| service | port | path | note |
| --- | --- | --- | --- |
| `api` | 4000 | `${PROMETHEUS_PATH}` | token expanded from the deployment environment (28 `wlct_*` names in its source) |
| `trading-engine` | 8001 | `/metrics` | unauthenticated on the internal network (30 `wlct_*` names in its source) |
| `execution-engine` | 8093 | `/metrics` | unauthenticated on the internal network (23 `wlct_*` names in its source) |
| `market-data` | 8002 | `/metrics` | unauthenticated on the internal network (27 `wlct_*` names in its source) |

## What is not, and why

* `notification-service` - its source contains no GET /metrics route, so there is nothing to scrape (services/notification-service/app)
* `worker` - serves no port at all, so there is no target to scrape (docker-compose.yml: worker has neither expose nor ports)
* `admin-web` - its source contains no GET /metrics route, so there is nothing to scrape (apps/admin-web/src)

## Rules

4 of 24 catalog rules became Prometheus alerts:

* `SLO_BUDGET_EXHAUSTED` (CRITICAL) - `wlct_slo_error_budget_remaining_ppm <= 0`
  - registered help: Remaining error-budget ratio of the latest evaluation tick, ppm (0..1_000_000).
  - the catalog's unit `remaining_budget_ppm` is the family's name verbatim, so the threshold needs no conversion
  - the direction is `<=` because the condition says the remaining budget IS ZERO: a gauge that counts remaining budget fires downward, and `>` would alert on every healthy second of the platform's life
* `SLO_BURN_FAST` (CRITICAL) - `wlct_slo_burn_rate_ppm{window_kind="short"} > 14400000 and wlct_slo_burn_rate_ppm{window_kind="long"} > 14400000`
  - registered help: Burn-rate of the latest evaluation tick per window, ppm.
  - apps/api/src/modules/observability/slo.service.ts sets `wlct_slo_burn_rate_ppm` with `window_kind` short|long, and the rule's condition says the short window reached the fast multiplier AND the long window agrees - which is why the expression is an `and` over both
  - the catalog's unit is `burn_rate_ratio` while the family's registered help says `ppm`, so the threshold is multiplied by 1e6 and by nothing else
* `SLO_BURN_SLOW` (WARNING) - `wlct_slo_burn_rate_ppm{window_kind="short"} > 6000000 and wlct_slo_burn_rate_ppm{window_kind="long"} > 6000000`
  - registered help: Burn-rate of the latest evaluation tick per window, ppm.
  - the rule's condition says `both evaluation windows crossed the slow burn multiplier`, so the expression covers short and long exactly as written; the ppm law is the same one SLO_BURN_FAST uses
* `TELEMETRY_EXPORT_FAILING` (WARNING) - `wlct_tracing_export_consecutive_failures > 3`
  - registered help: Consecutive trace export failures (alert threshold at 3; reset by any success or deliberate skip).
  - apps/api/src/modules/observability/metrics.registry.provider.ts registers the family with the help text 'Consecutive trace export failures (alert threshold at 3; reset by any success or deliberate skip)'
  - the direction follows AlertRule's own docstring - `threshold` is the value the observation exceeded - so `>` even though the help text's prose says `at 3`; whether three failures or four are the trigger is the catalog's policy, not this file's

The rest stayed in the catalog. A rules file is where an invented number goes to look
official, so each refusal names what was missing:

* `AMBIGUOUS_EXECUTION` - no numeric threshold in the catalog (threshold: None)
* `DATASET_VALIDATION_FAILURES` - no numeric threshold in the catalog (threshold: None)
* `EXCHANGE_DISCONNECTED` - no numeric threshold in the catalog (threshold: None)
* `EXECUTION_QUEUE_BACKLOG` - no numeric threshold in the catalog (threshold: None)
* `EXECUTION_UNAVAILABLE` - no numeric threshold in the catalog (threshold: None)
* `KILL_SWITCH_ENGAGED` - no numeric threshold in the catalog (threshold: None)
* `MARKET_DATA_STALE` - no numeric threshold in the catalog (threshold: None)
* `ORDERBOOK_RESYNC_STORM` - no registered family in this tree exposes the unit the rule names
* `POSTGRES_UNAVAILABLE` - no numeric threshold in the catalog (threshold: None)
* `PROTECTION_TRIGGERED` - no numeric threshold in the catalog (threshold: None)
* `QUEUE_BACKLOG` - no numeric threshold in the catalog (threshold: None)
* `RATE_LIMIT_EXHAUSTION` - no numeric threshold in the catalog (threshold: None)
* `RECONCILIATION_DISCREPANCY` - no numeric threshold in the catalog (threshold: None)
* `REDIS_UNAVAILABLE` - no numeric threshold in the catalog (threshold: None)
* `REPEATED_ORDER_REJECTION` - no registered family in this tree exposes the unit the rule names
* `RISK_ENGINE_UNAVAILABLE` - no numeric threshold in the catalog (threshold: None)
* `RISK_SNAPSHOT_STALE` - no numeric threshold in the catalog (threshold: None)
* `SLO_TELEMETRY_GAP` - no numeric threshold in the catalog (threshold: None)
* `STRATEGY_ERROR_SPIKE` - no registered family in this tree exposes the unit the rule names
* `WORKER_FAILURE` - no numeric threshold in the catalog (threshold: None)

## Boundary

This bundle is not a monitoring product and it observes nothing. Nothing in the trading path
imports it, no rule here can change a risk decision or block a placement, and no file in this
directory contains a credential: `METRICS_TOKEN` appears only as an expansion. The durable
alert record, the SLO evaluation rows and the operations console stay where they were.
Prometheus is a reader. If it is switched off, nothing about trading changes, and the
difference between that and the platform going dark is exactly what `WLCTScrapeTargetDown`
is for.

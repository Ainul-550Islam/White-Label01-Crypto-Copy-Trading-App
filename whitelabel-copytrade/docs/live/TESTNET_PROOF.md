# Live testnet proof

How to prove, on demand and with evidence, that this platform can place, observe
and cancel a real order at Binance **Spot testnet**, and that the same build
refuses to do any of it on mainnet.

This document describes two things that must be read together:

* what is proven **offline**, on every CI run, with no credentials; and
* what is proven **live**, only when an operator opts in with a testnet key pair.

An offline run proves the wire contract. It does not prove a venue answered. Any
statement to the effect that "the platform has traded on testnet" needs the live
run, from a named commit, with the numbers below recorded.

---

## 1. What runs

| Suite | File | Credentials | Network |
| --- | --- | --- | --- |
| Round trip (replay + live class) | `libs/trading-core/tests/live_testnet/test_binance_testnet_roundtrip.py` | none for replay | none (replay) |
| Round trip under failure states | `libs/trading-core/tests/live_testnet/test_binance_roundtrip_replay.py` | none | none |
| Recorded venue bytes | `libs/trading-core/tests/live_testnet/fixtures/binance_testnet_roundtrip.json` | none | none |
| Mainnet refusal matrix | `libs/trading-core/tests/test_mainnet_refusal_matrix.py` | none | none |
| Engine submit-route gates | `services/execution-engine/tests/test_submit_route_gates.py` | none | none |
| API half of the round trip | `apps/api/src/modules/oms/oms-engine-roundtrip.spec.ts` | none | none |
| Orchestrator | `scripts/live-testnet-smoke.sh` | none for replay | none (replay) |

The three Python files above run under `pytest` with the library's own
`-m 'not live'` default, so a plain `pytest` never places an order.

---

## 2. Running it

### Offline (what CI does)

```
scripts/live-testnet-smoke.sh
```

Expected tail: `replay, gates and API proofs passed. The live round trip was NOT run`.

### Live (an operator, deliberately)

1. Create a Binance **Spot testnet** key at the testnet site's API-key page. The
   key must be **read + spot trade only**. Withdrawal permission must be off:
   the platform refuses withdrawal-capable keys at construction, at signature
   time, and in the pre-flight gate, so a key with withdrawals enabled fails the
   proof rather than being quietly tolerated.
2. Export the pair into the shell that will run the proof. Nothing else is
   needed; the suites read only these three variables.

   ```
   export BINANCE_TESTNET_API_KEY=...
   export BINANCE_TESTNET_API_SECRET=...
   export WLCT_LIVE_TESTNET=1
   ```

3. Run:

   ```
   scripts/live-testnet-smoke.sh --live
   ```

Expected tail: `replay, gates and API proofs passed, INCLUDING a live testnet round trip.`

The live order is a **resting LIMIT buy** priced far below the touch, cancelled
within the same test. It must not fill; the suite asserts
`filled_quantity == 0` and fails the proof if it did, because a proof that spends
testnet funds is a proof that can fail for the wrong reason.

### Refusals you should expect

| Situation | Result |
| --- | --- |
| `--live` with only one of the two variables | exit 2, before anything is placed |
| Key with withdrawal permission | the live suite fails on `can_withdraw is False` |
| Mainnet key | every request is refused by the harness origin check; the suite fails with `refuses to transmit` |
| Venue unreachable | `AdapterConnectionError` — the ambiguous class, never a rejection |

---

## 3. What each assertion proves

### 3.1 The replay (`test_binance_testnet_roundtrip.py`)

| Assertion | What it rules out |
| --- | --- |
| The signed query carries `symbol`, `side`, `type`, `timeInForce`, `quantity`, `price`, `newClientOrderId`, `newOrderRespType`, `timestamp`, `recvWindow`, and a signature over all of them | A partially signed request, which is how a swapped quantity gets through |
| `newClientOrderId` is the platform's deterministic id | A venue-side duplicate filling twice |
| `submitted_at_micros == 1760951641320000` (the recorded `transactTime`) | A local-clock substitute for the venue's own timestamp |
| `is_simulated is False` on the submit, poll and cancel results | A real order reported as paper (or the reverse) |
| The poll returns the venue's status and `0.00100000` / `20000.00000000` exactly | A float creeping into a price or quantity |
| The cancel is accepted, and the second cancel is a refusal with "no such open order" | An exception raised for an ordinary, already-cancelled order |
| The account snapshot has `can_trade: true`, `can_withdraw: false` | A key that is more dangerous than the money path needs |
| A `TimeoutError` from the transport raises the **ambiguous** class, not the rejection class | Conflating "the order may exist" with "the order does not exist" |
| A `-2010` venue error raises the **definitive** class with the venue's code | Retrying something the venue already refused |
| `fetch_key_restrictions` returns the venue's fields unfilled-in | A normaliser erasing "the venue did not say" |
| The user-stream `NEW` and `CANCELED` reports are **not** fills | Booking a phantom trade at price zero |
| The stream's `exchangeOrderId` equals the REST poll's | Two subsystems describing two different orders |
| Re-pointing the adapter's base URL at mainnet makes the harness refuse, with nothing recorded as sent | A proof run that silently places a production order |

### 3.2 The failure-state replay (`test_binance_roundtrip_replay.py`)

| Assertion | What it rules out |
| --- | --- |
| The same recording produces the same result twice | A decision that depends on wall-clock time or ordering |
| `-2010 Duplicate order sent` is definitive, and the request that got it carried our client id | A duplicate treated as ambiguous, and reconciled onto the wrong attempt |
| `-2013` is the only answer that means "absent" | An order treated as never placed when the venue simply could not be asked |
| HTTP 503 and a socket timeout both raise instead of returning absent | An orphan position created by a collapsed error |
| An unknown status string is a parse failure | A new venue state defaulted to FILLED (booking a position) or NEW (hiding one) |
| A fresh adapter with no symbol hint raises and names `register_symbol_hint` | A restart silently scanning (and missing) the order |
| A seeded hint makes the same query work, with the right `symbol` and `origClientOrderId` | A reconciliation path that cannot recover after a deploy |
| The hint map is bounded at 10 000 entries | A slow memory leak in a long-lived process |
| A `TRADE` report is a fill with exact decimals, commission and trade id | A fill recorded with rounded values or without its fee |
| On a cancellation, `clientOrderId` is the *cancel request's* id and `original_client_order_id` is the order's | A cancellation attached to an order that does not exist |
| The listen key never appears unmasked in a rendering | A bearer credential in a log |

### 3.3 The mainnet refusal matrix (`test_mainnet_refusal_matrix.py`)

Six layers, each refusing on its own:

1. **Configuration** — contradictory live switches raise; the defaults report
   `will_transmit_orders == False`; `recvWindow` above the venue cap raises.
2. **Wiring** — an empty runtime reports every missing prerequisite and renders a
   refusal ending "No order was sent and none will be."
3. **Credentials** — withdrawal-capable, expired, placeholder and short keys are
   refused, and the secret never appears in a message or a rendering.
4. **Pre-flight** — a live submission with every health input green is still
   refused when it is not authorised; stale or unknown risk state blocks; a paper
   order stays allowed.
5. **Adapter** — `is_simulated` is always `False`; mainnet is the default base and
   the testnet is opted into explicitly; a missing clock measurement is a refusal
   before any signature.
6. **Confirmation** — a missing, wrong-key, expired, wrong-tenant or
   out-of-scope operator confirmation is refused, and the right one is accepted
   (so the refusals are known to be specific).

### 3.4 The engine's submit route (`test_submit_route_gates.py`)

| Assertion | What it rules out |
| --- | --- |
| `EXECUTION_MODE=live` refuses to build a runtime, naming what is missing and ending "No order was sent and none will be." | A live boot that only looks refused |
| `/internal/v1/status` publishes `liveEnablement.liveRefused: true` with no field that reads as permission | A running process whose posture is unreadable |
| A non-simulated adapter makes the submit route answer 409 `SUBMISSION_REQUIRES_SIMULATED_RUNTIME`, leaving no order behind | A future wiring mistake becoming a real order |
| A missing or wrong internal token is 401; a tenant-header/body disagreement is 403; a missing tenant header is 400 `TENANT_HEADER_REQUIRED` | A money route reachable without its tenancy |
| `environment` is literally `PAPER` — `LIVE`, `live`, `TESTNET` and `""` are all 422 | A live order being expressible on this surface at all |
| A smuggled `apiKey` field, a missing `riskDecisionId`, a 37-character client id and a float quantity are 422 | Schema drift on the money path |
| The default dry run reports `transmitted: false` | A default that can spend |

### 3.5 The API's half (`oms-engine-roundtrip.spec.ts`)

| Assertion | What it rules out |
| --- | --- |
| Exact decimal strings survive the job receipt (`0.01000000`, `50000.00000000`, `0.00050000`) | Precision lost between the engine and the database |
| `isSimulated` is `true` only for a literal `true` | A paper fill presented as real |
| A non-plain-decimal quantity becomes `0`, never a float | Scientific notation reaching an order row |
| A `DUPLICATE` re-applies the original facts; a `DUPLICATE` with `UNKNOWN` state stays unknown | A redelivery overwriting a recorded fill |
| `DRY_RUN` is a rejection with code `DRY_RUN` and `wasDryRun` set | A dry run recorded as success |
| `REJECTED_BY_EXCHANGE` keeps the venue's `-2010` | A venue code replaced by a platform one |
| An unrecognised outcome is `unknown`, never a silent success | A new engine verdict treated as acceptance |
| A resting venue order is acknowledged with `7745219` and `filledQuantity: "0"` | A fill invented for an order that has not traded |

---

## 4. Recorded evidence

`binance_testnet_roundtrip.json` holds one complete round trip:

| Step | Request | Venue answer |
| --- | --- | --- |
| submit | `POST /api/v3/order` (LIMIT BUY, GTC, `0.00100000` @ `20000.00000000`) | `NEW`, `orderId 7745219`, `executedQty 0.00000000` |
| poll | `GET /api/v3/order?origClientOrderId=…` | `NEW`, same order id, `executedQty 0.00000000` |
| cancel | `DELETE /api/v3/order` | `CANCELED`, `executedQty 0.00000000` |
| cancel again | `DELETE /api/v3/order` | HTTP 400, `-2011 Unknown order sent.` |
| account | `GET /api/v3/account` | `canTrade true`, `canWithdraw false`, BTC `0.01000000` |
| key restrictions | `GET /sapi/v1/account/apiRestrictions` | `enableWithdrawals false`, `ipRestrict true` |
| user stream | `executionReport` ×2 | `NEW`, then `CANCELED`, both with zero filled quantity |

The recording contains no key material: the only token in it that looks like a
secret is a masked listen key, and the suites assert that the fixture's key pair
does not appear anywhere in it.

---

## 5. Observed results

Recorded from the runs that produced this batch, with the numbers the commands
printed:

| Command | Result |
| --- | --- |
| `pytest libs/trading-core/tests/live_testnet` | 32 passed, 2 skipped (the two live tests) |
| `pytest libs/trading-core/tests/test_mainnet_refusal_matrix.py` | 36 passed |
| `pytest services/execution-engine/tests/test_submit_route_gates.py` | 21 passed |
| `jest apps/api/src/modules/oms/oms-engine-roundtrip.spec.ts` | 19 passed |
| `pytest libs/trading-core/tests` (whole library) | 1837 passed, 2 skipped, plus two pre-existing repository-hygiene failures unrelated to this batch (a Batch 01 handover document naming an installer that is not in the tree, and `.env.example` not naming five compose-only variables) |
| `pytest services/execution-engine/tests` (whole service) | 547 passed, 12 skipped |
| `scripts/live-testnet-smoke.sh` | all four proofs passed; live half not run |

The **live** run has not been performed in this sandbox: there is no testnet key
here and no outbound network access to `testnet.binance.vision`. It is the
operator's step, and this section is where its evidence belongs when it is done:

```
commit:            <sha the run was made from>
date (UTC):        <yyyy-mm-dd hh:mm>
run by:            <operator>
order id:          <venue orderId from the submit response>
client order id:   <the id the run printed>
filled quantity:   0
cancel status:     CANCELED
key permissions:   read + spot, withdrawals disabled
result:            scripts/live-testnet-smoke.sh --live -> every proof passed
```

Until that block is filled in, the honest claim is: **the wire contract and every
refusal are proven; a venue has not answered in this environment.**

---

## 6. Rotating the testnet key

A testnet key is still a key: it can place orders, so it is rotated like one.

1. Create the replacement key on the testnet site, again read + spot only,
   withdrawals off, and an IP allow-list entry for the egress address that will
   run the proof.
2. Run the proof with the NEW pair in a fresh shell, before deleting the old one.
   The suite's `can_withdraw is False` assertion is what confirms the new key's
   permissions rather than the dashboard's description of them.
3. Delete the old key at the venue.
4. Update wherever the pair is stored for CI secrets — never in a file in this
   repository, and never in a document.
5. Record the rotation in the evidence block above (operator, date, order id), so
   "which key placed this order" is answerable later.

A key that has been used for a proof is not automatically revoked: the proof is
repeatable, and re-running it from a new commit with the same read-only key is
cheaper than a rotation ceremony. Rotate on exposure, on permission change, on
personnel change, or when the venue expires the key.

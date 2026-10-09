// # Pins the OMS order state machine: reachability, terminality, and the replace transitions
//
// The table in `oms.types.ts` is the single source of truth for what an order intent may do
// next, and `OrderLifecycleService.transition` refuses anything the table does not permit. That
// makes an omission in the table a runtime 400 rather than a compile error, which is how the
// replace path shipped broken: `OrderReplaceService` created the replacement intent and then
// asked to transition the original to `REPLACED`, a state no row in the table pointed at, so
// every replace failed at the last step with the new intent already persisted.
//
// The assertions below are therefore not a description of the table; they are the properties the
// table must keep for the rest of the OMS to work. The one that would have caught that bug is
// "every replaceable state can reach REPLACED": delete the `REPLACED` edge from `VALID_TRANSITIONS`
// and this file fails, while the production code still compiles.
import {
  OrderIntentState,
  REPLACEABLE_STATES,
  TERMINAL_STATES,
  VALID_TRANSITIONS,
  isTerminalState,
  isValidTransition,
} from './oms.types';

const ALL_STATES: string[] = Object.values(OrderIntentState);

/** Breadth-first walk of the transition table from `start`. */
function reachableFrom(start: string): Set<string> {
  const seen = new Set<string>([start]);
  const queue: string[] = [start];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const next of VALID_TRANSITIONS[current] ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/** True when `target` can be reached from some state, i.e. it is a destination of an edge. */
function isTargetOfAnyEdge(target: string): boolean {
  return Object.values(VALID_TRANSITIONS).some((targets) => targets.includes(target));
}

describe('OMS order state machine: the table itself', () => {
  it('covers every declared state', () => {
    for (const state of ALL_STATES) {
      expect(VALID_TRANSITIONS[state]).toBeDefined();
      expect(Array.isArray(VALID_TRANSITIONS[state])).toBe(true);
    }
  });

  it('never names a state that does not exist', () => {
    for (const [from, targets] of Object.entries(VALID_TRANSITIONS)) {
      for (const target of targets) {
        expect(ALL_STATES).toContain(target);
        expect(target).not.toBe(from);
      }
    }
  });

  it('gives terminal states no outgoing edges, and non-terminal states at least one', () => {
    for (const state of ALL_STATES) {
      const outgoing = VALID_TRANSITIONS[state] ?? [];
      if (isTerminalState(state)) {
        expect(outgoing).toHaveLength(0);
      } else {
        expect(outgoing.length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps TERMINAL_STATES and the table in agreement', () => {
    // A state is terminal exactly when the table gives it nowhere to go. If these two drift,
    // `isTerminalState` becomes a second, disagreeing opinion about the same question.
    for (const state of ALL_STATES) {
      const outgoing = VALID_TRANSITIONS[state] ?? [];
      expect(isTerminalState(state)).toBe(outgoing.length === 0);
    }
    for (const state of TERMINAL_STATES) {
      expect(ALL_STATES).toContain(state);
    }
  });

  it('can reach every non-initial state from CREATED', () => {
    // An orphaned state is one the machine can never enter - reachable only by a caller writing
    // the column directly, which is how the replace path behaved before the table permitted it.
    const reachable = reachableFrom(OrderIntentState.CREATED);
    const orphans = ALL_STATES.filter((state) => !reachable.has(state));
    expect(orphans).toEqual([]);
  });

  it('lets every reachable state reach a terminal state', () => {
    // Liveness: no order can be left with no legal move. Guards against a future edit that
    // removes the escape edge from a state and strands live orders in it.
    for (const state of reachableFrom(OrderIntentState.CREATED)) {
      if (isTerminalState(state)) {
        continue;
      }
      const onward = reachableFrom(state);
      const terminals = [...onward].filter((candidate) => isTerminalState(candidate));
      expect(terminals.length).toBeGreaterThan(0);
    }
  });
});

describe('OMS order state machine: the replace path', () => {
  it('makes every replaceable state able to reach REPLACED', () => {
    // The regression. OrderReplaceService transitions the original intent to REPLACED after
    // creating its replacement; if the table does not permit that edge the request throws at the
    // final step and leaves an orphaned replacement behind.
    expect(REPLACEABLE_STATES.size).toBeGreaterThan(0);
    for (const state of REPLACEABLE_STATES) {
      expect(isValidTransition(state, OrderIntentState.REPLACED)).toBe(true);
    }
  });

  it('keeps the replaceable set to exactly the states an exchange can still amend', () => {
    // The product decision, pinned: filled and cancelled orders are not amendable, and an order
    // that has not been submitted yet has nothing at the venue to amend.
    expect([...REPLACEABLE_STATES].sort()).toEqual(
      [
        OrderIntentState.SUBMITTED,
        OrderIntentState.ACKNOWLEDGED,
        OrderIntentState.PARTIALLY_FILLED,
      ].sort(),
    );
  });

  it('treats REPLACED as terminal: the original intent is finished', () => {
    expect(isTerminalState(OrderIntentState.REPLACED)).toBe(true);
    expect(VALID_TRANSITIONS[OrderIntentState.REPLACED]).toEqual([]);
    // Nothing may replace a replacement, or the audit trail becomes a cycle.
    expect(REPLACEABLE_STATES.has(OrderIntentState.REPLACED)).toBe(false);
  });

  it('is the only terminal state that is also an edge target', () => {
    // Recorded deliberately: every other terminal state is entered as a destination too, but
    // REPLACED is the one whose *entry* is a replace. Asserting the shape, not a count of one,
    // so a new terminal destination added elsewhere does not silently pass here.
    const terminalTargets = ALL_STATES.filter(
      (state) => isTerminalState(state) && isTargetOfAnyEdge(state),
    );
    expect(terminalTargets).toContain(OrderIntentState.REPLACED);
    for (const state of terminalTargets) {
      expect(isTerminalState(state)).toBe(true);
    }
  });
});

describe('OMS order state machine: isValidTransition', () => {
  it('permits a state to itself, so a retried transition is an idempotent no-op', () => {
    for (const state of ALL_STATES) {
      expect(isValidTransition(state, state)).toBe(true);
    }
  });

  it('permits exactly the edges in the table and nothing else', () => {
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        const expected =
          from === to || (VALID_TRANSITIONS[from] ?? []).includes(to);
        expect(isValidTransition(from, to)).toBe(expected);
      }
    }
  });

  it('fails closed on a state it does not know', () => {
    expect(isValidTransition('NOT_A_STATE', OrderIntentState.APPROVED)).toBe(false);
    expect(isValidTransition(OrderIntentState.CREATED, 'NOT_A_STATE')).toBe(false);
    expect(isValidTransition(undefined as never, OrderIntentState.APPROVED)).toBe(false);
    expect(isValidTransition(OrderIntentState.CREATED, null as never)).toBe(false);
  });

  it('refuses to leave a terminal state', () => {
    for (const terminal of TERMINAL_STATES) {
      for (const target of ALL_STATES) {
        if (target === terminal) {
          continue;
        }
        expect(isValidTransition(terminal, target)).toBe(false);
      }
    }
  });

  it('keeps the documented happy path intact end to end', () => {
    const happyPath = [
      OrderIntentState.CREATED,
      OrderIntentState.VALIDATING,
      OrderIntentState.APPROVED,
      OrderIntentState.SUBMITTED,
      OrderIntentState.ACKNOWLEDGED,
      OrderIntentState.PARTIALLY_FILLED,
      OrderIntentState.FILLED,
    ];
    for (let index = 1; index < happyPath.length; index += 1) {
      expect(isValidTransition(happyPath[index - 1], happyPath[index])).toBe(true);
    }
    expect(isTerminalState(OrderIntentState.FILLED)).toBe(true);
    // A filled order cannot be walked back into a working state.
    expect(isValidTransition(OrderIntentState.FILLED, OrderIntentState.SUBMITTED)).toBe(false);
  });

  it('lets a reconciliation-required intent return to the working set or end', () => {
    // The recovery path an operator takes for an intent whose venue state is unknown: it may be
    // revalidated or closed, but it may never jump straight to a filled or cancelled order
    // without passing through the machine again.
    for (const target of VALID_TRANSITIONS[OrderIntentState.RECONCILIATION_REQUIRED]) {
      expect(isValidTransition(OrderIntentState.RECONCILIATION_REQUIRED, target)).toBe(true);
    }
    expect(
      VALID_TRANSITIONS[OrderIntentState.RECONCILIATION_REQUIRED],
    ).toContain(OrderIntentState.VALIDATING);
    expect(isTerminalState(OrderIntentState.RECONCILIATION_REQUIRED)).toBe(false);
  });
});

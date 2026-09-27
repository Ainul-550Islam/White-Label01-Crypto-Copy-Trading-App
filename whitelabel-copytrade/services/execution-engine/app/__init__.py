"""Execution engine: the trading worker's execution core as a service.

The platform's only holder of the money path's runtime - it composes
``wlct_trading.execution`` (engine, locks, incidents, reconciliation) with
the mode switches that decide whether anything may reach a venue at all.
It exists because the API deliberately cannot talk to exchanges (no signer,
no credentials, no adapters - see ``execution.module.ts``); this process is
where those live, and the Node worker forwards TRADE_EXECUTION jobs here.

This build serves the simulated venue. Live transmission is refused at
startup until the durable store, distributed locks and credential provider
are wired (documented in docs/PART11_WORKER_SCALING.md), and no
configuration value can talk the process into it: the refusal is code, not
a default.
"""

__version__ = "1.0.0"

"""The RLS enablement surface (Part 15): audit the deployment's isolation.

One route, read-only by construction, on the same internal plane as the
rest: same token, same tenant-header match, absent from anything the public
API proxies. The verb is "look", so there is no apply switch here - Part
14's ``EXECUTION_RETENTION_ENABLED`` guard exists because a DELETE needs two
yeses, and adding a feature flag to a SELECT would be theatre that still has
to be documented, tested and defaulted.

Two refusals are worth naming, because both are the endpoint saying
something the operator needs to hear rather than an error:

* ``409 RETENTION_NO_DURABLE_STORE`` (the same code Part 14 uses, reused
  deliberately): a memory-backend runtime has no Postgres roles, no
  policies, no tables - it has nothing to verify, and answering "PASS, 4
  tables isolated" would be the single most misleading success on this
  platform.
* ``400`` on a table name outside the probe allow-list, or on a
  ``coveredExpected`` the core law rejects: the request body is not where an
  audit's scope gets decided.

A ``FAIL`` grade is NOT an HTTP error, and that is the most important
sentence in this file. The audit ran: its answer is the finding, and
reporting it as 500 would hide the evidence under the transport, break
curl-based CI that reads the body, and tempt somebody into making the probe
"tolerant". Transport failures (5xx) mean "no evidence at all", which is a
different fact with a different remedy.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from wlct_trading.enablement import EnablementError, probe_is_consistent

from app.config import get_settings
from app.rls_probe import ProbeRoleUnknown, ProbeUnknownTable, run_enablement_probe
from app.schemas import (
    EnablementAuditResponse,
    EnablementProbeView,
    EnablementRequest,
    EnablementRoleView,
)
from app.security import ServiceCaller, require_internal_auth, require_tenant_match

router = APIRouter(prefix="/internal/v1", tags=["enablement"])

AuthDep = Annotated[ServiceCaller, Depends(require_internal_auth)]


@router.post(
    "/enablement/audit",
    response_model=EnablementAuditResponse,
    response_model_by_alias=True,
)
async def enablement_audit(
    body: EnablementRequest,
    caller: AuthDep,
    request: Request,
) -> EnablementAuditResponse:
    """Count, compare, grade: are the Part 11 policies on, forced, and
    actually isolating - for the tables this service can see?"""
    require_tenant_match(body.tenant_id, caller)
    pool: Any = getattr(request.app.state, "store_pool", None)
    if pool is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "RETENTION_NO_DURABLE_STORE",
                "message": (
                    "row-level security is a database property and this runtime's "
                    "store is process memory: there are no policies here to verify. "
                    "Configure EXECUTION_STORE_BACKEND=postgres "
                    "(docs/PART13_DURABLE_STORE.md), or audit the real database with "
                    "scripts/rls-enablement.mjs --check-rls."
                ),
            },
        )
    settings = get_settings()
    try:
        audit = await run_enablement_probe(
            pool,
            body.tenant_id,
            settings.enablement_policy,
            seed_counts=body.seed_counts,
            covered_expected=body.covered_expected,
        )
    except (ProbeUnknownTable, EnablementError) as refused:
        # Both are "your request asked for an audit that cannot be graded":
        # a table outside the allow-list, or a coverage number the core law
        # refuses. 400, not retried, and the text names the knob to fix.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "ENABLEMENT_REQUEST_REFUSED",
                "message": f"{refused} (docs/PART15_RLS_ENABLEMENT.md)",
            },
        ) from None
    except ProbeRoleUnknown as unknown:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "ENABLEMENT_ROLE_UNKNOWN",
                "message": (
                    f"{unknown} - grant this role SELECT on pg_roles (Part 11's "
                    "grant.sql does) and run again; an audit that cannot read the "
                    "bypass flag is not an audit"
                ),
            },
        ) from None
    # The grade is data, not a status code: see the module docstring. The
    # fields are assembled explicitly (never `**body` from a dict) so a key
    # that stops existing is a TypeError at import-time-ish test run, not a
    # silently-absent field in an operator's evidence.
    return EnablementAuditResponse(
        ran_at_us=audit.ran_at_us,
        grade=audit.grade,
        full_platform=audit.full_platform,
        engine_plane_complete=audit.engine_plane_complete,
        probed=len(audit.probes),
        role=EnablementRoleView(
            rolname=audit.role.rolname,
            bypassrls=audit.role.bypassrls,
            superuser=audit.role.superuser,
        ),
        summary=audit.summary,
        probes=[
            EnablementProbeView(
                table=probe.table,
                policy_exists=probe.policy_exists,
                rls_enabled=probe.rls_enabled,
                rls_forced=probe.rls_forced,
                scoped_rows=probe.scoped_rows,
                bare_rows=probe.bare_rows,
                seeded_expected_rows=probe.seeded_expected_rows,
                absent=probe.absent,
                grade=probe_is_consistent(probe),
                skip_reason=probe.skip_reason,
            )
            for probe in audit.probes
        ],
    )

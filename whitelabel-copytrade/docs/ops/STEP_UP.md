# Responsibility: document the backend step-up verification contract and the process for extending protected actions.

# Step-up authentication

Step-up verification adds a short-lived proof for sensitive operations. It supplements normal access-token authentication; it does not replace it. The server obtains tenant, user, session, and device identity from the authenticated session and does not accept those identifiers from the verification request.

## Actions requiring a fresh proof

- Exchange-key rotation, revocation, and exchange-account disablement.
- Two-factor disablement and recovery-code regeneration.
- API-key creation and revocation.
- Payout creation and approval.
- Custody address issuance and custody sweep.

Each grant is bound to one tenant, user, session, device fingerprint, and exact `StepUpAction`. A grant for one action, device, tenant, or session cannot authorize another. The Redis TTL is configured by `STEP_UP_TTL_SECONDS` (default 300 seconds; accepted range 60–900). Redis or session-state failures are treated as no proof.

## API contract

- `POST /v1/auth/step-up/verify` accepts exactly one credential appropriate to `method`: `TOTP` with `code`, `PASSWORD` with `password`, or `RECOVERY_CODE` with `recoveryCode`; it also requires the exact `action` string. Unknown properties are rejected by the global validation pipe. The route uses the authenticated actor, existing password/TOTP/recovery-code implementations, existing lockout controls, and a five-request-per-minute authenticated-user throttle.
- `GET /v1/auth/step-up/status?action=<StepUpAction>` returns `fresh`, `action`, and `expiresAt`. Without an action it reports no action-specific proof.
- A protected route without a matching fresh proof returns HTTP 403 and `code: "STEP_UP_REQUIRED"` with the `action` that must be verified. Clients should prompt for a supported verification method and repeat the operation only after verification succeeds.
- Verification outcomes and protected-route allow/deny decisions are written to the audit log. Credential values are never included in audit metadata.

The shared action union is in `packages/shared-types/src/step-up.ts`. To add an action: add it to that union, attach `@RequireStepUp(action)` to the exact sensitive handler, add the route to the action-coverage test in `step-up.controller.spec.ts`, and document the new user-facing behavior here. The global `StepUpGuard` must remain registered in `AppModule`; do not rely on decorator metadata without the guard.

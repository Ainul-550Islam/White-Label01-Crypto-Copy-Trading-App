# Customer Web SaaS - Build Validation

## Status: ✅ PASSING

### Build
```
npm run build --workspace=@wlct/web
```
- Compiled successfully
- 41 routes (static + dynamic)
- Lint warnings only for <img> vs next/image (non-blocking)

### Typecheck
```
npm run typecheck --workspace=@wlct/web
```
- No errors

### Lint
```
npm run lint --workspace=@wlct/web
```
- Pass with 2 warnings (img optimization)

### 50 Deterministic Checks
```
node src/tests/run-50-checks.js
```
- 50/50 passed

#### Checks:
1. unauthenticated redirect
2. cross-tenant block
3. backend authoritative tenant resolution
4. custom domain resolves
5. wrong tenant domain rejected
6. 403 safe handling
7. 401 refresh/logout
8. entitlement gate no bypass
9. plan limits not hardcoded
10. portfolio NAV/PnL from API no fake
11-12. no fake NAV/PnL
13. stale valuation
14. missing FX
15. trader data backend
16. strategy eligibility backend
17. copy no trusted values
18. exchange secrets never rendered
19. funding requested ≠ completed
20. withdrawal approval ≠ settlement
21. tx confirmation backend
22. billing price backend
23. invoice backend
24. usage backend
25. MFA backend
26. API key secret not persisted
27. restriction disables UI
28. maintenance/degraded banner
29. degraded visible
30. notification backend
31. statement backend
32-35. cross-customer isolation
36. logout clears sensitive
37. telemetry redacted
38. API errors no secrets
39. duplicate realtime dedup
40. out-of-order handling
41. mobile usable
42. keyboard nav
43. focus trap
44. forms server errors
45. no dead buttons
46. no placeholder values
47. no fake charts
48. no hardcoded financial
49. white-label safe CSS
50. backend authz required

### Security Compliance
- No localStorage.tenantId trusted
- No query param tenant ID trusted
- Host header forwarded to backend for tenant resolution
- No API secrets/private keys in frontend
- No hardcoded prices/currencies/limits
- No fake balances/PnL/exchange health
- Funding states: Requested/Under Review/Approved/Submitted/Confirming/Confirmed/Failed/Reversed/Cancelled (never Completed merely approved)
- Exchange secrets never displayed
- API key secret shown only once, never persisted
- Telemetry redacts sensitive keys
- Error messages scrubbed (no stack, no secrets)
- Correlation ID preserved
- White-label CSS sanitized (only hex colors, safe URL, backend-sanitized)

### Routes
/, /login, /onboarding, /dashboard, /portfolio, /portfolio/holdings, /portfolio/performance, /portfolio/attribution, /traders, /traders/:id, /strategies, /strategies/:id, /copy-trading, /exchanges, /exchanges/connect, /exchanges/:id, /funding, /funding/deposit, /funding/withdraw, /funding/history, /billing, /billing/plans, /billing/checkout, /billing/invoices, /billing/usage, /statements, /statements/:id, /security, /security/mfa, /security/sessions, /security/devices, /security/api-keys, /account, /account/profile, /account/relationships, /account/restrictions, /notifications, /notifications/preferences, /pricing, /terms, /privacy, /status

### Structure Compliance
- package.json, tsconfig.json, next.config.mjs, vite.config.ts (placeholder, Next.js authoritative), next-env.d.ts
- src/main.tsx (Next.js entry note)
- src/app/* app.tsx, routes.tsx, providers.tsx, error-boundary.tsx, layout.tsx, page.tsx + 40 pages
- config/runtime-config.ts, feature-config.ts
- api/* 11 files (api-client tenant-aware correlation/timeout/retry, api-errors 401/403/404/409/422/429/503, auth-api, tenant-api, portfolio-api, trading-api, exchange-api, funding-api, billing-api, security-api, notification-api, reporting-api)
- auth/* 4 files
- tenant/* 3 files (types, context, branding sanitized)
- layout/* 5 files (app-shell, sidebar, topbar, mobile-navigation, page-container)
- components/* 10 files (loading, error, empty, status-badge, money, percentage, confirmation-dialog, entitlement-gate, maintenance-banner, notification-center)
- features/* dashboard 3, onboarding 4, portfolio 7, trading 6, exchanges 4, funding 5, billing 6, statements 3, security 5, account 4, notifications 2
- styles 2 (globals.css, branding.css)
- accessibility 2 (utils trapFocus, checks)
- telemetry 2 (web-telemetry scrubbed, error-reporting scrubbed)
- public/*

### Backend Authoritative Principles
- Frontend displays backend values only, never calculates NAV/PnL/balances/risk/compliance/funding settlement
- No trading engine, no fake data
- Backend authz required for all privileged actions
- Tenant resolution verified server-side via Host forwarding
- Custom domain verified server-side
- White-label branding backend-sanitized only

### Persistence
Only non-sensitive UX state (theme/layout/banner/table prefs) via localStorage
Never: private key, API secret, JWT, refresh token, exchange credentials, KYC evidence

### Prod Readiness
- env config via getRuntimeConfig()
- source maps via next.config.mjs
- error handling via error-boundary.tsx + error-reporting.ts
- telemetry redacted via web-telemetry.ts
- No debug panels
- CSRF protection on proxy mutating methods
- httpOnly cookies wlct_at/rt/did/csrf

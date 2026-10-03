/**
 * Role Based Access Control contracts.
 *
 * Roles are data (rows in the `Role` table) so tenants can define custom roles,
 * but the platform ships a fixed set of system roles that cannot be deleted.
 * Authorization decisions are always made against *permissions*, never against
 * role names, which is what allows new roles to be introduced without touching
 * guards or controllers.
 */

export enum SystemRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  TENANT_ADMIN = 'TENANT_ADMIN',
  TRADER = 'TRADER',
  FOLLOWER = 'FOLLOWER',
  SUPPORT = 'SUPPORT',
  FINANCE = 'FINANCE',
  COMPLIANCE = 'COMPLIANCE',
}

/** Scope at which a role may be granted. */
export enum RoleScope {
  PLATFORM = 'PLATFORM',
  TENANT = 'TENANT',
}

/**
 * Permission strings follow `resource:action`. Wildcards are supported on the
 * action segment (`tenant:*`) and globally (`*`) for the platform super admin.
 *
 * One exception, introduced with Part 5 and enforced by `permissionMatches`:
 * a small set of permissions that move real money or disarm a safety control
 * are excluded from action wildcards. See `NON_WILDCARD_PERMISSIONS`.
 */
export enum Permission {
  ALL = '*',

  // Platform level
  PLATFORM_MANAGE = 'platform:manage',
  PLATFORM_READ_METRICS = 'platform:read_metrics',
  PLATFORM_IMPERSONATE = 'platform:impersonate',

  // Tenants
  TENANT_CREATE = 'tenant:create',
  TENANT_READ = 'tenant:read',
  TENANT_UPDATE = 'tenant:update',
  TENANT_DELETE = 'tenant:delete',
  TENANT_SUSPEND = 'tenant:suspend',
  TENANT_BRANDING_READ = 'tenant_branding:read',
  TENANT_BRANDING_UPDATE = 'tenant_branding:update',
  TENANT_SETTINGS_READ = 'tenant_settings:read',
  TENANT_SETTINGS_UPDATE = 'tenant_settings:update',
  TENANT_DOMAIN_MANAGE = 'tenant_domain:manage',

  // Users
  USER_CREATE = 'user:create',
  USER_READ = 'user:read',
  USER_UPDATE = 'user:update',
  USER_DELETE = 'user:delete',
  USER_SUSPEND = 'user:suspend',
  USER_ASSIGN_ROLE = 'user:assign_role',
  USER_RESET_PASSWORD = 'user:reset_password',
  USER_READ_SESSIONS = 'user:read_sessions',
  USER_REVOKE_SESSIONS = 'user:revoke_sessions',

  // RBAC
  ROLE_CREATE = 'role:create',
  ROLE_READ = 'role:read',
  ROLE_UPDATE = 'role:update',
  ROLE_DELETE = 'role:delete',
  PERMISSION_READ = 'permission:read',

  // Billing
  PLAN_READ = 'plan:read',
  PLAN_MANAGE = 'plan:manage',
  SUBSCRIPTION_READ = 'subscription:read',
  SUBSCRIPTION_MANAGE = 'subscription:manage',
  INVOICE_READ = 'invoice:read',
  PAYOUT_MANAGE = 'payout:manage',

  // Feature flags
  FEATURE_FLAG_READ = 'feature_flag:read',
  FEATURE_FLAG_MANAGE = 'feature_flag:manage',

  // Compliance / audit
  AUDIT_LOG_READ = 'audit_log:read',
  SECURITY_EVENT_READ = 'security_event:read',
  KYC_READ = 'kyc:read',
  KYC_REVIEW = 'kyc:review',

  // Trading domain (enforced from Part 2, declared now so policies are stable)
  EXCHANGE_ACCOUNT_READ = 'exchange_account:read',
  EXCHANGE_ACCOUNT_MANAGE = 'exchange_account:manage',
  STRATEGY_READ = 'strategy:read',
  STRATEGY_MANAGE = 'strategy:manage',
  COPY_SUBSCRIPTION_READ = 'copy_subscription:read',
  COPY_SUBSCRIPTION_MANAGE = 'copy_subscription:manage',
  ORDER_READ = 'order:read',
  ORDER_MANAGE = 'order:manage',
  POSITION_READ = 'position:read',
  PORTFOLIO_READ = 'portfolio:read',
  REPORT_READ = 'report:read',
  SUPPORT_TICKET_READ = 'support_ticket:read',
  SUPPORT_TICKET_MANAGE = 'support_ticket:manage',
  NOTIFICATION_SEND = 'notification:send',

  // ---------------------------------------------------------------------
  // Part 5 - authenticated execution
  // ---------------------------------------------------------------------
  // Separated from the Part 2 trading permissions on purpose. `order:read`
  // lets a follower see their own order history; `execution:submit` lets a
  // caller push a signed request at a real exchange with real money behind it.
  // Collapsing those into one permission is how a support agent ends up able
  // to trade.

  /** View execution pipeline state: engine health, gates, latency observations. */
  EXECUTION_READ = 'execution:read',
  /** Submit an order through the execution engine. Never granted to SUPPORT. */
  EXECUTION_SUBMIT = 'execution:submit',
  /** Cancel a working order. Separate from submit: cancelling is risk-reducing. */
  EXECUTION_CANCEL = 'execution:cancel',

  /** Read the immutable order event / audit trail for an order. */
  ORDER_EVENT_READ = 'order_event:read',
  /** Read normalised fills. */
  FILL_READ = 'fill:read',

  /** Read venue balances as last observed. */
  BALANCE_READ = 'balance:read',
  /** Force a balance refresh against the venue. Costs rate-limit weight. */
  BALANCE_REFRESH = 'balance:refresh',

  /** Run a credential check against the venue for an exchange account. */
  EXCHANGE_ACCOUNT_VERIFY = 'exchange_account:verify',
  /** Replace the stored credential or its secret-manager pointer. */
  EXCHANGE_ACCOUNT_ROTATE_CREDENTIALS = 'exchange_account:rotate_credentials',
  /**
   * Arm live trading on one account. The single most dangerous permission in
   * the platform: it is the human half of the LIVE_TRADING_ENABLED gate.
   * Excluded from wildcards.
   */
  EXCHANGE_ACCOUNT_ENABLE_LIVE = 'exchange_account:enable_live',

  /** Observe private user-data stream session health. */
  PRIVATE_STREAM_READ = 'private_stream:read',
  /** Start, stop or force-reconnect a private user-data stream. */
  PRIVATE_STREAM_MANAGE = 'private_stream:manage',

  /** Read reconciliation runs and their discrepancies. */
  RECONCILIATION_READ = 'reconciliation:read',
  /** Trigger an out-of-band reconciliation pass for an account. */
  RECONCILIATION_TRIGGER = 'reconciliation:trigger',
  /**
   * Mark a discrepancy as accepted after human review. This is the only way a
   * disagreement between local state and the venue is ever closed - the
   * service itself never silently repairs one. Excluded from wildcards.
   */
  RECONCILIATION_RESOLVE = 'reconciliation:resolve',

  /** Read execution incidents. */
  EXECUTION_INCIDENT_READ = 'execution_incident:read',
  /** Close an execution incident with a resolution note. */
  EXECUTION_INCIDENT_RESOLVE = 'execution_incident:resolve',

  /** Read kill switch state. */
  KILL_SWITCH_READ = 'kill_switch:read',
  /**
   * Engage or release a kill switch. Engaging is always allowed to anyone
   * holding this; the danger is releasing one, which is why it is excluded
   * from wildcards.
   */
  KILL_SWITCH_OPERATE = 'kill_switch:operate',

  // ---------------------------------------------------------------------
  // Part 6 - strategy layer
  // ---------------------------------------------------------------------
  // `strategy:read` and `strategy:manage` already existed and keep their
  // Part 2 meaning: the catalogue and the strategy record. The permissions
  // below are about the running instance, because reading a strategy's
  // definition and starting it against a live market feed are not the same
  // act and must not be grantable with one click.
  //
  // None of these can enable live trading. Enabling an instance makes it emit
  // signals; whether a signal becomes an order is still decided by the risk
  // engine and the Part 5 execution gates.

  /** Read published strategy versions and their parameter schemas. */
  STRATEGY_VERSION_READ = 'strategy_version:read',

  /** Read strategy instances: configuration, health, run history. */
  STRATEGY_INSTANCE_READ = 'strategy_instance:read',
  /** Create an instance or change its configuration. Does not start it. */
  STRATEGY_INSTANCE_MANAGE = 'strategy_instance:manage',
  /**
   * Start an instance so it begins consuming market data and emitting signals.
   * Excluded from wildcards: `strategy_instance:*` granted to let someone tidy
   * up configuration must not also let them put a strategy into production.
   */
  STRATEGY_INSTANCE_ENABLE = 'strategy_instance:enable',
  /**
   * Stop an instance. Deliberately NOT excluded from wildcards and granted
   * widely: stopping a strategy is risk-reducing, and a permission check is
   * the wrong thing to be arguing with while something misbehaves.
   */
  STRATEGY_INSTANCE_DISABLE = 'strategy_instance:disable',

  /** Read strategy incidents. */
  STRATEGY_INCIDENT_READ = 'strategy_incident:read',
  /** Close a strategy incident with a resolution note. */
  STRATEGY_INCIDENT_RESOLVE = 'strategy_incident:resolve',

  /** Read strategy engine counters and latency observations. */
  STRATEGY_METRICS_READ = 'strategy_metrics:read',

  /** Read backtest runs and their results. */
  BACKTEST_READ = 'backtest:read',
  /** Submit a backtest. Touches no venue; it replays stored data. */
  BACKTEST_SUBMIT = 'backtest:submit',

  /** Read paper trading sessions and their simulated portfolios. */
  PAPER_SESSION_READ = 'paper_session:read',
  /** Start or stop a paper session. Simulated fills only, never a venue. */
  PAPER_SESSION_OPERATE = 'paper_session:operate',

  // ---------------------------------------------------------------------
  // Part 7 - historical datasets
  //
  // Datasets are public market data: no user funds, no credentials, no
  // orders. The write permissions are about STORAGE INTEGRITY and AVAIL-
  // ABILITY, which is why they are graded the way they are:
  //
  //   * read   - what exists, is it valid, what covers my window;
  //   * ingest - queue an ingestion job (bounded storage work);
  //   * validate - queue a re-validation of a version;
  //   * quarantine - withdraw a version from use (risk-reducing, so wild-
  //     cards may grant it, like strategy_instance:disable);
  //   * archive - retire a version (excluded from wildcards: it removes a
  //     reproducibility resource others may still be citing in results).
  //
  // None of these can enable live trading, and no dataset permission can
  // mutate the payload of a VALIDATED version - that is enforced in the
  // service layer, not merely in these names.

  /** Read dataset metadata, versions, validation reports and coverage. */
  DATASET_READ = 'dataset:read',
  /** Queue a historical ingestion job. Storage and bandwidth, no venue calls. */
  DATASET_INGEST = 'dataset:ingest',
  /** Queue a re-validation of a dataset version. Read-only over the bytes. */
  DATASET_VALIDATE = 'dataset:validate',
  /** Withdraw a dataset version from normal replay use. */
  DATASET_QUARANTINE = 'dataset:quarantine',
  /** Retire a dataset version. Never deletes payload data. */
  DATASET_ARCHIVE = 'dataset:archive',

  // ---------------------------------------------------------------------------
  // Part 8: the risk engine's control surface.
  //
  // The shape deliberately mirrors the execution permissions: reading risk
  // state is safe and wide, changing limits is narrow and explicit, and
  // disarming protection is narrowest of all. There is no permission that
  // approves an order - that verdict belongs to the engine's rule table and
  // nothing in the API can overrule it.
  // ---------------------------------------------------------------------------

  /** Read risk status, snapshots, limits, exposure, events and PnL summaries. */
  RISK_READ = 'risk:read',
  /** Publish a new versioned risk-limit configuration. Tighten freely; the
   *  service still validates domain and hierarchy, never blind-widens. */
  RISK_CONFIG_UPDATE = 'risk:config:update',
  /** Engage or release kill switches on the risk surface (the Part 5
   *  KILL_SWITCH_OPERATE still governs the execution-admin route; the two
   *  write the same durable rows, and this permission exists so a tenant can
   *  hand the *risk* console its own narrow grant). */
  RISK_KILL_SWITCH_UPDATE = 'risk:kill_switch_update',
  /** Clear or acknowledge an automatic-protection trip. Separate from
   *  RISK_KILL_SWITCH_UPDATE because releasing a PROTECTION - a halt the
   *  engine imposed on itself after a breach - deserves its own name on an
   *  audit line and its own role on the org chart. */
  RISK_PROTECTION_CLEAR = 'risk:protection_clear',

  // ---------------------------------------------------------------------------
  // Operations / observability (Part 9)
  //
  // Reading the operations panel is deliberately broad; mutating an alert is
  // narrow and explicit, because force-resolving an alert is dismissing
  // operational evidence. There is no permission that disables observability
  // at runtime (that is a redeploy decision enforced by env validation) and
  // none that approves trading: readiness reports, the risk gate decides.
  // ---------------------------------------------------------------------------

  /** Read health, trading readiness, alerts, incidents and the panel
   *  documents. Never grants the metrics scrape endpoint itself: /metrics is
   *  a machine surface secured by METRICS_TOKEN and network isolation. */
  OPERATIONS_READ = 'operations:read',
  /** Acknowledge or force-resolve an operational alert. */
  OPERATIONS_ALERTS_UPDATE = 'operations:alerts_update',

  // ---------------------------------------------------------------------------
  // Part 10: reliability (SLO definitions, evaluations, tracing posture).
  //
  // Only one write permission exists here, and it writes OBJECTIVES, never
  // outcomes: an SLO states what operators expect of the platform; it can
  // never authorise a trade. Reads ride OPERATIONS_READ (the SLO panel is
  // part of the operations panel); evaluation rows are machine-written by
  // the maintenance job and manual evaluation ticks are audited.
  // ---------------------------------------------------------------------------

  /** Publish a new versioned SLO definition (or disable one). Mirrors the
   *  risk-config discipline: versioned append, checksummed payload, every
   *  write audited; no permission here changes what a failed objective does
   *  beyond firing burn-rate alerts. */
  OPERATIONS_SLO_UPDATE = 'operations:slo_update',

  // ---------------------------------------------------------------------------
  // Application compliance surface (compliance module).
  //
  // These were introduced to give the compliance console enforceable codes in
  // the same `resource:action` shape as every other permission. Without them
  // the controllers had to pass bare UPPER_SNAKE strings that no seeded role
  // could ever hold (only the global `*` matched), which silently locked the
  // whole surface behind the break-glass identity.
  // ---------------------------------------------------------------------------

  /** Read the compliance posture: policies, providers, dashboards. */
  COMPLIANCE_READ = 'compliance:read',
  /** Change compliance configuration and resolve compliance work. */
  COMPLIANCE_WRITE = 'compliance:write',
  /** Act as the reviewer on compliance cases and KYC/AML reviews. */
  COMPLIANCE_REVIEWER = 'compliance:reviewer',
  /** Submit or update KYC data on behalf of a user. */
  KYC_WRITE = 'kyc:write',
  /** Read AML monitoring results and alerts. */
  AML_READ = 'aml:read',
  /** Update AML monitoring configuration and dispositions. */
  AML_WRITE = 'aml:write',

  // ---------------------------------------------------------------------------
  // Security console surface (security module).
  // ---------------------------------------------------------------------------

  /** Read security policy configuration. */
  SECURITY_POLICY_READ = 'security_policy:read',
  /** Change security policy configuration. */
  SECURITY_POLICY_WRITE = 'security_policy:write',
  /** Read single sign-on configuration. */
  SSO_READ = 'sso:read',
  /** Change single sign-on configuration. */
  SSO_MANAGE = 'sso:manage',
  /** List platform/tenant API keys (metadata only, never secrets). */
  API_KEY_READ = 'api_key:read',
  /** Create, rotate or revoke API keys. */
  API_KEY_WRITE = 'api_key:write',
  /** Full API key lifecycle control, including policy overrides. */
  API_KEY_MANAGE = 'api_key:manage',
  /** Read session inventory for the tenant. */
  SESSION_READ = 'session:read',
  /** Revoke or constrain sessions. */
  SESSION_WRITE = 'session:write',
  /** Read the trusted device inventory. */
  DEVICE_READ = 'device:read',
  /** Trust, untrust or remove devices. */
  DEVICE_WRITE = 'device:write',
  /** Read MFA enrolment posture for the tenant. */
  MFA_READ = 'mfa:read',
  /** Write security events (machine-to-machine ingestion path). */
  SECURITY_EVENT_WRITE = 'security_event:write',

  // ---------------------------------------------------------------------------
  // Trading surface (exchange connectivity console).
  // ---------------------------------------------------------------------------

  /** Read trading configuration: exchanges, symbols, mirror state. */
  TRADING_READ = 'trading:read',
  /** Change trading configuration for accounts the actor owns. */
  TRADING_WRITE = 'trading:write',
  /** Tenant-wide trading configuration control. */
  TRADING_MANAGE = 'trading:manage',
}

/**
 * Permissions that a `resource:*` wildcard does NOT grant.
 *
 * Wildcards are a convenience for building custom roles, and the failure mode
 * of a convenience is that someone grants `exchange_account:*` meaning "let
 * support fix API keys" and hands out the ability to arm live trading. These
 * must be listed explicitly on a role.
 *
 * The platform super admin's global `*` still matches: that role is the
 * break-glass identity and restricting it would only produce a system nobody
 * can operate in an incident.
 */
export const NON_WILDCARD_PERMISSIONS: ReadonlySet<string> = Object.freeze(
  new Set<string>([
    Permission.EXCHANGE_ACCOUNT_ENABLE_LIVE,
    Permission.EXCHANGE_ACCOUNT_ROTATE_CREDENTIALS,
    Permission.EXECUTION_SUBMIT,
    Permission.KILL_SWITCH_OPERATE,
    Permission.RECONCILIATION_RESOLVE,
    Permission.PLATFORM_IMPERSONATE,
    Permission.STRATEGY_INSTANCE_ENABLE,
    // Starting an ingestion spends bounded storage and bandwidth against an
    // external archive, and archiving removes a reproducibility resource;
    // neither should arrive as a wildcard side effect. Quarantine is
    // deliberately NOT here: withdrawing corrupt data is a safety action,
    // and a permission argument is the wrong thing to be having during one.
    Permission.DATASET_INGEST,
    Permission.DATASET_ARCHIVE,
    // Part 8. Widening a risk limit and disarming a protection both make the
    // system MORE willing to trade; neither may arrive as a wildcard side
    // effect. RISK_READ and (deliberately) the kill-switch engage path stay
    // wildcardable: reading is harmless, and engaging a switch only ever
    // stops things - a wildcard that lets you halt trading is fine.
    Permission.RISK_CONFIG_UPDATE,
    Permission.RISK_PROTECTION_CLEAR,
    // Part 9. Dismissing operational evidence must never arrive as a
    // wildcard side effect. Acknowledge is *not* in this set - like
    // engaging a kill switch, it only ever means "seen, on it"; what needs
    // explicit listing is the resolve half, which the same permission
    // carries - so the whole update permission stays explicit. The
    // justification is the resolve; the name is the one permission.
    Permission.OPERATIONS_ALERTS_UPDATE,
    // Part 10. Redefining what the platform PROMISES (the SLO objective a
    // burn-rate alert fires against) moves the evidentiary baseline the same
    // way dismissing evidence does: explicit grant or nothing.
    Permission.OPERATIONS_SLO_UPDATE,
  ]),
);

/**
 * Every Part 5 permission, in declaration order. Exported so the seed script
 * and the admin UI enumerate the execution surface without hard-coding it.
 */
export const EXECUTION_PERMISSIONS: readonly Permission[] = Object.freeze([
  Permission.EXECUTION_READ,
  Permission.EXECUTION_SUBMIT,
  Permission.EXECUTION_CANCEL,
  Permission.ORDER_EVENT_READ,
  Permission.FILL_READ,
  Permission.BALANCE_READ,
  Permission.BALANCE_REFRESH,
  Permission.EXCHANGE_ACCOUNT_VERIFY,
  Permission.EXCHANGE_ACCOUNT_ROTATE_CREDENTIALS,
  Permission.EXCHANGE_ACCOUNT_ENABLE_LIVE,
  Permission.PRIVATE_STREAM_READ,
  Permission.PRIVATE_STREAM_MANAGE,
  Permission.RECONCILIATION_READ,
  Permission.RECONCILIATION_TRIGGER,
  Permission.RECONCILIATION_RESOLVE,
  Permission.EXECUTION_INCIDENT_READ,
  Permission.EXECUTION_INCIDENT_RESOLVE,
  Permission.KILL_SWITCH_READ,
  Permission.KILL_SWITCH_OPERATE,
]);

/**
 * Every Part 6 permission, in declaration order. Exported for the same reason
 * as `EXECUTION_PERMISSIONS`: the seed script and the admin UI enumerate the
 * strategy surface from one list rather than each keeping their own copy.
 */
export const STRATEGY_PERMISSIONS: readonly Permission[] = Object.freeze([
  Permission.STRATEGY_VERSION_READ,
  Permission.STRATEGY_INSTANCE_READ,
  Permission.STRATEGY_INSTANCE_MANAGE,
  Permission.STRATEGY_INSTANCE_ENABLE,
  Permission.STRATEGY_INSTANCE_DISABLE,
  Permission.STRATEGY_INCIDENT_READ,
  Permission.STRATEGY_INCIDENT_RESOLVE,
  Permission.STRATEGY_METRICS_READ,
  Permission.BACKTEST_READ,
  Permission.BACKTEST_SUBMIT,
  Permission.PAPER_SESSION_READ,
  Permission.PAPER_SESSION_OPERATE,
]);

/**
 * The read-only subset of the strategy surface.
 *
 * This is what the mobile application is allowed to hold, and what a support
 * or compliance role is granted. Nothing in this list starts, stops or
 * reconfigures anything.
 */
export const STRATEGY_READ_ONLY_PERMISSIONS: readonly Permission[] = Object.freeze([
  Permission.STRATEGY_READ,
  Permission.STRATEGY_VERSION_READ,
  Permission.STRATEGY_INSTANCE_READ,
  Permission.STRATEGY_INCIDENT_READ,
  Permission.STRATEGY_METRICS_READ,
  Permission.BACKTEST_READ,
  Permission.PAPER_SESSION_READ,
]);

/**
 * Every Part 7 permission, in declaration order. Exported for the same
 * reason as STRATEGY_PERMISSIONS: one list, enumerated by seed and admin,
 * never re-typed by hand.
 */
export const DATASET_PERMISSIONS: readonly Permission[] = Object.freeze([
  Permission.DATASET_READ,
  Permission.DATASET_INGEST,
  Permission.DATASET_VALIDATE,
  Permission.DATASET_QUARANTINE,
  Permission.DATASET_ARCHIVE,
]);

/** The read-only dataset surface: metadata, validity, coverage. Nothing here
 *  starts work or changes state. */
export const DATASET_READ_ONLY_PERMISSIONS: readonly Permission[] = Object.freeze([
  Permission.DATASET_READ,
]);

/**
 * Every Part 8 permission, in declaration order - the same single-list rule
 * used for the execution, strategy and dataset surfaces so seed, admin UI
 * and API enumerate one source of truth instead of three hand-copied ones.
 *
 * KILL_SWITCH_READ/OPERATE (Part 5) remain the execution-console names for
 * the same durable switch rows; RISK_KILL_SWITCH_UPDATE exists so the risk
 * console can be granted without the execution console. Both routes call
 * the same service; there is no second switch state to drift.
 */
export const RISK_PERMISSIONS: readonly Permission[] = Object.freeze([
  Permission.RISK_READ,
  Permission.RISK_CONFIG_UPDATE,
  Permission.RISK_KILL_SWITCH_UPDATE,
  Permission.RISK_PROTECTION_CLEAR,
]);

export const OPERATIONS_PERMISSIONS: readonly Permission[] = Object.freeze([
  Permission.OPERATIONS_READ,
  Permission.OPERATIONS_ALERTS_UPDATE,
  Permission.OPERATIONS_SLO_UPDATE,
]);

/** The read-only risk surface: status, snapshot metadata, limits, exposure,
 *  events. This is the mobile grant and the support/compliance grant. */
export const RISK_READ_ONLY_PERMISSIONS: readonly Permission[] = Object.freeze([
  Permission.RISK_READ,
]);

export interface PermissionDefinition {
  key: Permission;
  resource: string;
  action: string;
  description: string;
  /** True when a `resource:*` wildcard will not grant this permission. */
  requiresExplicitGrant: boolean;
}

export interface RoleDefinition {
  key: SystemRole;
  name: string;
  description: string;
  scope: RoleScope;
  isSystem: true;
  permissions: Permission[];
}

const TRADER_PERMISSIONS: Permission[] = [
  Permission.EXCHANGE_ACCOUNT_READ,
  Permission.EXCHANGE_ACCOUNT_MANAGE,
  Permission.STRATEGY_READ,
  Permission.STRATEGY_MANAGE,
  Permission.DATASET_READ,
  Permission.ORDER_READ,
  Permission.ORDER_MANAGE,
  Permission.POSITION_READ,
  Permission.PORTFOLIO_READ,
  Permission.COPY_SUBSCRIPTION_READ,
  Permission.REPORT_READ,

  // Part 5. A trader may trade their own account and see why an order was
  // refused, but may not arm live trading, rotate a credential, release a kill
  // switch or close a reconciliation discrepancy. Those are operator actions.
  Permission.EXECUTION_READ,
  Permission.EXECUTION_SUBMIT,
  Permission.EXECUTION_CANCEL,
  Permission.ORDER_EVENT_READ,
  Permission.FILL_READ,
  Permission.BALANCE_READ,
  Permission.BALANCE_REFRESH,
  Permission.EXCHANGE_ACCOUNT_VERIFY,
  Permission.PRIVATE_STREAM_READ,
  Permission.RECONCILIATION_READ,
  Permission.EXECUTION_INCIDENT_READ,
  Permission.KILL_SWITCH_READ,

  // Part 6. A trader owns their strategies end to end: configure, backtest,
  // paper trade, start and stop. What they cannot do is make any of that reach
  // a venue on its own - that still needs the account armed for live trading,
  // which is a tenant-administrator action.
  Permission.STRATEGY_VERSION_READ,
  Permission.STRATEGY_INSTANCE_READ,
  Permission.STRATEGY_INSTANCE_MANAGE,
  Permission.STRATEGY_INSTANCE_ENABLE,
  Permission.STRATEGY_INSTANCE_DISABLE,
  Permission.STRATEGY_INCIDENT_READ,
  Permission.STRATEGY_METRICS_READ,
  Permission.BACKTEST_READ,
  Permission.BACKTEST_SUBMIT,
  Permission.PAPER_SESSION_READ,
  Permission.PAPER_SESSION_OPERATE,

  // Part 8. A trader sees their risk posture and can STOP things (the
  // engage permission only ever halts trading); re-versioning limits and
  // clearing a triggered protection are administrator acts. The asymmetry
  // is the point: "why is my strategy blocked" must be answerable by the
  // person running the strategy - "what unblocks it" is not theirs to press.
  Permission.RISK_READ,
  Permission.RISK_KILL_SWITCH_UPDATE,
];

const FOLLOWER_PERMISSIONS: Permission[] = [
  Permission.EXCHANGE_ACCOUNT_READ,
  Permission.EXCHANGE_ACCOUNT_MANAGE,
  Permission.COPY_SUBSCRIPTION_READ,
  Permission.COPY_SUBSCRIPTION_MANAGE,
  Permission.ORDER_READ,
  Permission.POSITION_READ,
  Permission.PORTFOLIO_READ,
  Permission.STRATEGY_READ,

  // Part 5. A follower's orders originate from a copy subscription, not from
  // the follower pressing a button, so EXECUTION_SUBMIT is deliberately absent.
  // Cancel is present: a user must always be able to stop something that is
  // already working against them.
  Permission.EXECUTION_CANCEL,
  Permission.ORDER_EVENT_READ,
  Permission.FILL_READ,
  Permission.BALANCE_READ,
  Permission.BALANCE_REFRESH,
  Permission.EXCHANGE_ACCOUNT_VERIFY,
  Permission.PRIVATE_STREAM_READ,
  Permission.RECONCILIATION_READ,
  Permission.EXECUTION_INCIDENT_READ,

  // Part 6. A follower copies a trader; they do not run strategies. They may
  // see which strategy is behind what they are copying, and nothing more.
  Permission.STRATEGY_VERSION_READ,
];

/**
 * Default permission matrix seeded into the database. Tenant admins may clone
 * these roles and tune the permission set per brand.
 */
export const SYSTEM_ROLE_DEFINITIONS: readonly RoleDefinition[] = Object.freeze([
  {
    key: SystemRole.SUPER_ADMIN,
    name: 'Super Administrator',
    description: 'Platform owner. Unrestricted access across every tenant.',
    scope: RoleScope.PLATFORM,
    isSystem: true,
    permissions: [Permission.ALL],
  },
  {
    key: SystemRole.TENANT_ADMIN,
    name: 'Tenant Administrator',
    description: 'Full administrative control limited to a single tenant.',
    scope: RoleScope.TENANT,
    isSystem: true,
    permissions: [
      Permission.TENANT_READ,
      Permission.TENANT_UPDATE,
      Permission.TENANT_BRANDING_READ,
      Permission.TENANT_BRANDING_UPDATE,
      Permission.TENANT_SETTINGS_READ,
      Permission.TENANT_SETTINGS_UPDATE,
      Permission.TENANT_DOMAIN_MANAGE,
      Permission.USER_CREATE,
      Permission.USER_READ,
      Permission.USER_UPDATE,
      Permission.USER_DELETE,
      Permission.USER_SUSPEND,
      Permission.USER_ASSIGN_ROLE,
      Permission.USER_RESET_PASSWORD,
      Permission.USER_READ_SESSIONS,
      Permission.USER_REVOKE_SESSIONS,
      Permission.ROLE_CREATE,
      Permission.ROLE_READ,
      Permission.ROLE_UPDATE,
      Permission.ROLE_DELETE,
      Permission.PERMISSION_READ,
      Permission.PLAN_READ,
      Permission.SUBSCRIPTION_READ,
      Permission.SUBSCRIPTION_MANAGE,
      Permission.INVOICE_READ,
      Permission.FEATURE_FLAG_READ,
      Permission.FEATURE_FLAG_MANAGE,
      Permission.AUDIT_LOG_READ,
      Permission.SECURITY_EVENT_READ,
      Permission.KYC_READ,
      Permission.EXCHANGE_ACCOUNT_READ,

      // Security console and trading surface: the tenant administrator owns
      // these for its tenant (policy, SSO, API keys, sessions, devices, MFA
      // posture and the exchange/trading configuration console).
      Permission.SECURITY_POLICY_READ,
      Permission.SECURITY_POLICY_WRITE,
      Permission.SSO_READ,
      Permission.SSO_MANAGE,
      Permission.API_KEY_READ,
      Permission.API_KEY_WRITE,
      Permission.API_KEY_MANAGE,
      Permission.SESSION_READ,
      Permission.SESSION_WRITE,
      Permission.DEVICE_READ,
      Permission.DEVICE_WRITE,
      Permission.MFA_READ,
      Permission.TRADING_READ,
      Permission.TRADING_WRITE,
      Permission.TRADING_MANAGE,
      Permission.STRATEGY_READ,
      Permission.STRATEGY_MANAGE,
      Permission.COPY_SUBSCRIPTION_READ,
      Permission.ORDER_READ,
      Permission.POSITION_READ,
      Permission.PORTFOLIO_READ,
      Permission.REPORT_READ,
      Permission.SUPPORT_TICKET_READ,
      Permission.SUPPORT_TICKET_MANAGE,
      Permission.NOTIFICATION_SEND,

      // Part 5. The tenant administrator is the operator role: it owns the
      // safety controls for its own tenant. It holds ENABLE_LIVE and
      // KILL_SWITCH_OPERATE because someone inside the tenant must be able to
      // stop trading at 3am without a platform escalation. It does NOT hold
      // EXECUTION_SUBMIT - administering a brand is not trading it, and an
      // admin who wants to trade can be granted the TRADER role as well.
      Permission.EXECUTION_READ,
      Permission.EXECUTION_CANCEL,
      Permission.ORDER_EVENT_READ,
      Permission.FILL_READ,
      Permission.BALANCE_READ,
      Permission.BALANCE_REFRESH,
      Permission.EXCHANGE_ACCOUNT_VERIFY,
      Permission.EXCHANGE_ACCOUNT_ROTATE_CREDENTIALS,
      Permission.EXCHANGE_ACCOUNT_ENABLE_LIVE,
      Permission.PRIVATE_STREAM_READ,
      Permission.PRIVATE_STREAM_MANAGE,
      Permission.RECONCILIATION_READ,
      Permission.RECONCILIATION_TRIGGER,
      Permission.RECONCILIATION_RESOLVE,
      Permission.EXECUTION_INCIDENT_READ,
      Permission.EXECUTION_INCIDENT_RESOLVE,
      Permission.KILL_SWITCH_READ,
      Permission.KILL_SWITCH_OPERATE,

      // Part 6. The operator role for the strategy layer too: it can stop
      // anything, resolve incidents and see everything. It can also enable an
      // instance, because an administrator who can arm live trading on an
      // account but cannot start a paper strategy would be an odd shape.
      Permission.STRATEGY_VERSION_READ,
      Permission.STRATEGY_INSTANCE_READ,
      Permission.STRATEGY_INSTANCE_MANAGE,
      Permission.STRATEGY_INSTANCE_ENABLE,
      Permission.STRATEGY_INSTANCE_DISABLE,
      Permission.STRATEGY_INCIDENT_READ,
      Permission.STRATEGY_INCIDENT_RESOLVE,
      Permission.STRATEGY_METRICS_READ,
      Permission.BACKTEST_READ,
      Permission.BACKTEST_SUBMIT,
      Permission.PAPER_SESSION_READ,

      // Part 7. The dataset surface is storage and integrity administration;
      // the tenant administrator owns it entirely. Reading a dataset is not
      // sensitive (public market data), but ingesting, validating and
      // withdrawing versions are operator acts and they live here.
      ...DATASET_PERMISSIONS,
      Permission.PAPER_SESSION_OPERATE,

      // Part 8. The whole risk control plane: read, re-version limits,
      // engage stops, clear protections. Named entry by entry rather than
      // spread, so the explicit-grant rule on the two power permissions
      // stays visible at the grant site too.
      Permission.RISK_READ,
      Permission.RISK_CONFIG_UPDATE,
      Permission.RISK_KILL_SWITCH_UPDATE,
      Permission.RISK_PROTECTION_CLEAR,

      // Part 9. The operator role reads the operations panel and owns its
      // tenant's alert lifecycle. Platform-infrastructure alerts (tenant
      // null) are readable here but only resolvable by the platform break-
      // glass role; the service enforces that split, and it is stated here
      // so the grant list tells the whole story.
      Permission.OPERATIONS_READ,
      Permission.OPERATIONS_ALERTS_UPDATE,
      // Part 10. Setting an error objective for the tenant's operational
      // surface is an admin act like the alert lifecycle above it; it grants
      // no power over trading and no power over evidence already recorded.
      Permission.OPERATIONS_SLO_UPDATE,
    ],
  },
  {
    key: SystemRole.TRADER,
    name: 'Trader',
    description: 'Publishes strategies that followers can copy.',
    scope: RoleScope.TENANT,
    isSystem: true,
    permissions: TRADER_PERMISSIONS,
  },
  {
    key: SystemRole.FOLLOWER,
    name: 'Follower',
    description: 'Copies traders using their own non-custodial exchange keys.',
    scope: RoleScope.TENANT,
    isSystem: true,
    permissions: FOLLOWER_PERMISSIONS,
  },
  {
    key: SystemRole.SUPPORT,
    name: 'Support Agent',
    description: 'Read-mostly access for customer support operations.',
    scope: RoleScope.TENANT,
    isSystem: true,
    permissions: [
      Permission.USER_READ,
      Permission.USER_READ_SESSIONS,
      Permission.TENANT_READ,
      Permission.SUBSCRIPTION_READ,
      Permission.ORDER_READ,
      Permission.POSITION_READ,
      Permission.PORTFOLIO_READ,
      Permission.COPY_SUBSCRIPTION_READ,
      Permission.SUPPORT_TICKET_READ,
      Permission.SUPPORT_TICKET_MANAGE,
      Permission.AUDIT_LOG_READ,

      // Part 5. Read-only, and not one write anywhere on the money path.
      // Support answers "what happened to my order", which needs the event
      // trail and the incident, and nothing else.
      Permission.ORDER_EVENT_READ,
      Permission.FILL_READ,
      Permission.BALANCE_READ,
      Permission.EXECUTION_READ,
      Permission.PRIVATE_STREAM_READ,
      Permission.RECONCILIATION_READ,
      Permission.EXECUTION_INCIDENT_READ,
      Permission.KILL_SWITCH_READ,

      // Part 6. Read-only, so that support can answer "why did my strategy
      // stop" without being able to start it again.
      Permission.STRATEGY_INSTANCE_READ,
      Permission.STRATEGY_INCIDENT_READ,
      Permission.STRATEGY_METRICS_READ,
      Permission.PAPER_SESSION_READ,

      // Part 7. Read-only: "which data did that backtest use" is a support
      // question once results are shown in the console. Writing anything on
      // this surface is not.
      Permission.DATASET_READ,

      // Part 8. Read-only posture: "why is trading halted, and who said
      // so" is a support question, and the switch lifecycle now answers it.
      // No grant here moves money, limits or halts.
      Permission.RISK_READ,
      Permission.OPERATIONS_READ,
    ],
  },
  {
    key: SystemRole.FINANCE,
    name: 'Finance',
    description: 'Billing, invoicing, payouts and revenue reporting.',
    scope: RoleScope.TENANT,
    isSystem: true,
    permissions: [
      Permission.TENANT_READ,
      Permission.USER_READ,
      Permission.PLAN_READ,
      Permission.SUBSCRIPTION_READ,
      Permission.SUBSCRIPTION_MANAGE,
      Permission.INVOICE_READ,
      Permission.PAYOUT_MANAGE,
      Permission.REPORT_READ,
      Permission.AUDIT_LOG_READ,

      // Part 5. Fee and payout calculations are derived from fills and
      // balances, so finance needs to read them. Nothing else.
      Permission.FILL_READ,
      Permission.BALANCE_READ,
    ],
  },
  {
    key: SystemRole.COMPLIANCE,
    name: 'Compliance Officer',
    description: 'KYC review, audit trail inspection and security oversight.',
    scope: RoleScope.TENANT,
    isSystem: true,
    permissions: [
      Permission.TENANT_READ,
      Permission.USER_READ,
      Permission.USER_SUSPEND,
      Permission.KYC_READ,
      Permission.KYC_REVIEW,
      Permission.AUDIT_LOG_READ,
      Permission.SECURITY_EVENT_READ,
      Permission.REPORT_READ,

      // Application compliance surface: the compliance console routes are
      // gated on these, so the officer role must hold them to do its job.
      Permission.COMPLIANCE_READ,
      Permission.COMPLIANCE_WRITE,
      Permission.COMPLIANCE_REVIEWER,
      Permission.KYC_WRITE,
      Permission.AML_READ,
      Permission.AML_WRITE,

      // Part 5. Compliance reads the whole execution audit trail and can
      // engage a kill switch - stopping trading is never the wrong call for a
      // compliance officer to be able to make.
      Permission.ORDER_EVENT_READ,
      Permission.FILL_READ,
      Permission.BALANCE_READ,
      Permission.EXECUTION_READ,
      Permission.RECONCILIATION_READ,
      Permission.EXECUTION_INCIDENT_READ,
      Permission.KILL_SWITCH_READ,
      Permission.KILL_SWITCH_OPERATE,

      // Part 6. Compliance reads the whole strategy trail - what ran, what it
      // was configured with, what it was told about itself - and can stop an
      // instance, which is never the wrong call for a compliance officer to be
      // able to make.
      Permission.STRATEGY_VERSION_READ,
      Permission.STRATEGY_INSTANCE_READ,
      Permission.STRATEGY_INSTANCE_DISABLE,
      Permission.STRATEGY_INCIDENT_READ,
      Permission.STRATEGY_METRICS_READ,
      Permission.BACKTEST_READ,
      Permission.PAPER_SESSION_READ,

      // Part 7. Compliance reads dataset provenance (a backtest's data is
      // part of its audit trail) and can quarantine a version - withdrawing
      // suspect data is risk-reducing, in the same family as stopping a
      // strategy or a kill switch.
      Permission.DATASET_READ,
      Permission.DATASET_QUARANTINE,

      // Part 8. Compliance reads the risk posture and can pull stops, which
      // is consistent with the KILL_SWITCH_OPERATE grant above - engaging
      // only ever halts trading. Widening limits (RISK_CONFIG_UPDATE) and
      // clearing a triggered protection (RISK_PROTECTION_CLEAR) are
      // deliberately NOT granted here: neither is a risk-reducing act.
      Permission.RISK_READ,
      Permission.RISK_KILL_SWITCH_UPDATE,
      Permission.OPERATIONS_READ,
    ],
  },
]);

/**
 * Splits `resource:action` and evaluates wildcard matching.
 *
 * Order of checks matters:
 *   1. the global `*` grants everything, including non-wildcard permissions;
 *   2. an exact string match always grants;
 *   3. a `resource:*` wildcard grants every action on that resource EXCEPT
 *      those listed in `NON_WILDCARD_PERMISSIONS`.
 */
export function permissionMatches(granted: string, required: string): boolean {
  if (granted === Permission.ALL) {
    return true;
  }
  if (granted === required) {
    return true;
  }
  const [grantedResource, grantedAction] = granted.split(':');
  const [requiredResource, requiredAction] = required.split(':');
  if (!grantedResource || !requiredResource) {
    return false;
  }
  if (grantedResource !== requiredResource) {
    return false;
  }
  if (grantedAction !== '*' || requiredAction === undefined) {
    return false;
  }
  // A wildcard never reaches a permission that arms live trading, rotates a
  // credential, releases a kill switch or closes a discrepancy.
  return !NON_WILDCARD_PERMISSIONS.has(required);
}

export function hasPermission(grantedPermissions: readonly string[], required: string): boolean {
  return grantedPermissions.some((granted) => permissionMatches(granted, required));
}

export function hasAllPermissions(
  grantedPermissions: readonly string[],
  required: readonly string[],
): boolean {
  return required.every((permission) => hasPermission(grantedPermissions, permission));
}

export function hasAnyPermission(
  grantedPermissions: readonly string[],
  required: readonly string[],
): boolean {
  return required.some((permission) => hasPermission(grantedPermissions, permission));
}

/** Derives resource/action metadata for every declared permission. */
export function describePermissions(): PermissionDefinition[] {
  return Object.values(Permission)
    .filter((value) => value !== Permission.ALL)
    .map((value) => {
      const [resource = '', action = ''] = value.split(':');
      return {
        key: value,
        resource,
        action,
        description: `Allows the "${action}" action on the "${resource}" resource.`,
        requiresExplicitGrant: NON_WILDCARD_PERMISSIONS.has(value),
      };
    });
}

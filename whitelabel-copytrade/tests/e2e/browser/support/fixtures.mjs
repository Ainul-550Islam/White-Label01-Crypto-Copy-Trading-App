// # Responsibility: the deterministic API fixtures the browser E2E suite serves from its stub upstream, kept apart from the server so a spec can name the data it expects to see.
//
// Every fixture here is a complete response body for one upstream route, in the platform's
// `{ success: true, data: ... }` envelope. Values are exact decimal strings where the platform uses
// them, so the web parsers (which never convert money in the browser) receive the shape they were
// written against.
//
// The shapes are not invented: each one mirrors the parser the application runs on it -
// `parseTrader`, `parseTraderPerformance`, `parseSubscription`, `parseCopyExecution`,
// `parsePaged` - including the fields those parsers read for status and currentness. A field the
// parser reads and this file omits would show up as a default the UI never promises, which is
// exactly what these tests exist to catch.

export const E2E_USER = { id: 'user-e2e-1', email: 'e2e-follower@example.test' };
export const E2E_TENANT_ID = 'tenant-e2e';

/**
 * A structurally valid but unsigned JWT, because both applications decode the access token's
 * claims server-side to build their navigation (`decodeAccessTokenClaims` reads `sub`, `tid`,
 * `roles`, `perms`, `plat`, `exp`). A plain opaque string would send every page to `/login`,
 * which is how the console guard looked when this suite was first run end to end.
 *
 * The signature is deliberately not a signature: neither layout verifies it, and both say so in
 * their own comments - the token drives navigation only, and every page re-authorises through the
 * API. The stub upstream accepts this exact string as its session token; nothing else does, and
 * the string cannot authenticate against any real platform.
 */
function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

const E2E_TOKEN_PAYLOAD = {
  sub: E2E_USER.id,
  tid: E2E_TENANT_ID,
  roles: ['SUPER_ADMIN'],
  perms: ['*'],
  plat: true,
  // Rebuilt on every module load, so a long-lived checkout cannot expire its own fixtures.
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

export const E2E_ACCESS_TOKEN = [
  base64urlJson({ alg: 'none', typ: 'JWT' }),
  base64urlJson(E2E_TOKEN_PAYLOAD),
  'e2e-unsigned-signature-not-verified-anywhere',
].join('.');

export const E2E_REFRESH_TOKEN = ['e2e-refresh', 'token-not-a-credential'].join('-');

export const traders = [
  {
    traderId: 'trader-alpha',
    displayName: 'Alpha Quant Desk',
    bio: 'Systematic BTC/ETH momentum',
    avatarUrl: null,
    verificationState: 'VERIFIED',
    verifiedAt: '2026-08-01T00:00:00.000Z',
    supportedVenues: ['BINANCE', 'BYBIT'],
    supportedSymbols: ['BTC-USDT', 'ETH-USDT'],
    isPublic: true,
    isFeatured: true,
    followerCount: 145,
    totalVolume: '920000',
    totalTrades: 84,
    createdAt: '2026-06-01T00:00:00.000Z',
  },
  {
    traderId: 'trader-beta',
    displayName: 'Beta Carry Book',
    bio: 'Funding-rate carry on majors',
    avatarUrl: null,
    verificationState: 'UNVERIFIED',
    verifiedAt: null,
    supportedVenues: ['OKX'],
    supportedSymbols: ['BTC-USDT'],
    isPublic: true,
    isFeatured: false,
    followerCount: 12,
    totalVolume: '41000',
    totalTrades: 9,
    createdAt: '2026-07-15T00:00:00.000Z',
  },
];

export const alphaPerformance = {
  traderId: 'trader-alpha',
  tenantId: E2E_TENANT_ID,
  realizedPnl: '18250.75',
  unrealizedPnl: '410.25',
  totalReturn: '18250.75',
  totalReturnPercent: '18.25',
  maxDrawdown: '-2400.00',
  maxDrawdownPercent: '-2.40',
  winCount: 61,
  lossCount: 23,
  tradeCount: 84,
  winRate: '72.62',
  lossRate: '27.38',
  totalVolume: '920000',
  averageTrade: '217.27',
  averageWin: '498.10',
  averageLoss: '-547.32',
  profitFactor: '2.41',
  sharpeRatio: '1.85',
  historyLengthDays: 120,
  lastTradeAt: '2026-10-06T12:00:00.000Z',
  isActual: true,
  source: 'FILLS',
};

export const rankingsMethodology = {
  status: 'AVAILABLE',
  key: 'RECONCILED_CLOSED_PERIOD_TWR',
  description: 'Time-weighted return over exactly contiguous reconciled periods.',
  timeframe: '30D',
  windowStart: '2026-09-07T00:00:00.000Z',
  asOf: '2026-10-07T00:00:00.000Z',
  boundaryRule: 'EXACT_CONTIGUOUS_PERIODS_ONLY',
  orderingRule: 'RETURN_DESCENDING_UNAVAILABLE_LAST',
  currentnessRule: 'A window is only ranked when every period inside it is reconciled.',
  minimumPeriodCount: 5,
  rankedCount: 1,
  unrankedCount: 1,
  reason: null,
};

export const rankings = [
  {
    traderId: 'trader-alpha',
    tenantId: E2E_TENANT_ID,
    displayName: 'Alpha Quant Desk',
    verificationState: 'VERIFIED',
    isPublic: true,
    isFeatured: true,
    followerCount: 145,
    performance: alphaPerformance,
    score: 78.5,
    rank: 1,
    metrics: {
      riskAdjustedReturn: 1.85,
      drawdownScore: 0.88,
      consistencyScore: 0.71,
      historyLengthScore: 0.6,
      followerScore: 0.42,
      activityScore: 0.84,
      verifiedScore: 1,
    },
    weighting: { riskAdjustedReturn: 0.35, drawdownScore: 0.2 },
  },
  {
    traderId: 'trader-beta',
    tenantId: E2E_TENANT_ID,
    displayName: 'Beta Carry Book',
    verificationState: 'UNVERIFIED',
    isPublic: true,
    isFeatured: false,
    followerCount: 12,
    performance: null,
    score: 0,
    rank: 0,
    metrics: {
      riskAdjustedReturn: null,
      drawdownScore: null,
      consistencyScore: null,
      historyLengthScore: null,
      followerScore: null,
      activityScore: null,
      verifiedScore: null,
    },
    weighting: {},
  },
];

/**
 * The subscription resource, as served by
 * `GET /v1/copy-trading/subscriptions/:subscriptionId` and read by `parseSubscription`.
 */
export const subscriptionResource = {
  subscriptionId: 'sub-e2e-1',
  traderId: 'trader-alpha',
  strategyId: 'strategy-e2e-1',
  state: 'ACTIVE',
  allocationMode: 'FIXED',
  allocationAmount: '500.00',
  maxAllocation: '2000.00',
  minAllocation: '50.00',
  copyPolicy: null,
  riskPolicy: {
    maxDailyLoss: '300.00',
    maxDrawdown: '800.00',
    maxOpenExposure: '3000.00',
    maxExposurePerTrader: null,
    maxExposurePerSymbol: null,
    maxDailyCopiedTrades: 10,
    emergencyStopCopy: false,
  },
  followerAccountId: 'account-e2e-1',
  totalCopies: 5,
  failedCopies: 0,
  totalCopiedVolume: '2500.00',
  startedAt: '2026-09-01T00:00:00.000Z',
  pausedAt: null,
  stoppedAt: null,
  stopReason: null,
  closeOpenPositionsOnStop: true,
  createdAt: '2026-09-01T00:00:00.000Z',
};

export function subscriptionResourcePaused() {
  return {
    ...subscriptionResource,
    state: 'PAUSED',
    pausedAt: '2026-10-07T00:00:00.000Z',
  };
}

/**
 * The effective policy, as served by `GET /v1/copy-trading/policies/effective?subscriptionId=...`
 * and read by `parseCopyPolicy`.
 */
export const effectivePolicyResource = {
  sizingMode: 'FIXED',
  fixedQuantity: '0.2',
  multiplier: null,
  proportionalRatio: null,
  maxPositionSize: '2000',
  maxNotional: '5000',
  maxOpenPositions: 5,
  maxLeverage: '2',
  allowedSymbols: ['BTC-USDT'],
  blockedSymbols: [],
  allowedVenues: ['BINANCE'],
  orderTypePolicy: 'MARKET_AND_LIMIT',
  slippageToleranceBps: 50,
  executionDelayMs: 0,
  takeProfitBps: 200,
  stopLossBps: 100,
  trailingStopBps: null,
  emergencyStop: false,
};

/**
 * One copied execution, as served by `GET /v1/copy-trading/executions` and read by
 * `parseCopyExecution`. Every field that parser reads is present.
 */
export const copyExecutions = [
  {
    executionId: 'exec-e2e-1',
    subscriptionId: 'sub-e2e-1',
    leaderEventId: 'leader-event-1',
    leaderOrderId: 'leader-order-1',
    leaderFillId: 'leader-fill-1',
    traderId: 'trader-alpha',
    followerId: E2E_USER.id,
    followerAccountId: 'account-e2e-1',
    status: 'FILLED',
    sizingMode: 'FIXED',
    leaderQuantity: '0.2',
    leaderPrice: '61250.50',
    followerQuantity: '0.2',
    followerPrice: '61278.10',
    slippageTolerance: '0.005',
    maxNotional: '5000',
    followerOrderId: 'follower-order-1',
    riskDecision: 'ALLOWED',
    riskRuleId: null,
    failureReason: null,
    executionIntent: { symbol: 'BTC-USDT', side: 'BUY', orderType: 'MARKET' },
    createdAt: '2026-10-06T10:00:00.000Z',
    updatedAt: '2026-10-06T10:00:05.000Z',
  },
];

export const executionsPage = { data: copyExecutions, total: copyExecutions.length };

export const subscriptionsPage = { data: [subscriptionResource], total: 1 };

/**
 * Compliance cases, as `GET /v1/compliance/cases` really answers: the paged envelope
 * `{ data, total, page, limit }` from `complianceCase.repository.listTenantCases`, whose rows are
 * the Prisma `ComplianceCase` records. The first version of this fixture invented `caseId`,
 * `status` and `summary`; the console then crashed with a 500 while reading `safeSummary`, which
 * was the harness telling the truth about a bad fixture rather than a bad page.
 */
export const complianceCases = {
  data: [
    {
      id: 'case-e2e-1',
      tenantId: E2E_TENANT_ID,
      userId: E2E_USER.id,
      caseType: 'KYC_REVIEW',
      state: 'OPEN',
      severity: 'HIGH',
      riskLevel: 'HIGH',
      decision: null,
      assignedTo: null,
      assignedAt: null,
      escalatedAt: null,
      resolvedAt: null,
      closedAt: null,
      idempotencyKey: 'case-e2e-1-key',
      safeSummary: 'Identity document requires manual review.',
      jurisdiction: 'BD',
      policyVersion: 'v1',
      ruleIds: ['KYC_DOC_MISMATCH'],
      sourceRefs: [],
      metadata: {},
      createdAt: '2026-10-01T09:00:00.000Z',
      updatedAt: '2026-10-06T09:00:00.000Z',
    },
  ],
  total: 1,
  page: 1,
  limit: 50,
};

/**
 * Monitoring signals, as `GET /v1/compliance/monitoring/signals` really answers:
 * `{ data, total }` from `transactionMonitoringService.listSignals`, over
 * `TransactionMonitoringSignal` rows.
 */
export const monitoringSignals = {
  data: [
    {
      id: 'signal-e2e-1',
      tenantId: E2E_TENANT_ID,
      userId: E2E_USER.id,
      sourceType: 'DEPOSIT',
      sourceId: 'deposit-e2e-1',
      ruleId: 'VELOCITY_DEPOSIT',
      riskLevel: 'MEDIUM',
      decision: 'PENDING',
      safeSummary: 'Deposit velocity above the tenant threshold.',
      idempotencyKey: 'signal-e2e-1-key',
      caseId: null,
      resolved: false,
      resolvedAt: null,
      createdAt: '2026-10-05T09:00:00.000Z',
    },
  ],
  total: 1,
};

export const custodyReconciliationFindings = {
  items: [
    {
      findingId: 'finding-e2e-1',
      accountId: 'account-e2e-1',
      asset: 'USDT',
      difference: '0',
      state: 'MATCHED',
      detectedAt: '2026-10-06T00:00:00.000Z',
    },
  ],
  findings: [
    {
      findingId: 'finding-e2e-1',
      accountId: 'account-e2e-1',
      asset: 'USDT',
      difference: '0',
      state: 'MATCHED',
      detectedAt: '2026-10-06T00:00:00.000Z',
    },
  ],
};

export const maintenanceCurrent = { active: false, blocksTrading: false, message: null };

export const activeRestrictions = { data: [] };

export const notificationsPage = { data: [], total: 0 };

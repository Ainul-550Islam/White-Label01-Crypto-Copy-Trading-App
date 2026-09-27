/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn(): super('en');

  @override
  String get accountSection => 'Account';

  @override
  String get activeSessions => 'Active devices';

  @override
  String get appTitle => 'Copy Trading';

  @override
  String get backtestDisclaimer => 'Backtest performance is not indicative of future performance.';

  @override
  String get backtestNotReproducible => 'This run has no dataset checksum and cannot be reproduced exactly.';

  @override
  String get backtestingLabel => 'Backtesting';

  @override
  String get backtestsSection => 'Backtests';

  @override
  String get cancel => 'Cancel';

  @override
  String get changePassword => 'Change password';

  @override
  String get codeRequired => 'Enter your authentication code';

  @override
  String get consecutiveErrorsLabel => 'Consecutive errors';

  @override
  String get disabledLabel => 'Disabled';

  @override
  String get emailInvalid => 'Enter a valid email address';

  @override
  String get emailLabel => 'Email';

  @override
  String get emailRequired => 'Enter your email address';

  @override
  String get enabledLabel => 'Enabled';

  @override
  String get equityLabel => 'Equity';

  @override
  String get executionDisabledNotice => 'Live order execution is disabled on this build.';

  @override
  String get executionQualityDisclaimer => 'Simulation does not guarantee real execution quality.';

  @override
  String get genericError => 'Something went wrong. Please try again.';

  @override
  String get homeTitle => 'Overview';

  @override
  String get instancesLabel => 'Instances';

  @override
  String get insufficientData => 'Insufficient data';

  @override
  String get insufficientDataDisclaimer => 'Risk-adjusted figures are withheld when there were too few observations. Insufficient data is not zero.';

  @override
  String get lastHeartbeatLabel => 'Last heartbeat';

  @override
  String get liveExecutionNotReachable => 'Live execution is not reachable in this deployment';

  @override
  String get liveExecutionReachable => 'Live execution is reachable in this deployment';

  @override
  String get loading => 'Loading';

  @override
  String get maxDrawdownLabel => 'Max drawdown';

  @override
  String get needsAttentionLabel => 'Needs attention';

  @override
  String get netPnlLabel => 'Net PnL';

  @override
  String get noHeartbeatYet => 'No heartbeat reported yet';

  @override
  String get notAvailableShort => 'N/A';

  @override
  String get openIncidentsLabel => 'Open incidents';

  @override
  String get paperDisclaimer => 'Paper performance is not indicative of live performance.';

  @override
  String get paperSessionsSection => 'Paper sessions';

  @override
  String get paperTradingLabel => 'Paper trading';

  @override
  String get passwordLabel => 'Password';

  @override
  String get passwordRequired => 'Enter your password';

  @override
  String get realisedPnlLabel => 'Realised PnL';

  @override
  String get recoveryCodeLabel => 'Recovery code';

  @override
  String get retry => 'Try again';

  @override
  String get riskCadenceLabel => 'Refresh / staleness budget';

  @override
  String get riskCadenceWarn => 'Snapshot refresh does not outpace the staleness budget; expect denials on freshness.';

  @override
  String get riskCapturedLabel => 'Captured';

  @override
  String get riskDayPnlLabel => 'Net day PnL';

  @override
  String get riskDisclaimer => 'Risk controls reduce operational risk but cannot guarantee against all losses.';

  @override
  String get riskEngagedManualLabel => 'manual halt';

  @override
  String get riskEngagedStopsLabel => 'Engaged stops';

  @override
  String get riskEngineOff => 'Risk engine disabled - local tooling mode';

  @override
  String get riskEngineOn => 'Risk engine is in the order path';

  @override
  String get riskEquityLabel => 'Equity';

  @override
  String get riskEventsSection => 'Recent risk events';

  @override
  String get riskExplicitClearNotice => 'This protection was triggered by the engine. It cannot be cleared from this app; acknowledge-and-clear lives in the admin console, behind a typed confirmation.';

  @override
  String get riskFailClosedLabel => 'Fail-closed';

  @override
  String get riskGrossLabel => 'Gross notional';

  @override
  String get riskMirrorSection => 'Latest mirror by account';

  @override
  String get riskNoEvents => 'No risk events recorded.';

  @override
  String get riskNoMirror => 'No mirrored account state yet. Until the risk-state worker syncs, the engine denies new orders - that is fail-closed working, not a blank-screen bug.';

  @override
  String get riskNoSwitches => 'Nothing is halted. The absence of rows is health here.';

  @override
  String get riskOpenOrdersLabel => 'Open orders';

  @override
  String get riskPanelsDegraded => 'Some risk panels could not be loaded. Pull down to try again.';

  @override
  String get riskReadOnlyNotice => 'Read-only by design. Engaging or clearing a switch lives in the admin console, behind reasons and typed confirmations.';

  @override
  String get riskReasonLabel => 'Reason';

  @override
  String get riskRejectionsLabel => 'Risk rejections';

  @override
  String get riskSevereEventsLabel => 'Severe events (24h)';

  @override
  String get riskSnapshotLabel => 'Snapshot';

  @override
  String get riskStaleBadge => 'STALE';

  @override
  String get riskStaleMirrorsLabel => 'Stale mirrors';

  @override
  String get riskStaleSourcesLabel => 'Stale sources';

  @override
  String get riskSubtitle => 'Halt status and mirror freshness for your organisation.';

  @override
  String get riskSwitchesSection => 'Engaged switches';

  @override
  String get riskTitle => 'Risk';

  @override
  String get riskTriggeredProtectionsLabel => 'Triggered protections';

  @override
  String get runningLabel => 'Running';

  @override
  String get securitySection => 'Security';

  @override
  String get securityTitle => 'Security';

  @override
  String get sessionExpired => 'Your session has expired. Please sign in again.';

  @override
  String get settingsTitle => 'Settings';

  @override
  String get sharpeLabel => 'Sharpe';

  @override
  String get signIn => 'Sign in';

  @override
  String get signInSubtitle => 'Sign in to your account to continue.';

  @override
  String get signOut => 'Sign out';

  @override
  String get simulatedBadge => 'SIMULATED';

  @override
  String get simulatedFillsLabel => 'Orders / fills';

  @override
  String get simulationDisclaimerTitle => 'About these numbers';

  @override
  String get statusCancelled => 'Cancelled';

  @override
  String get statusCompleted => 'Completed';

  @override
  String get statusFailed => 'Failed';

  @override
  String get statusLabel => 'Status';

  @override
  String get statusQueued => 'Queued';

  @override
  String get statusRunning => 'Running';

  @override
  String get statusStopped => 'Stopped';

  @override
  String get strategiesSubtitle => 'View strategy health and simulated results.';

  @override
  String get strategiesTitle => 'Strategies';

  @override
  String get strategyEngineLabel => 'Strategy engine';

  @override
  String get strategyInstancesSection => 'Instances';

  @override
  String get strategyNoBacktests => 'No backtests have been run.';

  @override
  String get strategyNoInstances => 'No strategy instances have been created.';

  @override
  String get strategyNoPaperSessions => 'No paper sessions have been run.';

  @override
  String get strategyPanelsDegraded => 'Some panels could not be loaded. Pull down to try again.';

  @override
  String get strategyReadOnlyNotice => 'This screen is read-only. Strategies are started, stopped and configured from the admin console.';

  @override
  String get tradesLabel => 'Trades';

  @override
  String get tradingModeLabel => 'Mode';

  @override
  String get twoFactorCodeLabel => 'Authentication code';

  @override
  String get twoFactorDisabled => 'Two-factor authentication is off';

  @override
  String get twoFactorEnabled => 'Two-factor authentication is on';

  @override
  String get twoFactorSubtitle => 'Enter the six-digit code from your authenticator app.';

  @override
  String get twoFactorTitle => 'Two-factor authentication';

  @override
  String get useAuthenticator => 'Use my authenticator app instead';

  @override
  String get useRecoveryCode => 'Use a recovery code instead';

  @override
  String get verify => 'Verify';

  @override
  String get welcomeBack => 'Welcome back';

  @override
  String get winRateLabel => 'Win rate';

}
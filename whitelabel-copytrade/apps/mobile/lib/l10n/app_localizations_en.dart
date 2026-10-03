// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'Copy Trading';

  @override
  String get signIn => 'Sign in';

  @override
  String get signOut => 'Sign out';

  @override
  String get emailLabel => 'Email';

  @override
  String get passwordLabel => 'Password';

  @override
  String get signInSubtitle => 'Sign in to your account to continue.';

  @override
  String get twoFactorTitle => 'Two-factor authentication';

  @override
  String get twoFactorSubtitle =>
      'Enter the six-digit code from your authenticator app.';

  @override
  String get twoFactorCodeLabel => 'Authentication code';

  @override
  String get recoveryCodeLabel => 'Recovery code';

  @override
  String get useRecoveryCode => 'Use a recovery code instead';

  @override
  String get useAuthenticator => 'Use my authenticator app instead';

  @override
  String get verify => 'Verify';

  @override
  String get cancel => 'Cancel';

  @override
  String get homeTitle => 'Overview';

  @override
  String get settingsTitle => 'Settings';

  @override
  String get securityTitle => 'Security';

  @override
  String get loading => 'Loading';

  @override
  String get emailRequired => 'Enter your email address';

  @override
  String get emailInvalid => 'Enter a valid email address';

  @override
  String get passwordRequired => 'Enter your password';

  @override
  String get codeRequired => 'Enter your authentication code';

  @override
  String get genericError => 'Something went wrong. Please try again.';

  @override
  String get sessionExpired =>
      'Your session has expired. Please sign in again.';

  @override
  String get welcomeBack => 'Welcome back';

  @override
  String get accountSection => 'Account';

  @override
  String get securitySection => 'Security';

  @override
  String get twoFactorEnabled => 'Two-factor authentication is on';

  @override
  String get twoFactorDisabled => 'Two-factor authentication is off';

  @override
  String get activeSessions => 'Active devices';

  @override
  String get changePassword => 'Change password';

  @override
  String get executionDisabledNotice =>
      'Live order execution is disabled on this build.';

  @override
  String get strategiesTitle => 'Strategies';

  @override
  String get strategiesSubtitle =>
      'View strategy health and simulated results.';

  @override
  String get strategyReadOnlyNotice =>
      'This screen is read-only. Strategies are started, stopped and configured from the admin console.';

  @override
  String get strategyPanelsDegraded =>
      'Some panels could not be loaded. Pull down to try again.';

  @override
  String get liveExecutionReachable =>
      'Live execution is reachable in this deployment';

  @override
  String get liveExecutionNotReachable =>
      'Live execution is not reachable in this deployment';

  @override
  String get strategyEngineLabel => 'Strategy engine';

  @override
  String get paperTradingLabel => 'Paper trading';

  @override
  String get backtestingLabel => 'Backtesting';

  @override
  String get tradingModeLabel => 'Mode';

  @override
  String get strategyInstancesSection => 'Instances';

  @override
  String get paperSessionsSection => 'Paper sessions';

  @override
  String get backtestsSection => 'Backtests';

  @override
  String get strategyNoInstances => 'No strategy instances have been created.';

  @override
  String get strategyNoPaperSessions => 'No paper sessions have been run.';

  @override
  String get strategyNoBacktests => 'No backtests have been run.';

  @override
  String get instancesLabel => 'Instances';

  @override
  String get runningLabel => 'Running';

  @override
  String get needsAttentionLabel => 'Needs attention';

  @override
  String get openIncidentsLabel => 'Open incidents';

  @override
  String get enabledLabel => 'Enabled';

  @override
  String get disabledLabel => 'Disabled';

  @override
  String get consecutiveErrorsLabel => 'Consecutive errors';

  @override
  String get lastHeartbeatLabel => 'Last heartbeat';

  @override
  String get noHeartbeatYet => 'No heartbeat reported yet';

  @override
  String get statusLabel => 'Status';

  @override
  String get equityLabel => 'Equity';

  @override
  String get realisedPnlLabel => 'Realised PnL';

  @override
  String get netPnlLabel => 'Net PnL';

  @override
  String get tradesLabel => 'Trades';

  @override
  String get winRateLabel => 'Win rate';

  @override
  String get sharpeLabel => 'Sharpe';

  @override
  String get maxDrawdownLabel => 'Max drawdown';

  @override
  String get simulatedFillsLabel => 'Orders / fills';

  @override
  String get riskRejectionsLabel => 'Risk rejections';

  @override
  String get simulatedBadge => 'SIMULATED';

  @override
  String get insufficientData => 'Insufficient data';

  @override
  String get notAvailableShort => 'N/A';

  @override
  String get statusQueued => 'Queued';

  @override
  String get statusRunning => 'Running';

  @override
  String get statusCompleted => 'Completed';

  @override
  String get statusStopped => 'Stopped';

  @override
  String get statusFailed => 'Failed';

  @override
  String get statusCancelled => 'Cancelled';

  @override
  String get backtestNotReproducible =>
      'This run has no dataset checksum and cannot be reproduced exactly.';

  @override
  String get simulationDisclaimerTitle => 'About these numbers';

  @override
  String get backtestDisclaimer =>
      'Backtest performance is not indicative of future performance.';

  @override
  String get paperDisclaimer =>
      'Paper performance is not indicative of live performance.';

  @override
  String get executionQualityDisclaimer =>
      'Simulation does not guarantee real execution quality.';

  @override
  String get insufficientDataDisclaimer =>
      'Risk-adjusted figures are withheld when there were too few observations. Insufficient data is not zero.';

  @override
  String get riskTitle => 'Risk';

  @override
  String get riskSubtitle =>
      'Halt status and mirror freshness for your organisation.';

  @override
  String get riskEngineOn => 'Risk engine is in the order path';

  @override
  String get riskEngineOff => 'Risk engine disabled - local tooling mode';

  @override
  String get riskFailClosedLabel => 'Fail-closed';

  @override
  String get riskCadenceLabel => 'Refresh / staleness budget';

  @override
  String get riskCadenceWarn =>
      'Snapshot refresh does not outpace the staleness budget; expect denials on freshness.';

  @override
  String get riskReadOnlyNotice =>
      'Read-only by design. Engaging or clearing a switch lives in the admin console, behind reasons and typed confirmations.';

  @override
  String get riskPanelsDegraded =>
      'Some risk panels could not be loaded. Pull down to try again.';

  @override
  String get riskMirrorSection => 'Latest mirror by account';

  @override
  String get riskSwitchesSection => 'Engaged switches';

  @override
  String get riskEventsSection => 'Recent risk events';

  @override
  String get riskNoMirror =>
      'No mirrored account state yet. Until the risk-state worker syncs, the engine denies new orders - that is fail-closed working, not a blank-screen bug.';

  @override
  String get riskNoSwitches =>
      'Nothing is halted. The absence of rows is health here.';

  @override
  String get riskNoEvents => 'No risk events recorded.';

  @override
  String get riskEngagedStopsLabel => 'Engaged stops';

  @override
  String get riskTriggeredProtectionsLabel => 'Triggered protections';

  @override
  String get riskStaleMirrorsLabel => 'Stale mirrors';

  @override
  String get riskSevereEventsLabel => 'Severe events (24h)';

  @override
  String get riskSnapshotLabel => 'Snapshot';

  @override
  String get riskCapturedLabel => 'Captured';

  @override
  String get riskEquityLabel => 'Equity';

  @override
  String get riskDayPnlLabel => 'Net day PnL';

  @override
  String get riskGrossLabel => 'Gross notional';

  @override
  String get riskOpenOrdersLabel => 'Open orders';

  @override
  String get riskStaleSourcesLabel => 'Stale sources';

  @override
  String get riskStaleBadge => 'STALE';

  @override
  String get riskReasonLabel => 'Reason';

  @override
  String get riskEngagedManualLabel => 'manual halt';

  @override
  String get riskExplicitClearNotice =>
      'This protection was triggered by the engine. It cannot be cleared from this app; acknowledge-and-clear lives in the admin console, behind a typed confirmation.';

  @override
  String get riskDisclaimer =>
      'Risk controls reduce operational risk but cannot guarantee against all losses.';

  @override
  String get retry => 'Try again';

  @override
  String get accountDisabled => 'Account disabled';

  @override
  String get accountLabel => 'Account name';

  @override
  String get activityTab => 'Activity';

  @override
  String get allMarkedRead => 'All notifications marked as read';

  @override
  String get allocationLabel => 'Allocation (amount or %)';

  @override
  String get apiKeyLabel => 'API key';

  @override
  String get apiSecretLabel => 'API secret';

  @override
  String get baseCurrencyLabel => 'Base currency';

  @override
  String get checkHealth => 'Check connection';

  @override
  String get confirm => 'Confirm';

  @override
  String get connect => 'Connect';

  @override
  String get connectExchange => 'Connect exchange';

  @override
  String get connectExchangeFirst =>
      'Connect an exchange account first to copy trades.';

  @override
  String get copiesLabel => 'Copies';

  @override
  String get copyAction => 'Copy';

  @override
  String get copyRiskAcknowledgement =>
      'I understand copied trades can lose money, past performance does not predict results, and stopping a copy does not close open positions.';

  @override
  String get copyTradingSubtitle =>
      'Find traders, manage your copies and see copied trades.';

  @override
  String get copyTradingTitle => 'Copy trading';

  @override
  String get copyingAccountLabel => 'Exchange account that copies';

  @override
  String get costBasisLabel => 'Cost basis';

  @override
  String get disable => 'Disable';

  @override
  String get disableAccountMessage =>
      'Copying and trading on this account stop until it is re-enabled from the web console.';

  @override
  String get disableAccountTitle => 'Disable this account?';

  @override
  String get drawdownLabel => 'Max drawdown';

  @override
  String get environmentLabel => 'Environment';

  @override
  String get exchangeAccountsSubtitle =>
      'Connected exchanges, key status and health.';

  @override
  String get exchangeAccountsTitle => 'Exchange accounts';

  @override
  String get exchangeConnected => 'Exchange connected';

  @override
  String get failedLabel => 'Failed';

  @override
  String get fieldRequired => 'Required';

  @override
  String get followersLabel => 'Followers';

  @override
  String get fundingSubtitle => 'Wallets, deposit addresses and transfers.';

  @override
  String get fundingTitle => 'Funding';

  @override
  String get healthCheckDone => 'Connection check finished';

  @override
  String get holdingsLabel => 'Holdings';

  @override
  String get inboxTab => 'Inbox';

  @override
  String get lastErrorLabel => 'Last error';

  @override
  String get lastVerifiedLabel => 'Last verified';

  @override
  String get liveKeyWarning =>
      'LIVE keys trade real funds. Use trade-only keys with withdrawals disabled.';

  @override
  String get liveTradingOffNotice =>
      'Live trading is not enabled for this account.';

  @override
  String get markAllRead => 'Mark all as read';

  @override
  String get markedRead => 'Marked as read';

  @override
  String get maxAllocationLabel => 'Maximum allocation (optional)';

  @override
  String get myCopiesTab => 'My copies';

  @override
  String get navLabel => 'Net asset value';

  @override
  String get noCopyActivity => 'No copied trades yet.';

  @override
  String get noCopyableStrategies =>
      'This trader has no strategy open for copying.';

  @override
  String get noExchangeAccounts =>
      'No exchange accounts yet. Connect one to start.';

  @override
  String get noNotifications => 'No notifications.';

  @override
  String get noPortfolio =>
      'No portfolio has been set up for your account yet.';

  @override
  String get noSubscriptions => 'You are not copying anyone yet.';

  @override
  String get noTraders => 'No traders available.';

  @override
  String get noTransactions => 'No transactions yet.';

  @override
  String get nothingHereYet => 'Nothing here yet.';

  @override
  String get notificationsTitle => 'Notifications';

  @override
  String get partialDataNotice => 'Some data could not be loaded';

  @override
  String get passphraseLabel => 'API passphrase';

  @override
  String get pastPerformanceNotice =>
      'Past performance is not a guarantee of future results.';

  @override
  String get pause => 'Pause';

  @override
  String get paused => 'Copying paused';

  @override
  String get pnlLabel => 'PnL';

  @override
  String get portfolioLabel => 'Portfolio';

  @override
  String get portfolioSubtitle =>
      'Holdings, net asset value and profit and loss.';

  @override
  String get portfolioTitle => 'Portfolio';

  @override
  String get preferencesSaved => 'Preferences saved';

  @override
  String get preferencesTab => 'Preferences';

  @override
  String get resume => 'Resume';

  @override
  String get resumed => 'Copying resumed';

  @override
  String get sizingModeLabel => 'Sizing mode';

  @override
  String get startCopying => 'Start copying';

  @override
  String get startedLabel => 'Started';

  @override
  String get stop => 'Stop';

  @override
  String get stopCopyingMessage =>
      'New trades will no longer be copied. Positions already open stay open until you close them.';

  @override
  String get stopCopyingTitle => 'Stop copying?';

  @override
  String get stopped => 'Copying stopped';

  @override
  String get subscribed => 'You are now copying this strategy';

  @override
  String get tradeOnlyKeysNotice =>
      'Your keys are sent once over an encrypted connection and are never stored on this device.';

  @override
  String get tradersTab => 'Traders';

  @override
  String get transactionsTab => 'Transactions';

  @override
  String get venueLabel => 'Exchange';

  @override
  String get withdrawOnWebNotice =>
      'Withdrawals require policy checks and approval and are available in the web console.';

  @override
  String get accountsTab => 'Accounts';

  @override
  String get noFundingAccounts =>
      'No account yet. Complete onboarding to open one.';

  @override
  String get requestDeposit => 'Request deposit';

  @override
  String get depositRequested => 'Deposit request submitted';

  @override
  String get amountLabel => 'Amount';

  @override
  String get currencyLabel => 'Currency';

  @override
  String get transferReferenceLabel => 'Transfer reference (optional)';

  @override
  String get depositRequestNotice =>
      'A deposit request records the transfer you intend to make. Your balance is credited only after operations confirm the funds were received.';

  @override
  String get invalidAmount => 'Enter an amount greater than zero.';

  @override
  String get invalidCurrency => 'Enter a currency code such as USDT.';

  @override
  String get depositsUnavailable => 'Deposits unavailable';

  @override
  String get depositLabel => 'Deposit';

  @override
  String get withdrawalLabel => 'Withdrawal';

  @override
  String get confirmedAmountLabel => 'Confirmed';

  @override
  String get pendingNotCompleted =>
      'Pending requests are not completed transfers.';
}

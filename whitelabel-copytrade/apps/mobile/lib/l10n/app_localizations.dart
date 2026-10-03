import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_bn.dart';
import 'app_localizations_en.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
      : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
    delegate,
    GlobalMaterialLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
  ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('bn'),
    Locale('en')
  ];

  /// No description provided for @appTitle.
  ///
  /// In en, this message translates to:
  /// **'Copy Trading'**
  String get appTitle;

  /// No description provided for @signIn.
  ///
  /// In en, this message translates to:
  /// **'Sign in'**
  String get signIn;

  /// No description provided for @signOut.
  ///
  /// In en, this message translates to:
  /// **'Sign out'**
  String get signOut;

  /// No description provided for @emailLabel.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get emailLabel;

  /// No description provided for @passwordLabel.
  ///
  /// In en, this message translates to:
  /// **'Password'**
  String get passwordLabel;

  /// No description provided for @signInSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Sign in to your account to continue.'**
  String get signInSubtitle;

  /// No description provided for @twoFactorTitle.
  ///
  /// In en, this message translates to:
  /// **'Two-factor authentication'**
  String get twoFactorTitle;

  /// No description provided for @twoFactorSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Enter the six-digit code from your authenticator app.'**
  String get twoFactorSubtitle;

  /// No description provided for @twoFactorCodeLabel.
  ///
  /// In en, this message translates to:
  /// **'Authentication code'**
  String get twoFactorCodeLabel;

  /// No description provided for @recoveryCodeLabel.
  ///
  /// In en, this message translates to:
  /// **'Recovery code'**
  String get recoveryCodeLabel;

  /// No description provided for @useRecoveryCode.
  ///
  /// In en, this message translates to:
  /// **'Use a recovery code instead'**
  String get useRecoveryCode;

  /// No description provided for @useAuthenticator.
  ///
  /// In en, this message translates to:
  /// **'Use my authenticator app instead'**
  String get useAuthenticator;

  /// No description provided for @verify.
  ///
  /// In en, this message translates to:
  /// **'Verify'**
  String get verify;

  /// No description provided for @cancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get cancel;

  /// No description provided for @homeTitle.
  ///
  /// In en, this message translates to:
  /// **'Overview'**
  String get homeTitle;

  /// No description provided for @settingsTitle.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get settingsTitle;

  /// No description provided for @securityTitle.
  ///
  /// In en, this message translates to:
  /// **'Security'**
  String get securityTitle;

  /// No description provided for @loading.
  ///
  /// In en, this message translates to:
  /// **'Loading'**
  String get loading;

  /// No description provided for @emailRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter your email address'**
  String get emailRequired;

  /// No description provided for @emailInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid email address'**
  String get emailInvalid;

  /// No description provided for @passwordRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter your password'**
  String get passwordRequired;

  /// No description provided for @codeRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter your authentication code'**
  String get codeRequired;

  /// No description provided for @genericError.
  ///
  /// In en, this message translates to:
  /// **'Something went wrong. Please try again.'**
  String get genericError;

  /// No description provided for @sessionExpired.
  ///
  /// In en, this message translates to:
  /// **'Your session has expired. Please sign in again.'**
  String get sessionExpired;

  /// No description provided for @welcomeBack.
  ///
  /// In en, this message translates to:
  /// **'Welcome back'**
  String get welcomeBack;

  /// No description provided for @accountSection.
  ///
  /// In en, this message translates to:
  /// **'Account'**
  String get accountSection;

  /// No description provided for @securitySection.
  ///
  /// In en, this message translates to:
  /// **'Security'**
  String get securitySection;

  /// No description provided for @twoFactorEnabled.
  ///
  /// In en, this message translates to:
  /// **'Two-factor authentication is on'**
  String get twoFactorEnabled;

  /// No description provided for @twoFactorDisabled.
  ///
  /// In en, this message translates to:
  /// **'Two-factor authentication is off'**
  String get twoFactorDisabled;

  /// No description provided for @activeSessions.
  ///
  /// In en, this message translates to:
  /// **'Active devices'**
  String get activeSessions;

  /// No description provided for @changePassword.
  ///
  /// In en, this message translates to:
  /// **'Change password'**
  String get changePassword;

  /// No description provided for @executionDisabledNotice.
  ///
  /// In en, this message translates to:
  /// **'Live order execution is disabled on this build.'**
  String get executionDisabledNotice;

  /// No description provided for @strategiesTitle.
  ///
  /// In en, this message translates to:
  /// **'Strategies'**
  String get strategiesTitle;

  /// No description provided for @strategiesSubtitle.
  ///
  /// In en, this message translates to:
  /// **'View strategy health and simulated results.'**
  String get strategiesSubtitle;

  /// No description provided for @strategyReadOnlyNotice.
  ///
  /// In en, this message translates to:
  /// **'This screen is read-only. Strategies are started, stopped and configured from the admin console.'**
  String get strategyReadOnlyNotice;

  /// No description provided for @strategyPanelsDegraded.
  ///
  /// In en, this message translates to:
  /// **'Some panels could not be loaded. Pull down to try again.'**
  String get strategyPanelsDegraded;

  /// No description provided for @liveExecutionReachable.
  ///
  /// In en, this message translates to:
  /// **'Live execution is reachable in this deployment'**
  String get liveExecutionReachable;

  /// No description provided for @liveExecutionNotReachable.
  ///
  /// In en, this message translates to:
  /// **'Live execution is not reachable in this deployment'**
  String get liveExecutionNotReachable;

  /// No description provided for @strategyEngineLabel.
  ///
  /// In en, this message translates to:
  /// **'Strategy engine'**
  String get strategyEngineLabel;

  /// No description provided for @paperTradingLabel.
  ///
  /// In en, this message translates to:
  /// **'Paper trading'**
  String get paperTradingLabel;

  /// No description provided for @backtestingLabel.
  ///
  /// In en, this message translates to:
  /// **'Backtesting'**
  String get backtestingLabel;

  /// No description provided for @tradingModeLabel.
  ///
  /// In en, this message translates to:
  /// **'Mode'**
  String get tradingModeLabel;

  /// No description provided for @strategyInstancesSection.
  ///
  /// In en, this message translates to:
  /// **'Instances'**
  String get strategyInstancesSection;

  /// No description provided for @paperSessionsSection.
  ///
  /// In en, this message translates to:
  /// **'Paper sessions'**
  String get paperSessionsSection;

  /// No description provided for @backtestsSection.
  ///
  /// In en, this message translates to:
  /// **'Backtests'**
  String get backtestsSection;

  /// No description provided for @strategyNoInstances.
  ///
  /// In en, this message translates to:
  /// **'No strategy instances have been created.'**
  String get strategyNoInstances;

  /// No description provided for @strategyNoPaperSessions.
  ///
  /// In en, this message translates to:
  /// **'No paper sessions have been run.'**
  String get strategyNoPaperSessions;

  /// No description provided for @strategyNoBacktests.
  ///
  /// In en, this message translates to:
  /// **'No backtests have been run.'**
  String get strategyNoBacktests;

  /// No description provided for @instancesLabel.
  ///
  /// In en, this message translates to:
  /// **'Instances'**
  String get instancesLabel;

  /// No description provided for @runningLabel.
  ///
  /// In en, this message translates to:
  /// **'Running'**
  String get runningLabel;

  /// No description provided for @needsAttentionLabel.
  ///
  /// In en, this message translates to:
  /// **'Needs attention'**
  String get needsAttentionLabel;

  /// No description provided for @openIncidentsLabel.
  ///
  /// In en, this message translates to:
  /// **'Open incidents'**
  String get openIncidentsLabel;

  /// No description provided for @enabledLabel.
  ///
  /// In en, this message translates to:
  /// **'Enabled'**
  String get enabledLabel;

  /// No description provided for @disabledLabel.
  ///
  /// In en, this message translates to:
  /// **'Disabled'**
  String get disabledLabel;

  /// No description provided for @consecutiveErrorsLabel.
  ///
  /// In en, this message translates to:
  /// **'Consecutive errors'**
  String get consecutiveErrorsLabel;

  /// No description provided for @lastHeartbeatLabel.
  ///
  /// In en, this message translates to:
  /// **'Last heartbeat'**
  String get lastHeartbeatLabel;

  /// No description provided for @noHeartbeatYet.
  ///
  /// In en, this message translates to:
  /// **'No heartbeat reported yet'**
  String get noHeartbeatYet;

  /// No description provided for @statusLabel.
  ///
  /// In en, this message translates to:
  /// **'Status'**
  String get statusLabel;

  /// No description provided for @equityLabel.
  ///
  /// In en, this message translates to:
  /// **'Equity'**
  String get equityLabel;

  /// No description provided for @realisedPnlLabel.
  ///
  /// In en, this message translates to:
  /// **'Realised PnL'**
  String get realisedPnlLabel;

  /// No description provided for @netPnlLabel.
  ///
  /// In en, this message translates to:
  /// **'Net PnL'**
  String get netPnlLabel;

  /// No description provided for @tradesLabel.
  ///
  /// In en, this message translates to:
  /// **'Trades'**
  String get tradesLabel;

  /// No description provided for @winRateLabel.
  ///
  /// In en, this message translates to:
  /// **'Win rate'**
  String get winRateLabel;

  /// No description provided for @sharpeLabel.
  ///
  /// In en, this message translates to:
  /// **'Sharpe'**
  String get sharpeLabel;

  /// No description provided for @maxDrawdownLabel.
  ///
  /// In en, this message translates to:
  /// **'Max drawdown'**
  String get maxDrawdownLabel;

  /// No description provided for @simulatedFillsLabel.
  ///
  /// In en, this message translates to:
  /// **'Orders / fills'**
  String get simulatedFillsLabel;

  /// No description provided for @riskRejectionsLabel.
  ///
  /// In en, this message translates to:
  /// **'Risk rejections'**
  String get riskRejectionsLabel;

  /// No description provided for @simulatedBadge.
  ///
  /// In en, this message translates to:
  /// **'SIMULATED'**
  String get simulatedBadge;

  /// No description provided for @insufficientData.
  ///
  /// In en, this message translates to:
  /// **'Insufficient data'**
  String get insufficientData;

  /// No description provided for @notAvailableShort.
  ///
  /// In en, this message translates to:
  /// **'N/A'**
  String get notAvailableShort;

  /// No description provided for @statusQueued.
  ///
  /// In en, this message translates to:
  /// **'Queued'**
  String get statusQueued;

  /// No description provided for @statusRunning.
  ///
  /// In en, this message translates to:
  /// **'Running'**
  String get statusRunning;

  /// No description provided for @statusCompleted.
  ///
  /// In en, this message translates to:
  /// **'Completed'**
  String get statusCompleted;

  /// No description provided for @statusStopped.
  ///
  /// In en, this message translates to:
  /// **'Stopped'**
  String get statusStopped;

  /// No description provided for @statusFailed.
  ///
  /// In en, this message translates to:
  /// **'Failed'**
  String get statusFailed;

  /// No description provided for @statusCancelled.
  ///
  /// In en, this message translates to:
  /// **'Cancelled'**
  String get statusCancelled;

  /// No description provided for @backtestNotReproducible.
  ///
  /// In en, this message translates to:
  /// **'This run has no dataset checksum and cannot be reproduced exactly.'**
  String get backtestNotReproducible;

  /// No description provided for @simulationDisclaimerTitle.
  ///
  /// In en, this message translates to:
  /// **'About these numbers'**
  String get simulationDisclaimerTitle;

  /// No description provided for @backtestDisclaimer.
  ///
  /// In en, this message translates to:
  /// **'Backtest performance is not indicative of future performance.'**
  String get backtestDisclaimer;

  /// No description provided for @paperDisclaimer.
  ///
  /// In en, this message translates to:
  /// **'Paper performance is not indicative of live performance.'**
  String get paperDisclaimer;

  /// No description provided for @executionQualityDisclaimer.
  ///
  /// In en, this message translates to:
  /// **'Simulation does not guarantee real execution quality.'**
  String get executionQualityDisclaimer;

  /// No description provided for @insufficientDataDisclaimer.
  ///
  /// In en, this message translates to:
  /// **'Risk-adjusted figures are withheld when there were too few observations. Insufficient data is not zero.'**
  String get insufficientDataDisclaimer;

  /// No description provided for @riskTitle.
  ///
  /// In en, this message translates to:
  /// **'Risk'**
  String get riskTitle;

  /// No description provided for @riskSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Halt status and mirror freshness for your organisation.'**
  String get riskSubtitle;

  /// No description provided for @riskEngineOn.
  ///
  /// In en, this message translates to:
  /// **'Risk engine is in the order path'**
  String get riskEngineOn;

  /// No description provided for @riskEngineOff.
  ///
  /// In en, this message translates to:
  /// **'Risk engine disabled - local tooling mode'**
  String get riskEngineOff;

  /// No description provided for @riskFailClosedLabel.
  ///
  /// In en, this message translates to:
  /// **'Fail-closed'**
  String get riskFailClosedLabel;

  /// No description provided for @riskCadenceLabel.
  ///
  /// In en, this message translates to:
  /// **'Refresh / staleness budget'**
  String get riskCadenceLabel;

  /// No description provided for @riskCadenceWarn.
  ///
  /// In en, this message translates to:
  /// **'Snapshot refresh does not outpace the staleness budget; expect denials on freshness.'**
  String get riskCadenceWarn;

  /// No description provided for @riskReadOnlyNotice.
  ///
  /// In en, this message translates to:
  /// **'Read-only by design. Engaging or clearing a switch lives in the admin console, behind reasons and typed confirmations.'**
  String get riskReadOnlyNotice;

  /// No description provided for @riskPanelsDegraded.
  ///
  /// In en, this message translates to:
  /// **'Some risk panels could not be loaded. Pull down to try again.'**
  String get riskPanelsDegraded;

  /// No description provided for @riskMirrorSection.
  ///
  /// In en, this message translates to:
  /// **'Latest mirror by account'**
  String get riskMirrorSection;

  /// No description provided for @riskSwitchesSection.
  ///
  /// In en, this message translates to:
  /// **'Engaged switches'**
  String get riskSwitchesSection;

  /// No description provided for @riskEventsSection.
  ///
  /// In en, this message translates to:
  /// **'Recent risk events'**
  String get riskEventsSection;

  /// No description provided for @riskNoMirror.
  ///
  /// In en, this message translates to:
  /// **'No mirrored account state yet. Until the risk-state worker syncs, the engine denies new orders - that is fail-closed working, not a blank-screen bug.'**
  String get riskNoMirror;

  /// No description provided for @riskNoSwitches.
  ///
  /// In en, this message translates to:
  /// **'Nothing is halted. The absence of rows is health here.'**
  String get riskNoSwitches;

  /// No description provided for @riskNoEvents.
  ///
  /// In en, this message translates to:
  /// **'No risk events recorded.'**
  String get riskNoEvents;

  /// No description provided for @riskEngagedStopsLabel.
  ///
  /// In en, this message translates to:
  /// **'Engaged stops'**
  String get riskEngagedStopsLabel;

  /// No description provided for @riskTriggeredProtectionsLabel.
  ///
  /// In en, this message translates to:
  /// **'Triggered protections'**
  String get riskTriggeredProtectionsLabel;

  /// No description provided for @riskStaleMirrorsLabel.
  ///
  /// In en, this message translates to:
  /// **'Stale mirrors'**
  String get riskStaleMirrorsLabel;

  /// No description provided for @riskSevereEventsLabel.
  ///
  /// In en, this message translates to:
  /// **'Severe events (24h)'**
  String get riskSevereEventsLabel;

  /// No description provided for @riskSnapshotLabel.
  ///
  /// In en, this message translates to:
  /// **'Snapshot'**
  String get riskSnapshotLabel;

  /// No description provided for @riskCapturedLabel.
  ///
  /// In en, this message translates to:
  /// **'Captured'**
  String get riskCapturedLabel;

  /// No description provided for @riskEquityLabel.
  ///
  /// In en, this message translates to:
  /// **'Equity'**
  String get riskEquityLabel;

  /// No description provided for @riskDayPnlLabel.
  ///
  /// In en, this message translates to:
  /// **'Net day PnL'**
  String get riskDayPnlLabel;

  /// No description provided for @riskGrossLabel.
  ///
  /// In en, this message translates to:
  /// **'Gross notional'**
  String get riskGrossLabel;

  /// No description provided for @riskOpenOrdersLabel.
  ///
  /// In en, this message translates to:
  /// **'Open orders'**
  String get riskOpenOrdersLabel;

  /// No description provided for @riskStaleSourcesLabel.
  ///
  /// In en, this message translates to:
  /// **'Stale sources'**
  String get riskStaleSourcesLabel;

  /// No description provided for @riskStaleBadge.
  ///
  /// In en, this message translates to:
  /// **'STALE'**
  String get riskStaleBadge;

  /// No description provided for @riskReasonLabel.
  ///
  /// In en, this message translates to:
  /// **'Reason'**
  String get riskReasonLabel;

  /// No description provided for @riskEngagedManualLabel.
  ///
  /// In en, this message translates to:
  /// **'manual halt'**
  String get riskEngagedManualLabel;

  /// No description provided for @riskExplicitClearNotice.
  ///
  /// In en, this message translates to:
  /// **'This protection was triggered by the engine. It cannot be cleared from this app; acknowledge-and-clear lives in the admin console, behind a typed confirmation.'**
  String get riskExplicitClearNotice;

  /// No description provided for @riskDisclaimer.
  ///
  /// In en, this message translates to:
  /// **'Risk controls reduce operational risk but cannot guarantee against all losses.'**
  String get riskDisclaimer;

  /// No description provided for @retry.
  ///
  /// In en, this message translates to:
  /// **'Try again'**
  String get retry;

  /// No description provided for @accountDisabled.
  ///
  /// In en, this message translates to:
  /// **'Account disabled'**
  String get accountDisabled;

  /// No description provided for @accountLabel.
  ///
  /// In en, this message translates to:
  /// **'Account name'**
  String get accountLabel;

  /// No description provided for @activityTab.
  ///
  /// In en, this message translates to:
  /// **'Activity'**
  String get activityTab;

  /// No description provided for @allMarkedRead.
  ///
  /// In en, this message translates to:
  /// **'All notifications marked as read'**
  String get allMarkedRead;

  /// No description provided for @allocationLabel.
  ///
  /// In en, this message translates to:
  /// **'Allocation (amount or %)'**
  String get allocationLabel;

  /// No description provided for @apiKeyLabel.
  ///
  /// In en, this message translates to:
  /// **'API key'**
  String get apiKeyLabel;

  /// No description provided for @apiSecretLabel.
  ///
  /// In en, this message translates to:
  /// **'API secret'**
  String get apiSecretLabel;

  /// No description provided for @baseCurrencyLabel.
  ///
  /// In en, this message translates to:
  /// **'Base currency'**
  String get baseCurrencyLabel;

  /// No description provided for @checkHealth.
  ///
  /// In en, this message translates to:
  /// **'Check connection'**
  String get checkHealth;

  /// No description provided for @confirm.
  ///
  /// In en, this message translates to:
  /// **'Confirm'**
  String get confirm;

  /// No description provided for @connect.
  ///
  /// In en, this message translates to:
  /// **'Connect'**
  String get connect;

  /// No description provided for @connectExchange.
  ///
  /// In en, this message translates to:
  /// **'Connect exchange'**
  String get connectExchange;

  /// No description provided for @connectExchangeFirst.
  ///
  /// In en, this message translates to:
  /// **'Connect an exchange account first to copy trades.'**
  String get connectExchangeFirst;

  /// No description provided for @copiesLabel.
  ///
  /// In en, this message translates to:
  /// **'Copies'**
  String get copiesLabel;

  /// No description provided for @copyAction.
  ///
  /// In en, this message translates to:
  /// **'Copy'**
  String get copyAction;

  /// No description provided for @copyRiskAcknowledgement.
  ///
  /// In en, this message translates to:
  /// **'I understand copied trades can lose money, past performance does not predict results, and stopping a copy does not close open positions.'**
  String get copyRiskAcknowledgement;

  /// No description provided for @copyTradingSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Find traders, manage your copies and see copied trades.'**
  String get copyTradingSubtitle;

  /// No description provided for @copyTradingTitle.
  ///
  /// In en, this message translates to:
  /// **'Copy trading'**
  String get copyTradingTitle;

  /// No description provided for @copyingAccountLabel.
  ///
  /// In en, this message translates to:
  /// **'Exchange account that copies'**
  String get copyingAccountLabel;

  /// No description provided for @costBasisLabel.
  ///
  /// In en, this message translates to:
  /// **'Cost basis'**
  String get costBasisLabel;

  /// No description provided for @disable.
  ///
  /// In en, this message translates to:
  /// **'Disable'**
  String get disable;

  /// No description provided for @disableAccountMessage.
  ///
  /// In en, this message translates to:
  /// **'Copying and trading on this account stop until it is re-enabled from the web console.'**
  String get disableAccountMessage;

  /// No description provided for @disableAccountTitle.
  ///
  /// In en, this message translates to:
  /// **'Disable this account?'**
  String get disableAccountTitle;

  /// No description provided for @drawdownLabel.
  ///
  /// In en, this message translates to:
  /// **'Max drawdown'**
  String get drawdownLabel;

  /// No description provided for @environmentLabel.
  ///
  /// In en, this message translates to:
  /// **'Environment'**
  String get environmentLabel;

  /// No description provided for @exchangeAccountsSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Connected exchanges, key status and health.'**
  String get exchangeAccountsSubtitle;

  /// No description provided for @exchangeAccountsTitle.
  ///
  /// In en, this message translates to:
  /// **'Exchange accounts'**
  String get exchangeAccountsTitle;

  /// No description provided for @exchangeConnected.
  ///
  /// In en, this message translates to:
  /// **'Exchange connected'**
  String get exchangeConnected;

  /// No description provided for @failedLabel.
  ///
  /// In en, this message translates to:
  /// **'Failed'**
  String get failedLabel;

  /// No description provided for @fieldRequired.
  ///
  /// In en, this message translates to:
  /// **'Required'**
  String get fieldRequired;

  /// No description provided for @followersLabel.
  ///
  /// In en, this message translates to:
  /// **'Followers'**
  String get followersLabel;

  /// No description provided for @fundingSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Wallets, deposit addresses and transfers.'**
  String get fundingSubtitle;

  /// No description provided for @fundingTitle.
  ///
  /// In en, this message translates to:
  /// **'Funding'**
  String get fundingTitle;

  /// No description provided for @healthCheckDone.
  ///
  /// In en, this message translates to:
  /// **'Connection check finished'**
  String get healthCheckDone;

  /// No description provided for @holdingsLabel.
  ///
  /// In en, this message translates to:
  /// **'Holdings'**
  String get holdingsLabel;

  /// No description provided for @inboxTab.
  ///
  /// In en, this message translates to:
  /// **'Inbox'**
  String get inboxTab;

  /// No description provided for @lastErrorLabel.
  ///
  /// In en, this message translates to:
  /// **'Last error'**
  String get lastErrorLabel;

  /// No description provided for @lastVerifiedLabel.
  ///
  /// In en, this message translates to:
  /// **'Last verified'**
  String get lastVerifiedLabel;

  /// No description provided for @liveKeyWarning.
  ///
  /// In en, this message translates to:
  /// **'LIVE keys trade real funds. Use trade-only keys with withdrawals disabled.'**
  String get liveKeyWarning;

  /// No description provided for @liveTradingOffNotice.
  ///
  /// In en, this message translates to:
  /// **'Live trading is not enabled for this account.'**
  String get liveTradingOffNotice;

  /// No description provided for @markAllRead.
  ///
  /// In en, this message translates to:
  /// **'Mark all as read'**
  String get markAllRead;

  /// No description provided for @markedRead.
  ///
  /// In en, this message translates to:
  /// **'Marked as read'**
  String get markedRead;

  /// No description provided for @maxAllocationLabel.
  ///
  /// In en, this message translates to:
  /// **'Maximum allocation (optional)'**
  String get maxAllocationLabel;

  /// No description provided for @myCopiesTab.
  ///
  /// In en, this message translates to:
  /// **'My copies'**
  String get myCopiesTab;

  /// No description provided for @navLabel.
  ///
  /// In en, this message translates to:
  /// **'Net asset value'**
  String get navLabel;

  /// No description provided for @noCopyActivity.
  ///
  /// In en, this message translates to:
  /// **'No copied trades yet.'**
  String get noCopyActivity;

  /// No description provided for @noCopyableStrategies.
  ///
  /// In en, this message translates to:
  /// **'This trader has no strategy open for copying.'**
  String get noCopyableStrategies;

  /// No description provided for @noExchangeAccounts.
  ///
  /// In en, this message translates to:
  /// **'No exchange accounts yet. Connect one to start.'**
  String get noExchangeAccounts;

  /// No description provided for @noNotifications.
  ///
  /// In en, this message translates to:
  /// **'No notifications.'**
  String get noNotifications;

  /// No description provided for @noPortfolio.
  ///
  /// In en, this message translates to:
  /// **'No portfolio has been set up for your account yet.'**
  String get noPortfolio;

  /// No description provided for @noSubscriptions.
  ///
  /// In en, this message translates to:
  /// **'You are not copying anyone yet.'**
  String get noSubscriptions;

  /// No description provided for @noTraders.
  ///
  /// In en, this message translates to:
  /// **'No traders available.'**
  String get noTraders;

  /// No description provided for @noTransactions.
  ///
  /// In en, this message translates to:
  /// **'No transactions yet.'**
  String get noTransactions;

  /// No description provided for @nothingHereYet.
  ///
  /// In en, this message translates to:
  /// **'Nothing here yet.'**
  String get nothingHereYet;

  /// No description provided for @notificationsTitle.
  ///
  /// In en, this message translates to:
  /// **'Notifications'**
  String get notificationsTitle;

  /// No description provided for @partialDataNotice.
  ///
  /// In en, this message translates to:
  /// **'Some data could not be loaded'**
  String get partialDataNotice;

  /// No description provided for @passphraseLabel.
  ///
  /// In en, this message translates to:
  /// **'API passphrase'**
  String get passphraseLabel;

  /// No description provided for @pastPerformanceNotice.
  ///
  /// In en, this message translates to:
  /// **'Past performance is not a guarantee of future results.'**
  String get pastPerformanceNotice;

  /// No description provided for @pause.
  ///
  /// In en, this message translates to:
  /// **'Pause'**
  String get pause;

  /// No description provided for @paused.
  ///
  /// In en, this message translates to:
  /// **'Copying paused'**
  String get paused;

  /// No description provided for @pnlLabel.
  ///
  /// In en, this message translates to:
  /// **'PnL'**
  String get pnlLabel;

  /// No description provided for @portfolioLabel.
  ///
  /// In en, this message translates to:
  /// **'Portfolio'**
  String get portfolioLabel;

  /// No description provided for @portfolioSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Holdings, net asset value and profit and loss.'**
  String get portfolioSubtitle;

  /// No description provided for @portfolioTitle.
  ///
  /// In en, this message translates to:
  /// **'Portfolio'**
  String get portfolioTitle;

  /// No description provided for @preferencesSaved.
  ///
  /// In en, this message translates to:
  /// **'Preferences saved'**
  String get preferencesSaved;

  /// No description provided for @preferencesTab.
  ///
  /// In en, this message translates to:
  /// **'Preferences'**
  String get preferencesTab;

  /// No description provided for @resume.
  ///
  /// In en, this message translates to:
  /// **'Resume'**
  String get resume;

  /// No description provided for @resumed.
  ///
  /// In en, this message translates to:
  /// **'Copying resumed'**
  String get resumed;

  /// No description provided for @sizingModeLabel.
  ///
  /// In en, this message translates to:
  /// **'Sizing mode'**
  String get sizingModeLabel;

  /// No description provided for @startCopying.
  ///
  /// In en, this message translates to:
  /// **'Start copying'**
  String get startCopying;

  /// No description provided for @startedLabel.
  ///
  /// In en, this message translates to:
  /// **'Started'**
  String get startedLabel;

  /// No description provided for @stop.
  ///
  /// In en, this message translates to:
  /// **'Stop'**
  String get stop;

  /// No description provided for @stopCopyingMessage.
  ///
  /// In en, this message translates to:
  /// **'New trades will no longer be copied. Positions already open stay open until you close them.'**
  String get stopCopyingMessage;

  /// No description provided for @stopCopyingTitle.
  ///
  /// In en, this message translates to:
  /// **'Stop copying?'**
  String get stopCopyingTitle;

  /// No description provided for @stopped.
  ///
  /// In en, this message translates to:
  /// **'Copying stopped'**
  String get stopped;

  /// No description provided for @subscribed.
  ///
  /// In en, this message translates to:
  /// **'You are now copying this strategy'**
  String get subscribed;

  /// No description provided for @tradeOnlyKeysNotice.
  ///
  /// In en, this message translates to:
  /// **'Your keys are sent once over an encrypted connection and are never stored on this device.'**
  String get tradeOnlyKeysNotice;

  /// No description provided for @tradersTab.
  ///
  /// In en, this message translates to:
  /// **'Traders'**
  String get tradersTab;

  /// No description provided for @transactionsTab.
  ///
  /// In en, this message translates to:
  /// **'Transactions'**
  String get transactionsTab;

  /// No description provided for @venueLabel.
  ///
  /// In en, this message translates to:
  /// **'Exchange'**
  String get venueLabel;

  /// No description provided for @withdrawOnWebNotice.
  ///
  /// In en, this message translates to:
  /// **'Withdrawals require policy checks and approval and are available in the web console.'**
  String get withdrawOnWebNotice;

  /// No description provided for @accountsTab.
  ///
  /// In en, this message translates to:
  /// **'Accounts'**
  String get accountsTab;

  /// No description provided for @noFundingAccounts.
  ///
  /// In en, this message translates to:
  /// **'No account yet. Complete onboarding to open one.'**
  String get noFundingAccounts;

  /// No description provided for @requestDeposit.
  ///
  /// In en, this message translates to:
  /// **'Request deposit'**
  String get requestDeposit;

  /// No description provided for @depositRequested.
  ///
  /// In en, this message translates to:
  /// **'Deposit request submitted'**
  String get depositRequested;

  /// No description provided for @amountLabel.
  ///
  /// In en, this message translates to:
  /// **'Amount'**
  String get amountLabel;

  /// No description provided for @currencyLabel.
  ///
  /// In en, this message translates to:
  /// **'Currency'**
  String get currencyLabel;

  /// No description provided for @transferReferenceLabel.
  ///
  /// In en, this message translates to:
  /// **'Transfer reference (optional)'**
  String get transferReferenceLabel;

  /// No description provided for @depositRequestNotice.
  ///
  /// In en, this message translates to:
  /// **'A deposit request records the transfer you intend to make. Your balance is credited only after operations confirm the funds were received.'**
  String get depositRequestNotice;

  /// No description provided for @invalidAmount.
  ///
  /// In en, this message translates to:
  /// **'Enter an amount greater than zero.'**
  String get invalidAmount;

  /// No description provided for @invalidCurrency.
  ///
  /// In en, this message translates to:
  /// **'Enter a currency code such as USDT.'**
  String get invalidCurrency;

  /// No description provided for @depositsUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Deposits unavailable'**
  String get depositsUnavailable;

  /// No description provided for @depositLabel.
  ///
  /// In en, this message translates to:
  /// **'Deposit'**
  String get depositLabel;

  /// No description provided for @withdrawalLabel.
  ///
  /// In en, this message translates to:
  /// **'Withdrawal'**
  String get withdrawalLabel;

  /// No description provided for @confirmedAmountLabel.
  ///
  /// In en, this message translates to:
  /// **'Confirmed'**
  String get confirmedAmountLabel;

  /// No description provided for @pendingNotCompleted.
  ///
  /// In en, this message translates to:
  /// **'Pending requests are not completed transfers.'**
  String get pendingNotCompleted;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['bn', 'en'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'bn':
      return AppLocalizationsBn();
    case 'en':
      return AppLocalizationsEn();
  }

  throw FlutterError(
      'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
      'an issue with the localizations generation tool. Please file an issue '
      'on GitHub with a reproducible sample app and the gen-l10n configuration '
      'that was used.');
}

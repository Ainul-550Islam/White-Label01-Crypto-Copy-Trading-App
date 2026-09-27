import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_bn.dart';
import 'app_localizations_en.dart';

/// A class that all localization delegate instances should extend.
///
/// This class is the base class for all generated localizations classes.
abstract class AppLocalizations {
  AppLocalizations(String locale) : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate = _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate and the
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate delegates.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used if the locales the
  /// app supports are just English (en) and Bangla (bn).
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates = <LocalizationsDelegate<dynamic>>[
    delegate,
    GlobalMaterialLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
  ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('bn'),
    Locale('en'),
  ];

  /// No description provided for @accountSection.
  ///
  /// In en, this message translates to:
  /// **'Account'**
  String get accountSection;

  /// No description provided for @activeSessions.
  ///
  /// In en, this message translates to:
  /// **'Active devices'**
  String get activeSessions;

  /// No description provided for @appTitle.
  ///
  /// In en, this message translates to:
  /// **'Copy Trading'**
  String get appTitle;

  /// No description provided for @backtestDisclaimer.
  ///
  /// In en, this message translates to:
  /// **'Backtest performance is not indicative of future performance.'**
  String get backtestDisclaimer;

  /// No description provided for @backtestNotReproducible.
  ///
  /// In en, this message translates to:
  /// **'This run has no dataset checksum and cannot be reproduced exactly.'**
  String get backtestNotReproducible;

  /// No description provided for @backtestingLabel.
  ///
  /// In en, this message translates to:
  /// **'Backtesting'**
  String get backtestingLabel;

  /// No description provided for @backtestsSection.
  ///
  /// In en, this message translates to:
  /// **'Backtests'**
  String get backtestsSection;

  /// No description provided for @cancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get cancel;

  /// No description provided for @changePassword.
  ///
  /// In en, this message translates to:
  /// **'Change password'**
  String get changePassword;

  /// No description provided for @codeRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter your authentication code'**
  String get codeRequired;

  /// No description provided for @consecutiveErrorsLabel.
  ///
  /// In en, this message translates to:
  /// **'Consecutive errors'**
  String get consecutiveErrorsLabel;

  /// No description provided for @disabledLabel.
  ///
  /// In en, this message translates to:
  /// **'Disabled'**
  String get disabledLabel;

  /// No description provided for @emailInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid email address'**
  String get emailInvalid;

  /// No description provided for @emailLabel.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get emailLabel;

  /// No description provided for @emailRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter your email address'**
  String get emailRequired;

  /// No description provided for @enabledLabel.
  ///
  /// In en, this message translates to:
  /// **'Enabled'**
  String get enabledLabel;

  /// No description provided for @equityLabel.
  ///
  /// In en, this message translates to:
  /// **'Equity'**
  String get equityLabel;

  /// No description provided for @executionDisabledNotice.
  ///
  /// In en, this message translates to:
  /// **'Live order execution is disabled on this build.'**
  String get executionDisabledNotice;

  /// No description provided for @executionQualityDisclaimer.
  ///
  /// In en, this message translates to:
  /// **'Simulation does not guarantee real execution quality.'**
  String get executionQualityDisclaimer;

  /// No description provided for @genericError.
  ///
  /// In en, this message translates to:
  /// **'Something went wrong. Please try again.'**
  String get genericError;

  /// No description provided for @homeTitle.
  ///
  /// In en, this message translates to:
  /// **'Overview'**
  String get homeTitle;

  /// No description provided for @instancesLabel.
  ///
  /// In en, this message translates to:
  /// **'Instances'**
  String get instancesLabel;

  /// No description provided for @insufficientData.
  ///
  /// In en, this message translates to:
  /// **'Insufficient data'**
  String get insufficientData;

  /// No description provided for @insufficientDataDisclaimer.
  ///
  /// In en, this message translates to:
  /// **'Risk-adjusted figures are withheld when there were too few observations. Insufficient data is not zero.'**
  String get insufficientDataDisclaimer;

  /// No description provided for @lastHeartbeatLabel.
  ///
  /// In en, this message translates to:
  /// **'Last heartbeat'**
  String get lastHeartbeatLabel;

  /// No description provided for @liveExecutionNotReachable.
  ///
  /// In en, this message translates to:
  /// **'Live execution is not reachable in this deployment'**
  String get liveExecutionNotReachable;

  /// No description provided for @liveExecutionReachable.
  ///
  /// In en, this message translates to:
  /// **'Live execution is reachable in this deployment'**
  String get liveExecutionReachable;

  /// No description provided for @loading.
  ///
  /// In en, this message translates to:
  /// **'Loading'**
  String get loading;

  /// No description provided for @maxDrawdownLabel.
  ///
  /// In en, this message translates to:
  /// **'Max drawdown'**
  String get maxDrawdownLabel;

  /// No description provided for @needsAttentionLabel.
  ///
  /// In en, this message translates to:
  /// **'Needs attention'**
  String get needsAttentionLabel;

  /// No description provided for @netPnlLabel.
  ///
  /// In en, this message translates to:
  /// **'Net PnL'**
  String get netPnlLabel;

  /// No description provided for @noHeartbeatYet.
  ///
  /// In en, this message translates to:
  /// **'No heartbeat reported yet'**
  String get noHeartbeatYet;

  /// No description provided for @notAvailableShort.
  ///
  /// In en, this message translates to:
  /// **'N/A'**
  String get notAvailableShort;

  /// No description provided for @openIncidentsLabel.
  ///
  /// In en, this message translates to:
  /// **'Open incidents'**
  String get openIncidentsLabel;

  /// No description provided for @paperDisclaimer.
  ///
  /// In en, this message translates to:
  /// **'Paper performance is not indicative of live performance.'**
  String get paperDisclaimer;

  /// No description provided for @paperSessionsSection.
  ///
  /// In en, this message translates to:
  /// **'Paper sessions'**
  String get paperSessionsSection;

  /// No description provided for @paperTradingLabel.
  ///
  /// In en, this message translates to:
  /// **'Paper trading'**
  String get paperTradingLabel;

  /// No description provided for @passwordLabel.
  ///
  /// In en, this message translates to:
  /// **'Password'**
  String get passwordLabel;

  /// No description provided for @passwordRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter your password'**
  String get passwordRequired;

  /// No description provided for @realisedPnlLabel.
  ///
  /// In en, this message translates to:
  /// **'Realised PnL'**
  String get realisedPnlLabel;

  /// No description provided for @recoveryCodeLabel.
  ///
  /// In en, this message translates to:
  /// **'Recovery code'**
  String get recoveryCodeLabel;

  /// No description provided for @retry.
  ///
  /// In en, this message translates to:
  /// **'Try again'**
  String get retry;

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

  /// No description provided for @riskCapturedLabel.
  ///
  /// In en, this message translates to:
  /// **'Captured'**
  String get riskCapturedLabel;

  /// No description provided for @riskDayPnlLabel.
  ///
  /// In en, this message translates to:
  /// **'Net day PnL'**
  String get riskDayPnlLabel;

  /// No description provided for @riskDisclaimer.
  ///
  /// In en, this message translates to:
  /// **'Risk controls reduce operational risk but cannot guarantee against all losses.'**
  String get riskDisclaimer;

  /// No description provided for @riskEngagedManualLabel.
  ///
  /// In en, this message translates to:
  /// **'manual halt'**
  String get riskEngagedManualLabel;

  /// No description provided for @riskEngagedStopsLabel.
  ///
  /// In en, this message translates to:
  /// **'Engaged stops'**
  String get riskEngagedStopsLabel;

  /// No description provided for @riskEngineOff.
  ///
  /// In en, this message translates to:
  /// **'Risk engine disabled - local tooling mode'**
  String get riskEngineOff;

  /// No description provided for @riskEngineOn.
  ///
  /// In en, this message translates to:
  /// **'Risk engine is in the order path'**
  String get riskEngineOn;

  /// No description provided for @riskEquityLabel.
  ///
  /// In en, this message translates to:
  /// **'Equity'**
  String get riskEquityLabel;

  /// No description provided for @riskEventsSection.
  ///
  /// In en, this message translates to:
  /// **'Recent risk events'**
  String get riskEventsSection;

  /// No description provided for @riskExplicitClearNotice.
  ///
  /// In en, this message translates to:
  /// **'This protection was triggered by the engine. It cannot be cleared from this app; acknowledge-and-clear lives in the admin console, behind a typed confirmation.'**
  String get riskExplicitClearNotice;

  /// No description provided for @riskFailClosedLabel.
  ///
  /// In en, this message translates to:
  /// **'Fail-closed'**
  String get riskFailClosedLabel;

  /// No description provided for @riskGrossLabel.
  ///
  /// In en, this message translates to:
  /// **'Gross notional'**
  String get riskGrossLabel;

  /// No description provided for @riskMirrorSection.
  ///
  /// In en, this message translates to:
  /// **'Latest mirror by account'**
  String get riskMirrorSection;

  /// No description provided for @riskNoEvents.
  ///
  /// In en, this message translates to:
  /// **'No risk events recorded.'**
  String get riskNoEvents;

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

  /// No description provided for @riskOpenOrdersLabel.
  ///
  /// In en, this message translates to:
  /// **'Open orders'**
  String get riskOpenOrdersLabel;

  /// No description provided for @riskPanelsDegraded.
  ///
  /// In en, this message translates to:
  /// **'Some risk panels could not be loaded. Pull down to try again.'**
  String get riskPanelsDegraded;

  /// No description provided for @riskReadOnlyNotice.
  ///
  /// In en, this message translates to:
  /// **'Read-only by design. Engaging or clearing a switch lives in the admin console, behind reasons and typed confirmations.'**
  String get riskReadOnlyNotice;

  /// No description provided for @riskReasonLabel.
  ///
  /// In en, this message translates to:
  /// **'Reason'**
  String get riskReasonLabel;

  /// No description provided for @riskRejectionsLabel.
  ///
  /// In en, this message translates to:
  /// **'Risk rejections'**
  String get riskRejectionsLabel;

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

  /// No description provided for @riskStaleBadge.
  ///
  /// In en, this message translates to:
  /// **'STALE'**
  String get riskStaleBadge;

  /// No description provided for @riskStaleMirrorsLabel.
  ///
  /// In en, this message translates to:
  /// **'Stale mirrors'**
  String get riskStaleMirrorsLabel;

  /// No description provided for @riskStaleSourcesLabel.
  ///
  /// In en, this message translates to:
  /// **'Stale sources'**
  String get riskStaleSourcesLabel;

  /// No description provided for @riskSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Halt status and mirror freshness for your organisation.'**
  String get riskSubtitle;

  /// No description provided for @riskSwitchesSection.
  ///
  /// In en, this message translates to:
  /// **'Engaged switches'**
  String get riskSwitchesSection;

  /// No description provided for @riskTitle.
  ///
  /// In en, this message translates to:
  /// **'Risk'**
  String get riskTitle;

  /// No description provided for @riskTriggeredProtectionsLabel.
  ///
  /// In en, this message translates to:
  /// **'Triggered protections'**
  String get riskTriggeredProtectionsLabel;

  /// No description provided for @runningLabel.
  ///
  /// In en, this message translates to:
  /// **'Running'**
  String get runningLabel;

  /// No description provided for @securitySection.
  ///
  /// In en, this message translates to:
  /// **'Security'**
  String get securitySection;

  /// No description provided for @securityTitle.
  ///
  /// In en, this message translates to:
  /// **'Security'**
  String get securityTitle;

  /// No description provided for @sessionExpired.
  ///
  /// In en, this message translates to:
  /// **'Your session has expired. Please sign in again.'**
  String get sessionExpired;

  /// No description provided for @settingsTitle.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get settingsTitle;

  /// No description provided for @sharpeLabel.
  ///
  /// In en, this message translates to:
  /// **'Sharpe'**
  String get sharpeLabel;

  /// No description provided for @signIn.
  ///
  /// In en, this message translates to:
  /// **'Sign in'**
  String get signIn;

  /// No description provided for @signInSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Sign in to your account to continue.'**
  String get signInSubtitle;

  /// No description provided for @signOut.
  ///
  /// In en, this message translates to:
  /// **'Sign out'**
  String get signOut;

  /// No description provided for @simulatedBadge.
  ///
  /// In en, this message translates to:
  /// **'SIMULATED'**
  String get simulatedBadge;

  /// No description provided for @simulatedFillsLabel.
  ///
  /// In en, this message translates to:
  /// **'Orders / fills'**
  String get simulatedFillsLabel;

  /// No description provided for @simulationDisclaimerTitle.
  ///
  /// In en, this message translates to:
  /// **'About these numbers'**
  String get simulationDisclaimerTitle;

  /// No description provided for @statusCancelled.
  ///
  /// In en, this message translates to:
  /// **'Cancelled'**
  String get statusCancelled;

  /// No description provided for @statusCompleted.
  ///
  /// In en, this message translates to:
  /// **'Completed'**
  String get statusCompleted;

  /// No description provided for @statusFailed.
  ///
  /// In en, this message translates to:
  /// **'Failed'**
  String get statusFailed;

  /// No description provided for @statusLabel.
  ///
  /// In en, this message translates to:
  /// **'Status'**
  String get statusLabel;

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

  /// No description provided for @statusStopped.
  ///
  /// In en, this message translates to:
  /// **'Stopped'**
  String get statusStopped;

  /// No description provided for @strategiesSubtitle.
  ///
  /// In en, this message translates to:
  /// **'View strategy health and simulated results.'**
  String get strategiesSubtitle;

  /// No description provided for @strategiesTitle.
  ///
  /// In en, this message translates to:
  /// **'Strategies'**
  String get strategiesTitle;

  /// No description provided for @strategyEngineLabel.
  ///
  /// In en, this message translates to:
  /// **'Strategy engine'**
  String get strategyEngineLabel;

  /// No description provided for @strategyInstancesSection.
  ///
  /// In en, this message translates to:
  /// **'Instances'**
  String get strategyInstancesSection;

  /// No description provided for @strategyNoBacktests.
  ///
  /// In en, this message translates to:
  /// **'No backtests have been run.'**
  String get strategyNoBacktests;

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

  /// No description provided for @strategyPanelsDegraded.
  ///
  /// In en, this message translates to:
  /// **'Some panels could not be loaded. Pull down to try again.'**
  String get strategyPanelsDegraded;

  /// No description provided for @strategyReadOnlyNotice.
  ///
  /// In en, this message translates to:
  /// **'This screen is read-only. Strategies are started, stopped and configured from the admin console.'**
  String get strategyReadOnlyNotice;

  /// No description provided for @tradesLabel.
  ///
  /// In en, this message translates to:
  /// **'Trades'**
  String get tradesLabel;

  /// No description provided for @tradingModeLabel.
  ///
  /// In en, this message translates to:
  /// **'Mode'**
  String get tradingModeLabel;

  /// No description provided for @twoFactorCodeLabel.
  ///
  /// In en, this message translates to:
  /// **'Authentication code'**
  String get twoFactorCodeLabel;

  /// No description provided for @twoFactorDisabled.
  ///
  /// In en, this message translates to:
  /// **'Two-factor authentication is off'**
  String get twoFactorDisabled;

  /// No description provided for @twoFactorEnabled.
  ///
  /// In en, this message translates to:
  /// **'Two-factor authentication is on'**
  String get twoFactorEnabled;

  /// No description provided for @twoFactorSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Enter the six-digit code from your authenticator app.'**
  String get twoFactorSubtitle;

  /// No description provided for @twoFactorTitle.
  ///
  /// In en, this message translates to:
  /// **'Two-factor authentication'**
  String get twoFactorTitle;

  /// No description provided for @useAuthenticator.
  ///
  /// In en, this message translates to:
  /// **'Use my authenticator app instead'**
  String get useAuthenticator;

  /// No description provided for @useRecoveryCode.
  ///
  /// In en, this message translates to:
  /// **'Use a recovery code instead'**
  String get useRecoveryCode;

  /// No description provided for @verify.
  ///
  /// In en, this message translates to:
  /// **'Verify'**
  String get verify;

  /// No description provided for @welcomeBack.
  ///
  /// In en, this message translates to:
  /// **'Welcome back'**
  String get welcomeBack;

  /// No description provided for @winRateLabel.
  ///
  /// In en, this message translates to:
  /// **'Win rate'**
  String get winRateLabel;

}

class _AppLocalizationsDelegate extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) => <String>['bn', 'en'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {


  // Lookup logic when only language code is supported.
  switch (locale.languageCode) {
    case 'bn': return AppLocalizationsBn();
    case 'en': return AppLocalizationsEn();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.'
  );
}
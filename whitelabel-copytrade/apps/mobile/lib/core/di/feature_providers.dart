import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/copy_trading/data/copy_trading_repository.dart';
import '../../features/copy_trading/domain/copy_models.dart';
import '../../features/exchange_accounts/data/exchange_account_repository.dart';
import '../../features/exchange_accounts/domain/exchange_account_models.dart';
import '../../features/fee_schedule/data/fee_schedule_repository.dart';
import '../../features/fee_schedule/domain/fee_schedule_models.dart';
import '../../features/privacy_export/data/data_export_repository.dart';
import '../../features/privacy_export/domain/data_export_models.dart';
import '../../features/security_alerts/data/login_alert_repository.dart';
import '../../features/security_alerts/domain/login_alert_models.dart';
import '../../features/venue_status/data/venue_status_repository.dart';
import '../../features/venue_status/domain/venue_status_models.dart';
import '../../features/funding/data/funding_repository.dart';
import '../../features/funding/domain/funding_models.dart';
import '../../features/notifications/data/notification_repository.dart';
import '../../features/notifications/domain/notification_models.dart';
import '../../features/portfolio/data/portfolio_repository.dart';
import '../../features/portfolio/domain/portfolio_models.dart';
import 'providers.dart';

/// Phase 3 composition: exchange accounts, copy trading, funding, portfolio
/// and notifications. Same single object graph as providers.dart; every
/// repository is one override point for tests. Reads are autoDispose
/// FutureProviders, so leaving a screen drops its data and returning
/// re-fetches - nothing is served from a stale in-memory copy.

final Provider<ExchangeAccountRepository> exchangeAccountRepositoryProvider = Provider<ExchangeAccountRepository>((Ref ref) {
  return ExchangeAccountRepository(apiClient: ref.watch(apiClientProvider), logger: ref.watch(appLoggerProvider));
});

final AutoDisposeFutureProvider<List<ExchangeAccountSummary>> exchangeAccountsProvider =
    FutureProvider.autoDispose<List<ExchangeAccountSummary>>((Ref ref) {
  return ref.watch(exchangeAccountRepositoryProvider).fetchAccounts();
});

final Provider<CopyTradingRepository> copyTradingRepositoryProvider = Provider<CopyTradingRepository>((Ref ref) {
  return CopyTradingRepository(apiClient: ref.watch(apiClientProvider), logger: ref.watch(appLoggerProvider));
});

final AutoDisposeFutureProvider<List<RankedTrader>> copyRankingsProvider = FutureProvider.autoDispose<List<RankedTrader>>((Ref ref) {
  return ref.watch(copyTradingRepositoryProvider).fetchRankings();
});

final AutoDisposeFutureProviderFamily<List<TraderStrategySummary>, String> traderStrategiesProvider =
    FutureProvider.autoDispose.family<List<TraderStrategySummary>, String>((Ref ref, String traderId) {
  return ref.watch(copyTradingRepositoryProvider).fetchTraderStrategies(traderId);
});

final AutoDisposeFutureProvider<List<CopySubscriptionSummary>> mySubscriptionsProvider =
    FutureProvider.autoDispose<List<CopySubscriptionSummary>>((Ref ref) {
  return ref.watch(copyTradingRepositoryProvider).fetchMySubscriptions();
});

final AutoDisposeFutureProvider<List<CopyExecutionSummary>> copyExecutionsProvider =
    FutureProvider.autoDispose<List<CopyExecutionSummary>>((Ref ref) {
  return ref.watch(copyTradingRepositoryProvider).fetchExecutions();
});

final Provider<FundingRepository> fundingRepositoryProvider = Provider<FundingRepository>((Ref ref) {
  // Forget in-memory mutation intents on logout or a different authenticated user.
  ref.watch(authControllerProvider.select((state) => state.isAuthenticated ? '${state.user!.tenantId}:${state.user!.id}' : null));
  return FundingRepository(apiClient: ref.watch(apiClientProvider), logger: ref.watch(appLoggerProvider));
});

final AutoDisposeFutureProvider<List<FundingAccountSummary>> fundingAccountsProvider =
    FutureProvider.autoDispose<List<FundingAccountSummary>>((Ref ref) {
  return ref.watch(fundingRepositoryProvider).fetchAccounts();
});

final AutoDisposeFutureProvider<List<FundingRequestSummary>> fundingHistoryProvider =
    FutureProvider.autoDispose<List<FundingRequestSummary>>((Ref ref) {
  return ref.watch(fundingRepositoryProvider).fetchHistory();
});

final Provider<PortfolioRepository> portfolioRepositoryProvider = Provider<PortfolioRepository>((Ref ref) {
  return PortfolioRepository(apiClient: ref.watch(apiClientProvider), logger: ref.watch(appLoggerProvider));
});

final AutoDisposeFutureProvider<List<PortfolioProfile>> portfolioProfilesProvider =
    FutureProvider.autoDispose<List<PortfolioProfile>>((Ref ref) {
  return ref.watch(portfolioRepositoryProvider).fetchProfiles();
});

final AutoDisposeFutureProviderFamily<PortfolioOverview, PortfolioProfile> portfolioOverviewProvider =
    FutureProvider.autoDispose.family<PortfolioOverview, PortfolioProfile>((Ref ref, PortfolioProfile profile) {
  return ref.watch(portfolioRepositoryProvider).fetchOverview(profile);
});

final Provider<NotificationRepository> notificationRepositoryProvider = Provider<NotificationRepository>((Ref ref) {
  return NotificationRepository(apiClient: ref.watch(apiClientProvider), logger: ref.watch(appLoggerProvider));
});

final AutoDisposeFutureProvider<List<AppNotification>> notificationsProvider = FutureProvider.autoDispose<List<AppNotification>>((Ref ref) {
  return ref.watch(notificationRepositoryProvider).fetchNotifications();
});

final AutoDisposeFutureProvider<int> unreadNotificationCountProvider = FutureProvider.autoDispose<int>((Ref ref) {
  return ref.watch(notificationRepositoryProvider).fetchUnreadCount();
});

final AutoDisposeFutureProvider<List<NotificationPreference>> notificationPreferencesProvider =
    FutureProvider.autoDispose<List<NotificationPreference>>((Ref ref) {
  return ref.watch(notificationRepositoryProvider).fetchPreferences();
});

/// Batch 05 customer surfaces: venue status, sign-in alerts, data export and the
/// public fee schedule. Same composition rule as above - one repository provider per
/// feature, one autoDispose FutureProvider per read, so returning to a screen
/// re-fetches instead of serving a cached copy that has since become wrong.
final Provider<VenueStatusRepository> venueStatusRepositoryProvider = Provider<VenueStatusRepository>((Ref ref) {
  return VenueStatusRepository(apiClient: ref.watch(apiClientProvider));
});

final AutoDisposeFutureProvider<List<VenueStatus>> venueStatusesProvider =
    FutureProvider.autoDispose<List<VenueStatus>>((Ref ref) {
  return ref.watch(venueStatusRepositoryProvider).fetchStatuses();
});

final Provider<LoginAlertRepository> loginAlertRepositoryProvider = Provider<LoginAlertRepository>((Ref ref) {
  return LoginAlertRepository(apiClient: ref.watch(apiClientProvider));
});

/// The filter is part of the provider identity, so switching types refetches
/// instead of silently showing the previous filter's rows.
final AutoDisposeFutureProviderFamily<List<LoginAlert>, String> loginAlertsProvider =
    FutureProvider.autoDispose.family<List<LoginAlert>, String>((Ref ref, String type) {
  return ref.watch(loginAlertRepositoryProvider).fetchAlerts(type: type.isEmpty ? null : type);
});

final Provider<DataExportRepository> dataExportRepositoryProvider = Provider<DataExportRepository>((Ref ref) {
  return DataExportRepository(apiClient: ref.watch(apiClientProvider));
});

final AutoDisposeFutureProvider<List<DataExportRequest>> dataExportRequestsProvider =
    FutureProvider.autoDispose<List<DataExportRequest>>((Ref ref) {
  return ref.watch(dataExportRepositoryProvider).fetchRequests();
});

final Provider<FeeScheduleRepository> feeScheduleRepositoryProvider = Provider<FeeScheduleRepository>((Ref ref) {
  return FeeScheduleRepository(apiClient: ref.watch(apiClientProvider));
});

final AutoDisposeFutureProvider<FeeSchedule> feeScheduleProvider = FutureProvider.autoDispose<FeeSchedule>((Ref ref) {
  return ref.watch(feeScheduleRepositoryProvider).fetchEffectiveSchedule();
});

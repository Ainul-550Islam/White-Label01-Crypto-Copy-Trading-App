import '../../../core/logging/app_logger.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_endpoints.dart';
import '../../../core/network/json_read.dart';
import '../domain/exchange_account_models.dart';

/// Exchange accounts from the phone: list, connect, health-check, disable.
///
/// Not here on purpose: enabling LIVE trading, rotating or revoking keys and
/// changing IP allow-lists. Those are console actions with step-up auth.
/// Disabling is the one write a phone should have - it only ever reduces
/// what the account can do.
///
/// Secrets: the connect payload is posted once and never stored, cached or
/// logged (only the venue and environment are logged, never the request).
class ExchangeAccountRepository {
  ExchangeAccountRepository({required ApiClient apiClient, required AppLogger logger})
      : _apiClient = apiClient,
        _logger = logger;

  final ApiClient _apiClient;
  final AppLogger _logger;

  Future<List<ExchangeAccountSummary>> fetchAccounts() {
    return _apiClient.get<List<ExchangeAccountSummary>>(
      ApiEndpoints.exchangeAccounts,
      queryParameters: <String, Object?>{'page': 1, 'limit': 100},
      parser: (Object? data) => JsonRead.rows(data).map(ExchangeAccountSummary.fromJson).toList(growable: false),
    );
  }

  Future<ExchangeAccountSummary> connect(ConnectExchangeRequest request) async {
    final ExchangeAccountSummary created = await _apiClient.post<ExchangeAccountSummary>(
      ApiEndpoints.exchangeAccounts,
      body: request.toJson(),
      parser: (Object? data) => ExchangeAccountSummary.fromJson(JsonRead.map(data)),
    );
    _logger.debug('exchange.account_connected', context: <String, Object?>{'venue': request.venue, 'environment': request.environment});
    return created;
  }

  /// Asks the API to probe the venue now. The API records the result on the
  /// account; the caller refreshes the list to show it.
  Future<void> runHealthCheck(String accountId) async {
    await _apiClient.post<Object?>(ApiEndpoints.exchangeHealthCheck(accountId));
  }

  Future<void> disableAccount(String accountId, {String reason = 'Disabled from mobile'}) async {
    await _apiClient.post<Object?>(
      ApiEndpoints.exchangeAccountDisable(accountId),
      body: <String, Object?>{'reason': reason},
    );
    _logger.debug('exchange.account_disabled');
  }
}

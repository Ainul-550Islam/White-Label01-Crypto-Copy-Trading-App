import '../../../core/logging/app_logger.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_endpoints.dart';
import '../../../core/network/json_read.dart';
import '../domain/funding_models.dart';

/// Funding from the phone: list the customer's own accounts, request a
/// deposit against one of them, and follow deposit/withdrawal requests.
///
/// Everything goes through client-lifecycle funding requests, which the API
/// scopes to the caller's own accounts. Custody wallets and deposit-address
/// issuance are an operator surface (403 for customers) and are not called.
/// There is intentionally no withdrawal-creation method (destination checks,
/// approvals and step-up auth live in the web app); withdrawals are read-only
/// history here.
class FundingRepository {
  FundingRepository({required ApiClient apiClient, required AppLogger logger})
      : _apiClient = apiClient,
        _logger = logger;

  final ApiClient _apiClient;
  final AppLogger _logger;

  Future<List<FundingAccountSummary>> fetchAccounts() {
    return _apiClient.get<List<FundingAccountSummary>>(
      ApiEndpoints.fundingAccounts,
      queryParameters: <String, Object?>{'page': 1, 'limit': 100},
      parser: (Object? data) => JsonRead.rows(data).map(FundingAccountSummary.fromJson).toList(growable: false),
    );
  }

  Future<List<FundingRequestSummary>> fetchHistory({int limit = 50}) async {
    final Map<String, Object?> query = <String, Object?>{'page': 1, 'limit': limit};
    final List<List<FundingRequestSummary>> pages = await Future.wait(<Future<List<FundingRequestSummary>>>[
      _apiClient.get<List<FundingRequestSummary>>(
        ApiEndpoints.fundingRequests,
        queryParameters: query,
        parser: (Object? data) =>
            JsonRead.rows(data).map((Map<String, Object?> row) => FundingRequestSummary.fromJson(row, FundingDirection.deposit)).toList(growable: false),
      ),
      _apiClient.get<List<FundingRequestSummary>>(
        ApiEndpoints.withdrawalRequests,
        queryParameters: query,
        parser: (Object? data) =>
            JsonRead.rows(data).map((Map<String, Object?> row) => FundingRequestSummary.fromJson(row, FundingDirection.withdrawal)).toList(growable: false),
      ),
    ]);
    return mergeFundingHistory(pages[0], pages[1], limit: limit);
  }

  Future<FundingRequestSummary> requestDeposit({
    required FundingAccountSummary account,
    required String amount,
    required String currency,
    String? externalReference,
  }) async {
    if (!account.canDeposit) {
      throw ArgumentError('This account does not accept deposits');
    }
    final String cleanAmount = amount.trim();
    final String cleanCurrency = currency.trim().toUpperCase();
    if (!FundingInput.isPositiveAmount(cleanAmount)) {
      throw ArgumentError('The amount must be greater than zero');
    }
    if (!FundingInput.isCurrencyCode(cleanCurrency)) {
      throw ArgumentError('Unsupported currency code');
    }
    final String reference = (externalReference ?? '').trim();
    final FundingRequestSummary request = await _apiClient.post<FundingRequestSummary>(
      ApiEndpoints.fundingRequests,
      body: <String, Object?>{
        'accountId': account.id,
        'requestedAmount': cleanAmount,
        'currency': cleanCurrency,
        if (reference.isNotEmpty) 'externalReference': reference,
      },
      parser: (Object? data) => FundingRequestSummary.fromJson(JsonRead.map(data), FundingDirection.deposit),
    );
    _logger.debug('funding.deposit_requested', context: <String, Object?>{'currency': cleanCurrency, 'state': request.state});
    return request;
  }
}

import 'dart:convert';

import 'package:uuid/uuid.dart';

import '../../../core/logging/app_logger.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_endpoints.dart';
import '../../../core/network/json_read.dart';
import '../domain/funding_models.dart';
import '../domain/withdrawal_destination_check.dart';

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
  // Retain uncertain request keys while this signed-in repository is alive.
  final Map<String, String> _depositIntents = <String, String>{};

  Future<List<FundingAccountSummary>> fetchAccounts() {
    return _apiClient.get<List<FundingAccountSummary>>(
      ApiEndpoints.fundingAccounts,
      queryParameters: <String, Object?>{'page': 1, 'limit': 100},
      parser: (Object? data) => JsonRead.rows(data)
          .map(FundingAccountSummary.fromJson)
          .toList(growable: false),
    );
  }

  Future<List<FundingRequestSummary>> fetchHistory({int limit = 50}) async {
    final Map<String, Object?> query = <String, Object?>{
      'page': 1,
      'limit': limit,
    };
    final List<List<FundingRequestSummary>> pages =
        await Future.wait(<Future<List<FundingRequestSummary>>>[
      _apiClient.get<List<FundingRequestSummary>>(
        ApiEndpoints.fundingRequests,
        queryParameters: query,
        parser: (Object? data) => JsonRead.rows(data)
            .map(
              (Map<String, Object?> row) =>
                  FundingRequestSummary.fromJson(row, FundingDirection.deposit),
            )
            .toList(growable: false),
      ),
      _apiClient.get<List<FundingRequestSummary>>(
        ApiEndpoints.withdrawalRequests,
        queryParameters: query,
        parser: (Object? data) => JsonRead.rows(data)
            .map(
              (Map<String, Object?> row) => FundingRequestSummary.fromJson(
                row,
                FundingDirection.withdrawal,
              ),
            )
            .toList(growable: false),
      ),
    ]);
    return mergeFundingHistory(pages[0], pages[1], limit: limit);
  }

  /// Reads the current user's allowlist decision without creating a payout.
  /// The server checks again if a withdrawal is later attempted elsewhere.
  Future<WithdrawalDestinationCheck> checkWithdrawalDestination({
    required String network,
    required String address,
  }) {
    final String cleanAddress = address.trim();
    if (!withdrawalNetworks.contains(network) ||
        cleanAddress.length < 16 ||
        cleanAddress.length > 128) {
      throw ArgumentError('Invalid destination');
    }
    return _apiClient.post<WithdrawalDestinationCheck>(
      ApiEndpoints.withdrawalDestinationCheck,
      idempotencyKey: const Uuid().v4(),
      body: <String, Object?>{'network': network, 'address': cleanAddress},
      parser: (Object? data) =>
          WithdrawalDestinationCheck.fromJson(data, network),
    );
  }

  Future<FundingRequestSummary> requestDeposit({
    required FundingAccountSummary account,
    required String amount,
    required String currency,
    required String externalReference,
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
    final String reference = externalReference.trim();
    if (reference.isEmpty || reference.length > 120) {
      throw ArgumentError('Transfer reference required');
    }
    final String signature =
        jsonEncode(<String>[account.id, cleanAmount, cleanCurrency, reference]);
    final String key =
        _depositIntents.putIfAbsent(signature, () => const Uuid().v4());
    final FundingRequestSummary request =
        await _apiClient.post<FundingRequestSummary>(
      ApiEndpoints.fundingRequests,
      idempotencyKey: key,
      body: <String, Object?>{
        'accountId': account.id,
        'requestedAmount': cleanAmount,
        'currency': cleanCurrency,
        'externalReference': reference,
      },
      parser: (Object? data) {
        final Map<String, Object?> raw = JsonRead.map(data);
        if (raw['id'] is! String ||
            (raw['id'] as String).isEmpty ||
            raw['accountId'] != account.id ||
            raw['requestedAmount'] != cleanAmount ||
            raw['currency'] != cleanCurrency ||
            !FundingRequestSummary.openStates.contains(raw['state'])) {
          throw const FormatException('Unexpected deposit response');
        }
        return FundingRequestSummary.fromJson(raw, FundingDirection.deposit);
      },
    );
    _depositIntents.remove(signature);
    _logger.debug(
      'funding.deposit_requested',
      context: <String, Object?>{
        'currency': cleanCurrency,
        'state': request.state,
      },
    );
    return request;
  }
}

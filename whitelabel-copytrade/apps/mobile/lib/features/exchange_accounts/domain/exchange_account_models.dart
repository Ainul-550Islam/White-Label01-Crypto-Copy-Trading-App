import 'package:equatable/equatable.dart';

import '../../../core/network/json_read.dart';

/// Venues and environments the API accepts on connect (ExchangeVenue /
/// ExchangeEnvironment on the server). Kept as plain strings so a server-side
/// addition shows up as an unknown-but-rendered value rather than a crash.
class ExchangeVenues {
  const ExchangeVenues._();

  static const List<String> all = <String>['BINANCE', 'BYBIT', 'OKX', 'KRAKEN', 'COINBASE'];

  /// OKX and Coinbase Exchange sign with a passphrase as a third secret.
  static bool needsPassphrase(String venue) => venue == 'OKX' || venue == 'COINBASE';
}

class ExchangeEnvironments {
  const ExchangeEnvironments._();

  static const List<String> all = <String>['TESTNET', 'SANDBOX', 'LIVE'];
}

/// The safe reference the API returns for an exchange account. There is no
/// secret in it by construction: the key is masked server-side and the
/// secret is never returned by any route.
class ExchangeAccountSummary extends Equatable {
  const ExchangeAccountSummary({
    required this.id,
    required this.venue,
    required this.environment,
    required this.label,
    required this.maskedApiKey,
    required this.status,
    this.connectionState,
    this.healthState,
    this.capabilities = const <String>[],
    this.isSandbox = false,
    this.liveTradingEnabled = false,
    this.lastVerifiedAt,
    this.lastErrorCode,
  });

  factory ExchangeAccountSummary.fromJson(Map<String, Object?> json) {
    return ExchangeAccountSummary(
      id: JsonRead.str(json, 'accountId') ?? JsonRead.strOr(json, 'id', ''),
      venue: JsonRead.strOr(json, 'venue', 'UNKNOWN'),
      environment: JsonRead.strOr(json, 'environment', 'UNKNOWN'),
      label: JsonRead.strOr(json, 'label', ''),
      maskedApiKey: JsonRead.strOr(json, 'maskedApiKey', '****'),
      status: JsonRead.strOr(json, 'status', 'UNKNOWN'),
      connectionState: JsonRead.str(json, 'connectionState'),
      healthState: JsonRead.str(json, 'healthState'),
      capabilities: JsonRead.strings(json, 'capabilities'),
      isSandbox: JsonRead.boolean(json, 'isSandbox'),
      liveTradingEnabled: JsonRead.boolean(json, 'liveTradingEnabled'),
      lastVerifiedAt: JsonRead.date(json, 'lastVerifiedAt'),
      lastErrorCode: JsonRead.str(json, 'lastErrorCode'),
    );
  }

  final String id;
  final String venue;
  final String environment;
  final String label;
  final String maskedApiKey;
  final String status;
  final String? connectionState;
  final String? healthState;
  final List<String> capabilities;
  final bool isSandbox;
  final bool liveTradingEnabled;
  final DateTime? lastVerifiedAt;
  final String? lastErrorCode;

  bool get isLive => environment == 'LIVE' && !isSandbox;
  bool get isDisabled => status == 'DISABLED' || status == 'REVOKED';
  bool get isHealthy => healthState == 'HEALTHY';

  @override
  List<Object?> get props => <Object?>[id, venue, environment, label, maskedApiKey, status, connectionState, healthState, capabilities, isSandbox, liveTradingEnabled, lastVerifiedAt, lastErrorCode];
}

/// What the connect form sends. Held only for the duration of the request;
/// [toJson] is the single place the secret leaves the form, and [toString]
/// is overridden so it can never be logged by accident.
class ConnectExchangeRequest {
  const ConnectExchangeRequest({
    required this.venue,
    required this.environment,
    required this.label,
    required this.apiKey,
    required this.apiSecret,
    this.passphrase,
  });

  final String venue;
  final String environment;
  final String label;
  final String apiKey;
  final String apiSecret;
  final String? passphrase;

  Map<String, Object?> toJson() => <String, Object?>{
        'venue': venue,
        'environment': environment,
        'label': label,
        'apiKey': apiKey,
        'apiSecret': apiSecret,
        if (passphrase != null && passphrase!.isNotEmpty) 'passphrase': passphrase,
        'credentialSource': 'ENVELOPE_DB',
      };

  @override
  String toString() => 'ConnectExchangeRequest(venue: $venue, environment: $environment, label: $label, apiKey: <redacted>, apiSecret: <redacted>)';
}

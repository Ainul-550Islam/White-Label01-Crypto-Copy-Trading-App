/// Networks accepted by the backend's withdrawal destination DTO.
const List<String> withdrawalNetworks = <String>[
  'ETHEREUM',
  'BSC',
  'POLYGON',
  'ARBITRUM',
  'BASE',
  'OPTIMISM',
  'AVALANCHE',
  'TRON',
  'SOLANA',
  'BITCOIN',
];

/// A point-in-time allowlist result, not permission to withdraw.
enum DestinationCheckStatus { allowlisted, pending, denied }

class WithdrawalDestinationCheck {
  const WithdrawalDestinationCheck._(this.status);

  factory WithdrawalDestinationCheck.fromJson(
      Object? value, String expectedNetwork,) {
    if (value is! Map || value['network'] != expectedNetwork) {
      throw const FormatException('Unexpected destination-check response');
    }
    final Object? decision = value['decision'];
    final Object? code = value['code'];
    final Object? id = value['destinationId'];
    if (decision == 'ALLOW' &&
        code == 'ALLOW' &&
        id is String &&
        id.isNotEmpty) {
      return const WithdrawalDestinationCheck._(
          DestinationCheckStatus.allowlisted,);
    }
    if (decision == 'DENY' &&
        code == 'DESTINATION_PENDING_ACTIVATION' &&
        id is String &&
        id.isNotEmpty &&
        value['activatesAt'] is String &&
        DateTime.tryParse(value['activatesAt'] as String) != null) {
      return const WithdrawalDestinationCheck._(DestinationCheckStatus.pending);
    }
    if (decision == 'DENY' &&
        <String>{
          'DESTINATION_NOT_ALLOWLISTED',
          'DESTINATION_REVOKED',
          'DESTINATION_NETWORK_MISMATCH',
        }.contains(code)) {
      return const WithdrawalDestinationCheck._(DestinationCheckStatus.denied);
    }
    throw const FormatException('Unexpected destination-check response');
  }

  final DestinationCheckStatus status;
}

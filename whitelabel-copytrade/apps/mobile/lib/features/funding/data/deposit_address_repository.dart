import 'dart:convert';

import 'package:uuid/uuid.dart';

import '../../../core/network/api_client.dart';

final RegExp _uuid = RegExp(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    caseSensitive: false,);
final RegExp _id = RegExp(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$');
final RegExp _evm = RegExp(r'^0x[0-9a-f]{40}$', caseSensitive: false);

class DepositAssetOption {
  const DepositAssetOption(
      {required this.assetId,
      required this.networkId,
      required this.currency,
      required this.networkName,
      required this.tokenStandard,
      required this.contractAddress,});

  factory DepositAssetOption.parse(Object? raw) {
    if (raw is! Map) throw const FormatException('Invalid deposit asset');
    final Object? asset = raw['assetId'],
        network = raw['networkId'],
        currency = raw['currency'],
        name = raw['networkName'],
        standard = raw['tokenStandard'],
        contract = raw['contractAddress'];
    if (asset is! String ||
        !_id.hasMatch(asset) ||
        network != 'ethereum' ||
        currency is! String ||
        !RegExp(r'^[A-Z0-9]{2,10}$').hasMatch(currency) ||
        name is! String ||
        name.isEmpty ||
        name.length > 128 ||
        !(standard == null || standard == 'ERC20') ||
        !(contract == null ||
            (contract is String && _evm.hasMatch(contract))) ||
        ((standard == 'ERC20') != (contract != null))) {
      throw const FormatException('Invalid deposit asset');
    }
    return DepositAssetOption(
        assetId: asset,
        networkId: network as String,
        currency: currency,
        networkName: name,
        tokenStandard: standard as String?,
        contractAddress: contract as String?,);
  }
  final String assetId, networkId, currency, networkName;
  final String? tokenStandard, contractAddress;
}

class CustomerDepositAddress {
  const CustomerDepositAddress(
      {required this.address, required this.verifiedAt,});
  factory CustomerDepositAddress.parse(Object? raw, String requestId,
      String accountId, DepositAssetOption option,) {
    if (raw is! Map ||
        raw['fundingRequestId'] != requestId ||
        raw['accountId'] != accountId ||
        raw['assetId'] != option.assetId ||
        raw['networkId'] != option.networkId ||
        raw['currency'] != option.currency ||
        raw['status'] != 'ADDRESS_VERIFIED' ||
        raw['settlementStatus'] != 'NOT_CONFIRMED' ||
        raw['monitoringStatus'] != 'NOT_CONNECTED') {
      throw const FormatException('Invalid deposit address');
    }
    final Object? value = raw['address'], stamp = raw['verifiedAt'];
    if (value is! String ||
        !_evm.hasMatch(value) ||
        RegExp(r'^0x0{40}$', caseSensitive: false).hasMatch(value) ||
        stamp is! String ||
        DateTime.tryParse(stamp) == null) {
      throw const FormatException('Invalid deposit address');
    }
    return CustomerDepositAddress(
        address: value, verifiedAt: DateTime.parse(stamp),);
  }
  final String address;
  final DateTime verifiedAt;
}

enum DepositVerificationMethod { password, totp, recoveryCode }

/// Uses the customer client-lifecycle routes, not operator custody routes.
/// Only a provider-verified address is returned. No deposit monitoring or
/// account credit is inferred from this response.
class DepositAddressRepository {
  DepositAddressRepository({required ApiClient apiClient}) : _api = apiClient;
  final ApiClient _api;
  final Map<String, String> _keys = <String, String>{};

  String _path(String requestId) {
    if (!_uuid.hasMatch(requestId)) {
      throw ArgumentError('Invalid request identity');
    }
    return '/client-lifecycle/funding/$requestId/deposit-address';
  }

  Future<List<DepositAssetOption>> listAssets(String requestId) =>
      _api.get<List<DepositAssetOption>>('${_path(requestId)}/assets',
          parser: (Object? data) {
        if (data is! List || data.length > 100) {
          throw const FormatException('Invalid deposit assets');
        }
        return data.map(DepositAssetOption.parse).toList(growable: false);
      },);

  Future<CustomerDepositAddress> getAddress(
          String requestId, String accountId, DepositAssetOption option,) =>
      _api.get<CustomerDepositAddress>(_path(requestId),
          queryParameters: <String, Object?>{
            'assetId': option.assetId,
            'networkId': option.networkId,
          },
          parser: (Object? data) =>
              CustomerDepositAddress.parse(data, requestId, accountId, option),);

  /// The action-bound proof is spent by one issuance attempt. If that attempt
  /// is uncertain, the same intent key is reused but a new proof is required.
  Future<CustomerDepositAddress> verifyAndIssue(
      String requestId,
      String accountId,
      DepositAssetOption option,
      DepositVerificationMethod method,
      String credential,) async {
    final String target = _path(requestId);
    final String clean = method == DepositVerificationMethod.password
        ? credential
        : credential.trim();
    if ((method == DepositVerificationMethod.password &&
            (clean.length < 8 || clean.length > 256)) ||
        (method == DepositVerificationMethod.totp &&
            !RegExp(r'^\d{6}$').hasMatch(clean)) ||
        (method == DepositVerificationMethod.recoveryCode &&
            (clean.length < 8 || clean.length > 64))) {
      throw ArgumentError('Invalid verification credential');
    }
    final String methodName = switch (method) {
      DepositVerificationMethod.password => 'PASSWORD',
      DepositVerificationMethod.totp => 'TOTP',
      DepositVerificationMethod.recoveryCode => 'RECOVERY_CODE',
    };
    final String signature = jsonEncode(
        <String>[requestId, accountId, option.assetId, option.networkId],);
    final String key = _keys.putIfAbsent(signature, () => const Uuid().v4());
    await _api.post<void>('/auth/step-up', body: <String, Object?>{
      'action': 'CUSTODY_ADDRESS_ISSUE',
      'method': methodName,
      if (method == DepositVerificationMethod.password) 'password': clean,
      if (method == DepositVerificationMethod.totp) 'code': clean,
      if (method == DepositVerificationMethod.recoveryCode)
        'recoveryCode': clean,
    }, parser: (Object? raw) {
      if (raw is! Map ||
          raw['action'] != 'CUSTODY_ADDRESS_ISSUE' ||
          raw['method'] != methodName ||
          raw['proofId'] is! String ||
          (raw['proofId'] as String).isEmpty ||
          raw['expiresAt'] is! String) {
        throw const FormatException('Invalid verification response');
      }
      final DateTime? expires = DateTime.tryParse(raw['expiresAt'] as String);
      if (expires == null || !expires.isAfter(DateTime.now())) {
        throw const FormatException('Expired verification');
      }
    },);
    return _api.post<CustomerDepositAddress>(target,
        idempotencyKey: key,
        body: <String, Object?>{
          'assetId': option.assetId,
          'networkId': option.networkId,
        },
        parser: (Object? raw) =>
            CustomerDepositAddress.parse(raw, requestId, accountId, option),);
  }
}

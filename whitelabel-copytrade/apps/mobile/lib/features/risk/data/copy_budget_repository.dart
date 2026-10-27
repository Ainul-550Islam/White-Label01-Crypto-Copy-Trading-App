import 'dart:convert';

import 'package:uuid/uuid.dart';

import '../../../core/network/api_client.dart';
import '../../../core/storage/secure_storage.dart';
import '../domain/copy_budget.dart';

/// Own copy budget only. This mobile action can reduce, never raise, a cap.
class CopyBudgetRepository {
  CopyBudgetRepository(this._api, {this.tenantId, this.userId, this.storage});

  final ApiClient _api;
  final String? tenantId;
  final String? userId;
  final SecureStorage? storage;
  final Map<String, String> _pendingKeys = <String, String>{};
  static const String _budget = '/copy-trading/budget';

  String get _storageKey => 'wlct.copy-budget.$tenantId.$userId';

  Future<Map<String, String>> _readKeys() async {
    final SecureStorage? vault = storage;
    if (vault == null) return Map<String, String>.of(_pendingKeys);
    if (tenantId == null ||
        userId == null ||
        tenantId!.isEmpty ||
        userId!.isEmpty) {
      throw const FormatException('Missing budget owner');
    }
    final String? raw = await vault.read(_storageKey);
    if (raw == null) return <String, String>{};
    final Object? decoded = jsonDecode(raw);
    if (decoded is! Map ||
        decoded.length > 128 ||
        decoded.entries.any((entry) =>
            entry.key is! String ||
            entry.value is! String ||
            !RegExp(r'^[A-Za-z0-9._:-]{8,128}$')
                .hasMatch(entry.value as String),)) {
      throw const FormatException('Invalid budget retry state');
    }
    return Map<String, String>.from(decoded);
  }

  Future<String> _keyFor(String signature) async {
    final Map<String, String> keys = await _readKeys();
    final String? existing = keys[signature];
    if (existing != null) return existing;
    if (keys.length >= 128) {
      throw const FormatException('Too many pending budget requests');
    }
    final String key = const Uuid().v4();
    keys[signature] = key;
    if (storage != null) await storage!.write(_storageKey, jsonEncode(keys));
    _pendingKeys[signature] = key;
    return key;
  }

  Future<void> _forget(String signature) async {
    final Map<String, String> keys = await _readKeys();
    keys.remove(signature);
    if (storage != null) {
      if (keys.isEmpty) {
        await storage!.delete(_storageKey);
      } else {
        await storage!.write(_storageKey, jsonEncode(keys));
      }
    }
    _pendingKeys.remove(signature);
  }

  CopyBudget _parse(Object? raw) {
    final CopyBudget budget = CopyBudget.fromJson(raw);
    if ((tenantId != null && budget.tenantId != tenantId) ||
        (userId != null && budget.userId != userId)) {
      throw const FormatException('Budget owner mismatch');
    }
    return budget;
  }

  Future<CopyBudget> fetch() => _api.get<CopyBudget>(
        _budget,
        parser: _parse,
      );

  Future<CopyBudget> reduce({
    required String maximum,
    required String currency,
  }) async {
    if (!isValidBudgetReduction(maximum) ||
        !RegExp(r'^[A-Z0-9]{2,12}$').hasMatch(currency)) {
      throw ArgumentError('Invalid budget reduction');
    }
    final String signature = '$currency:$maximum';
    // Persist before sending: after a timeout or process restart the same
    // owner and exact intent reuse the original key.
    final String key = await _keyFor(signature);
    final CopyBudget result = await _api.post<CopyBudget>(
      '$_budget/reduce',
      body: <String, Object?>{
        'maxActiveExposure': maximum,
        'currency': currency,
      },
      idempotencyKey: key,
      parser: _parse,
    );
    // A replay can return the current view after a later change. Do not show
    // a successful reduction if the cap was subsequently raised or the
    // currency changed; leave the original intent available for inspection.
    if (result.currency != currency ||
        result.personalCap == null ||
        compareBudgetDecimals(result.personalCap!, maximum) > 0 ||
        result.effectiveCap == null ||
        compareBudgetDecimals(result.effectiveCap!, maximum) > 0) {
      throw const FormatException('Budget reduction could not be confirmed');
    }
    // A cleanup failure cannot undo an already-confirmed commit. Retaining the
    // key is safe; a future retry still receives the server's current view.
    try {
      await _forget(signature);
    } catch (_) {
      // Keep the durable retry record; never log its contents.
    }
    return result;
  }
}

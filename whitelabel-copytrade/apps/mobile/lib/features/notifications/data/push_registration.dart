import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../../../core/di/providers.dart';
import '../../../core/network/api_client.dart';
import '../platform/device_notification_permission.dart';

enum PushRegistrationStatus { notRequested, registered, unavailable, failed }

final Provider<PushRegistration> pushRegistrationProvider =
    Provider<PushRegistration>((Ref ref) => PushRegistration(ref.watch(apiClientProvider)));

/// Registers the current authenticated session, without persisting or logging a provider token.
class PushRegistration {
  PushRegistration(this._api);
  final ApiClient _api;
  final DeviceNotificationPermissions _permissions = const DeviceNotificationPermissions();
  Future<PushRegistrationStatus>? _inFlight;
  int? _inFlightGeneration;
  int _generation = 0;
  String? _pendingToken;
  String? _pendingKey;

  void reset() {
    _generation++;
    _pendingToken = null;
    _pendingKey = null;
  }

  Future<PushRegistrationStatus> sync() {
    final int generation = _generation;
    final Future<PushRegistrationStatus>? previous = _inFlight;
    if (previous != null && _inFlightGeneration == generation) return previous;
    // Account switches serialize behind an already-started request, then run
    // a fresh sync. A previous session cannot swallow the new session's sync.
    late final Future<PushRegistrationStatus> next;
    next = (() async {
      if (previous != null) {
        try { await previous; } catch (_) { /* Continue with the current session. */ }
      }
      if (generation != _generation) return PushRegistrationStatus.notRequested;
      return _sync(generation);
    })().whenComplete(() {
      if (identical(_inFlight, next)) {
        _inFlight = null;
        _inFlightGeneration = null;
      }
    });
    _inFlight = next;
    _inFlightGeneration = generation;
    return next;
  }

  Future<PushRegistrationStatus> _sync(int generation) async {
    final DeviceNotificationPermission permission = await _permissions.status();
    if (generation != _generation) return PushRegistrationStatus.notRequested;
    if (permission == DeviceNotificationPermission.denied) {
      try {
        await _api.delete<Object?>('/notifications/push-devices', idempotencyKey: 'push-remove-${const Uuid().v4()}', parser: (Object? data) {
          if (data is! Map || data['unregistered'] != true) throw const FormatException('Invalid registration response');
          return null;
        },);
      } catch (_) { /* Device permission still accurately reports denied. */ }
      if (generation == _generation) {
        _pendingToken = null;
        _pendingKey = null;
      }
      return PushRegistrationStatus.notRequested;
    }
    if (permission != DeviceNotificationPermission.authorized && permission != DeviceNotificationPermission.limited) {
      return PushRegistrationStatus.notRequested;
    }
    if (kIsWeb || (defaultTargetPlatform != TargetPlatform.android && defaultTargetPlatform != TargetPlatform.iOS)) {
      return PushRegistrationStatus.unavailable;
    }
    final String? token = await _permissions.pushToken();
    if (generation != _generation) return PushRegistrationStatus.notRequested;
    if (token == null) return PushRegistrationStatus.unavailable;
    if (_pendingToken != token) {
      _pendingToken = token;
      _pendingKey = 'push-register-${const Uuid().v4()}';
    }
    final String key = _pendingKey!;
    try {
      await _api.post<Object?>('/notifications/push-devices',
        idempotencyKey: key,
        body: <String, Object?>{'platform': defaultTargetPlatform == TargetPlatform.iOS ? 'APNS' : 'FCM', 'token': token},
        parser: (Object? data) {
          if (data is! Map || data['registered'] != true) throw const FormatException('Invalid registration response');
          return null;
        },
      );
      // A late result from a previous account must not update current state.
      if (generation != _generation) return PushRegistrationStatus.notRequested;
      // A later successful sync is a new intent; retained only while uncertain.
      _pendingToken = null;
      _pendingKey = null;
      return PushRegistrationStatus.registered;
    } catch (_) {
      return generation == _generation ? PushRegistrationStatus.failed : PushRegistrationStatus.notRequested;
    }
  }
}

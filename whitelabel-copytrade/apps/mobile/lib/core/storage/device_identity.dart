import 'package:uuid/uuid.dart';

import 'secure_storage.dart';

/// Stable per-installation device identifier.
///
/// Refresh tokens are bound to this value by the API, so a stolen refresh token
/// is useless from another device. It is generated locally rather than derived
/// from a hardware id: vendor identifiers are unstable, sometimes unavailable,
/// and using them would be a privacy problem for no security gain.
class DeviceIdentity {
  DeviceIdentity(this._storage, {Uuid? uuid}) : _uuid = uuid ?? const Uuid();

  static const String _deviceIdKey = 'wlct.device.id';

  final SecureStorage _storage;
  final Uuid _uuid;

  String? _cached;

  Future<String> deviceId() async {
    final String? cached = _cached;
    if (cached != null) {
      return cached;
    }

    final String? stored = await _storage.read(_deviceIdKey);

    if (stored != null && stored.isNotEmpty) {
      _cached = stored;
      return stored;
    }

    // The prefix keeps the value inside the API's allowed character set and
    // makes sessions readable in the user's device list.
    final String generated = 'mobile-${_uuid.v4()}';
    await _storage.write(_deviceIdKey, generated);
    _cached = generated;
    return generated;
  }

  Future<void> reset() async {
    _cached = null;
    await _storage.delete(_deviceIdKey);
  }
}

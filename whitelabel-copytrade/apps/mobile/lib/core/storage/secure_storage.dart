import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Thin wrapper over platform secure storage.
///
/// Backed by the iOS Keychain and Android EncryptedSharedPreferences. Anything
/// that would let someone act as the user - tokens, the device binding id -
/// lives here and nowhere else. Never SharedPreferences, never a file.
class SecureStorage {
  SecureStorage({FlutterSecureStorage? storage})
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
              iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock_this_device),
            );

  final FlutterSecureStorage _storage;

  Future<String?> read(String key) => _storage.read(key: key);

  Future<void> write(String key, String value) => _storage.write(key: key, value: value);

  Future<void> delete(String key) => _storage.delete(key: key);

  Future<void> deleteAll() => _storage.deleteAll();
}

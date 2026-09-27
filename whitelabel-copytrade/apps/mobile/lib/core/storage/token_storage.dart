import 'dart:convert';

import 'secure_storage.dart';

/// A token pair plus its absolute expiry.
class AuthTokens {
  const AuthTokens({
    required this.accessToken,
    required this.refreshToken,
    required this.accessExpiresAt,
    required this.refreshExpiresAt,
  });

  final String accessToken;
  final String refreshToken;
  final DateTime accessExpiresAt;
  final DateTime refreshExpiresAt;

  /// Treated as expired slightly early so a request never leaves with a token
  /// that dies in flight.
  bool get isAccessExpired =>
      DateTime.now().toUtc().isAfter(accessExpiresAt.subtract(const Duration(seconds: 30)));

  bool get isRefreshExpired => DateTime.now().toUtc().isAfter(refreshExpiresAt);

  Map<String, Object?> toJson() => <String, Object?>{
        'accessToken': accessToken,
        'refreshToken': refreshToken,
        'accessExpiresAt': accessExpiresAt.toIso8601String(),
        'refreshExpiresAt': refreshExpiresAt.toIso8601String(),
      };

  static AuthTokens? fromJson(Map<String, Object?> json) {
    final Object? accessToken = json['accessToken'];
    final Object? refreshToken = json['refreshToken'];
    final Object? accessExpiresAt = json['accessExpiresAt'];
    final Object? refreshExpiresAt = json['refreshExpiresAt'];

    if (accessToken is! String ||
        refreshToken is! String ||
        accessExpiresAt is! String ||
        refreshExpiresAt is! String) {
      return null;
    }

    final DateTime? access = DateTime.tryParse(accessExpiresAt);
    final DateTime? refresh = DateTime.tryParse(refreshExpiresAt);

    if (access == null || refresh == null) {
      return null;
    }

    return AuthTokens(
      accessToken: accessToken,
      refreshToken: refreshToken,
      accessExpiresAt: access.toUtc(),
      refreshExpiresAt: refresh.toUtc(),
    );
  }

  /// Deliberately opaque: a token must never end up in a log line.
  @override
  String toString() => 'AuthTokens(accessExpiresAt: $accessExpiresAt)';
}

/// Persists the session token pair in secure storage.
class TokenStorage {
  TokenStorage(this._storage);

  static const String _tokensKey = 'wlct.auth.tokens';

  final SecureStorage _storage;

  Future<AuthTokens?> read() async {
    final String? raw = await _storage.read(_tokensKey);

    if (raw == null || raw.isEmpty) {
      return null;
    }

    try {
      final Object? decoded = jsonDecode(raw);
      if (decoded is! Map<String, Object?>) {
        return null;
      }
      return AuthTokens.fromJson(decoded);
    } on FormatException {
      // Corrupt entry: drop it rather than leaving the app in a broken state.
      await _storage.delete(_tokensKey);
      return null;
    }
  }

  Future<void> write(AuthTokens tokens) async {
    await _storage.write(_tokensKey, jsonEncode(tokens.toJson()));
  }

  Future<void> clear() => _storage.delete(_tokensKey);
}

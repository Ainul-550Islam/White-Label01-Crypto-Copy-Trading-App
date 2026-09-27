import 'dart:developer' as developer;

import '../config/app_environment.dart';

/// Log severity, ordered.
enum LogLevel { debug, info, warning, error }

/// Application logger.
///
/// Two rules are enforced here rather than left to discipline at call sites:
/// nothing sensitive is ever written, and debug output disappears in release
/// builds. Any value whose key looks credential-like is redacted before it
/// reaches the console, because device logs are readable by other tooling.
class AppLogger {
  AppLogger(this._environment);

  final AppEnvironment _environment;

  static const Set<String> _redactedKeys = <String>{
    'password',
    'currentpassword',
    'newpassword',
    'token',
    'accesstoken',
    'refreshtoken',
    'challengetoken',
    'authorization',
    'apikey',
    'apisecret',
    'secret',
    'passphrase',
    'privatekey',
    'code',
    'otp',
    'recoverycode',
    'pin',
  };

  void debug(String message, {Map<String, Object?>? context}) {
    if (_environment.isProduction) {
      return;
    }
    _write(LogLevel.debug, message, context);
  }

  void info(String message, {Map<String, Object?>? context}) {
    _write(LogLevel.info, message, context);
  }

  void warning(String message, {Map<String, Object?>? context}) {
    _write(LogLevel.warning, message, context);
  }

  void error(
    String message, {
    Object? error,
    StackTrace? stackTrace,
    Map<String, Object?>? context,
  }) {
    _write(LogLevel.error, message, context, error: error, stackTrace: stackTrace);
  }

  void _write(
    LogLevel level,
    String message,
    Map<String, Object?>? context, {
    Object? error,
    StackTrace? stackTrace,
  }) {
    final Map<String, Object?> safeContext = redact(context ?? const <String, Object?>{});

    developer.log(
      safeContext.isEmpty ? message : '$message $safeContext',
      name: 'wlct.${level.name}',
      level: _levelValue(level),
      error: error,
      // Stack traces stay out of release logs entirely.
      stackTrace: _environment.isProduction ? null : stackTrace,
    );
  }

  /// Replaces sensitive values with a marker. Exposed for testing.
  static Map<String, Object?> redact(Map<String, Object?> input) {
    final Map<String, Object?> output = <String, Object?>{};

    input.forEach((String key, Object? value) {
      if (_redactedKeys.contains(key.toLowerCase().replaceAll('_', ''))) {
        output[key] = '[REDACTED]';
      } else if (value is Map<String, Object?>) {
        output[key] = redact(value);
      } else {
        output[key] = value;
      }
    });

    return output;
  }

  int _levelValue(LogLevel level) {
    switch (level) {
      case LogLevel.debug:
        return 500;
      case LogLevel.info:
        return 800;
      case LogLevel.warning:
        return 900;
      case LogLevel.error:
        return 1000;
    }
  }
}

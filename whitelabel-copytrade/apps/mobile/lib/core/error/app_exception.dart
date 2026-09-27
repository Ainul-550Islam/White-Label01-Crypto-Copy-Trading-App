import 'package:equatable/equatable.dart';

/// Machine-readable failure codes mirrored from the API's error envelope.
///
/// The list intentionally stays small: the UI branches on these, everything
/// else falls through to [AppErrorCode.unknown] and shows a generic message.
enum AppErrorCode {
  network,
  timeout,
  unauthorized,
  forbidden,
  notFound,
  validation,
  conflict,
  rateLimited,
  accountLocked,
  twoFactorRequired,
  featureDisabled,
  server,
  unknown;

  static AppErrorCode fromApiCode(String? code, int? statusCode) {
    switch (code) {
      case 'UNAUTHORIZED':
      case 'TOKEN_EXPIRED':
      case 'TOKEN_INVALID':
      case 'INVALID_CREDENTIALS':
        return AppErrorCode.unauthorized;
      case 'FORBIDDEN':
      case 'INSUFFICIENT_PERMISSIONS':
        return AppErrorCode.forbidden;
      case 'NOT_FOUND':
      case 'TENANT_NOT_FOUND':
        return AppErrorCode.notFound;
      case 'VALIDATION_ERROR':
        return AppErrorCode.validation;
      case 'CONFLICT':
      case 'ALREADY_EXISTS':
        return AppErrorCode.conflict;
      case 'RATE_LIMIT_EXCEEDED':
        return AppErrorCode.rateLimited;
      case 'ACCOUNT_LOCKED':
        return AppErrorCode.accountLocked;
      case 'TWO_FACTOR_REQUIRED':
        return AppErrorCode.twoFactorRequired;
      case 'FEATURE_DISABLED':
        return AppErrorCode.featureDisabled;
      default:
        break;
    }

    if (statusCode == null) {
      return AppErrorCode.unknown;
    }
    if (statusCode == 401) {
      return AppErrorCode.unauthorized;
    }
    if (statusCode == 403) {
      return AppErrorCode.forbidden;
    }
    if (statusCode == 404) {
      return AppErrorCode.notFound;
    }
    if (statusCode == 409) {
      return AppErrorCode.conflict;
    }
    if (statusCode == 422) {
      return AppErrorCode.validation;
    }
    if (statusCode == 429) {
      return AppErrorCode.rateLimited;
    }
    if (statusCode >= 500) {
      return AppErrorCode.server;
    }

    return AppErrorCode.unknown;
  }
}

/// A field-level validation failure, ready to bind to a form input.
class FieldError extends Equatable {
  const FieldError({required this.field, required this.message});

  final String field;
  final String message;

  @override
  List<Object?> get props => <Object?>[field, message];
}

/// The single error type the UI layer ever sees.
///
/// Transport-specific exceptions are translated at the network boundary so no
/// widget has to know that Dio exists, and so no raw exception string - which
/// can contain URLs, headers or payloads - is ever rendered to a user.
class AppException implements Exception {
  const AppException({
    required this.code,
    required this.message,
    this.statusCode,
    this.requestId,
    this.fieldErrors = const <FieldError>[],
  });

  final AppErrorCode code;

  /// Safe to display. Never contains internal detail.
  final String message;

  final int? statusCode;

  /// Correlates with the API's structured logs when a user reports a problem.
  final String? requestId;

  final List<FieldError> fieldErrors;

  bool get isAuthFailure => code == AppErrorCode.unauthorized;

  /// Field errors keyed by field name.
  Map<String, String> get fieldErrorMap => <String, String>{
        for (final FieldError error in fieldErrors) error.field: error.message,
      };

  @override
  String toString() => 'AppException(${code.name}: $message)';
}

import 'dart:io';

import 'package:dio/dio.dart';

import 'app_exception.dart';

/// Translates transport failures into [AppException].
///
/// Every message produced here is written for a user, not a developer. The
/// original exception is deliberately dropped rather than interpolated: Dio
/// error strings embed the full request URL and sometimes headers.
class ErrorMapper {
  const ErrorMapper();

  AppException fromDioException(DioException exception) {
    switch (exception.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
      case DioExceptionType.transformTimeout:
        return const AppException(
          code: AppErrorCode.timeout,
          message: 'The server took too long to respond. Please try again.',
        );
      case DioExceptionType.connectionError:
        return const AppException(
          code: AppErrorCode.network,
          message: 'No connection. Check your network and try again.',
        );
      case DioExceptionType.cancel:
        return const AppException(
          code: AppErrorCode.unknown,
          message: 'The request was cancelled.',
        );
      case DioExceptionType.badCertificate:
        return const AppException(
          code: AppErrorCode.network,
          message: 'The connection is not secure and was blocked.',
        );
      case DioExceptionType.badResponse:
        return _fromResponse(exception.response);
      case DioExceptionType.unknown:
        if (exception.error is SocketException) {
          return const AppException(
            code: AppErrorCode.network,
            message: 'No connection. Check your network and try again.',
          );
        }
        return const AppException(
          code: AppErrorCode.unknown,
          message: 'Something went wrong. Please try again.',
        );
    }
  }

  AppException _fromResponse(Response<dynamic>? response) {
    final int? statusCode = response?.statusCode;
    final dynamic data = response?.data;

    if (data is Map) {
      final Object? errorNode = data['error'];

      if (errorNode is Map) {
        final String? code = _asString(errorNode['code']);
        final String message =
            _asString(errorNode['message']) ?? _defaultMessageFor(statusCode);

        return AppException(
          code: AppErrorCode.fromApiCode(code, statusCode),
          message: message,
          statusCode: statusCode,
          requestId: _asString(errorNode['requestId']),
          fieldErrors: _parseFieldErrors(errorNode['details']),
        );
      }
    }

    return AppException(
      code: AppErrorCode.fromApiCode(null, statusCode),
      message: _defaultMessageFor(statusCode),
      statusCode: statusCode,
    );
  }

  List<FieldError> _parseFieldErrors(Object? details) {
    if (details is! List) {
      return const <FieldError>[];
    }

    final List<FieldError> errors = <FieldError>[];

    for (final Object? entry in details) {
      if (entry is Map) {
        final String? field = _asString(entry['field']);
        final String? message = _asString(entry['message']);
        if (field != null && message != null) {
          errors.add(FieldError(field: field, message: message));
        }
      }
    }

    return errors;
  }

  String? _asString(Object? value) => value is String ? value : null;

  String _defaultMessageFor(int? statusCode) {
    if (statusCode == null) {
      return 'Something went wrong. Please try again.';
    }
    if (statusCode == 401) {
      return 'Your session has expired. Please sign in again.';
    }
    if (statusCode == 403) {
      return 'You do not have permission to do that.';
    }
    if (statusCode == 404) {
      return 'That item could not be found.';
    }
    if (statusCode == 429) {
      return 'Too many attempts. Please wait a moment and try again.';
    }
    if (statusCode >= 500) {
      return 'The service is temporarily unavailable. Please try again shortly.';
    }
    return 'Something went wrong. Please try again.';
  }
}

import 'package:dio/dio.dart';

import '../logging/app_logger.dart';

/// Development-only request logging.
///
/// Only the method, path and status are recorded. Headers and bodies are never
/// logged: the Authorization header alone would be enough to impersonate the
/// user from a captured log file.
class LoggingInterceptor extends Interceptor {
  LoggingInterceptor(this._logger);

  final AppLogger _logger;

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    _logger.debug(
      'http.request',
      context: <String, Object?>{'method': options.method, 'path': options.path},
    );
    handler.next(options);
  }

  @override
  void onResponse(Response<dynamic> response, ResponseInterceptorHandler handler) {
    _logger.debug(
      'http.response',
      context: <String, Object?>{
        'method': response.requestOptions.method,
        'path': response.requestOptions.path,
        'status': response.statusCode,
      },
    );
    handler.next(response);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    _logger.warning(
      'http.error',
      context: <String, Object?>{
        'method': err.requestOptions.method,
        'path': err.requestOptions.path,
        'status': err.response?.statusCode,
        'type': err.type.name,
      },
    );
    handler.next(err);
  }
}

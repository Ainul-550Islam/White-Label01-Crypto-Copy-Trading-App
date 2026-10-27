import 'package:dio/dio.dart';

import '../config/app_config.dart';
import '../error/app_exception.dart';
import '../error/error_mapper.dart';
import '../logging/app_logger.dart';
import 'auth_interceptor.dart';
import 'logging_interceptor.dart';

/// The application's single HTTP entry point.
///
/// Responsibilities kept here rather than in repositories: base URL and
/// timeouts, tenant and correlation headers, unwrapping the API's
/// `{ success, data }` envelope, and turning any transport failure into an
/// [AppException]. Repositories therefore deal only in domain models.
class ApiClient {
  ApiClient({
    required AppConfig config,
    required AuthInterceptor authInterceptor,
    required AppLogger logger,
    Dio? dio,
    ErrorMapper errorMapper = const ErrorMapper(),
    Future<void> Function(Duration)? waitBeforeRetry,
  })  : _errorMapper = errorMapper,
        _waitBeforeRetry = waitBeforeRetry ?? Future<void>.delayed,
        _dio = dio ??
            Dio(
              BaseOptions(
                baseUrl: config.versionedBaseUrl,
                connectTimeout: config.connectTimeout,
                receiveTimeout: config.receiveTimeout,
                contentType: 'application/json',
                responseType: ResponseType.json,
                // 4xx and 5xx are handled through DioException so there is one
                // error path, not two.
                validateStatus: (int? status) => status != null && status < 400,
                headers: <String, String>{
                  'accept': 'application/json',
                  'x-tenant-slug': config.tenantSlug,
                },
              ),
            ) {
    _dio.interceptors.add(authInterceptor);

    if (config.enableNetworkLogging) {
      _dio.interceptors.add(LoggingInterceptor(logger));
    }
  }

  final Dio _dio;
  final ErrorMapper _errorMapper;
  final Future<void> Function(Duration) _waitBeforeRetry;

  Dio get raw => _dio;

  Future<T> get<T>(
    String path, {
    Map<String, Object?>? queryParameters,
    bool authenticated = true,
    T Function(Object? data)? parser,
  }) {
    return _send<T>(
      () => _dio.get<dynamic>(
        path,
        queryParameters: queryParameters,
        options: authenticated ? null : AuthInterceptor.unauthenticated(),
      ),
      parser,
      safeRead: true,
    );
  }

  Future<T> put<T>(
    String path, {
    Object? body,
    bool authenticated = true,
    required String idempotencyKey,
    T Function(Object? data)? parser,
  }) {
    final Options options = Options(
      headers: <String, String>{'Idempotency-Key': idempotencyKey},
    );
    return _send<T>(
      () => _dio.put<dynamic>(
        path,
        data: body,
        options:
            authenticated ? options : AuthInterceptor.unauthenticated(options),
      ),
      parser,
    );
  }

  Future<T> post<T>(
    String path, {
    Object? body,
    Map<String, Object?>? queryParameters,
    bool authenticated = true,
    String? idempotencyKey,
    T Function(Object? data)? parser,
  }) {
    final Options options = Options(headers: <String, String>{
      if (idempotencyKey != null) 'Idempotency-Key': idempotencyKey,
    },);
    return _send<T>(
      () => _dio.post<dynamic>(
        path,
        data: body,
        queryParameters: queryParameters,
        options:
            authenticated ? options : AuthInterceptor.unauthenticated(options),
      ),
      parser,
    );
  }

  Future<T> patch<T>(
    String path, {
    Object? body,
    bool authenticated = true,
    T Function(Object? data)? parser,
  }) {
    return _send<T>(
      () => _dio.patch<dynamic>(
        path,
        data: body,
        options: authenticated ? null : AuthInterceptor.unauthenticated(),
      ),
      parser,
    );
  }

  Future<T> delete<T>(
    String path, {
    Object? body,
    bool authenticated = true,
    String? idempotencyKey,
    T Function(Object? data)? parser,
  }) {
    final Options options = Options(headers: <String, String>{
      if (idempotencyKey != null) 'Idempotency-Key': idempotencyKey,
    },);
    return _send<T>(
      () => _dio.delete<dynamic>(
        path,
        data: body,
        options:
            authenticated ? options : AuthInterceptor.unauthenticated(options),
      ),
      parser,
    );
  }

  Future<T> _send<T>(
    Future<Response<dynamic>> Function() request,
    T Function(Object? data)? parser, {
    bool safeRead = false,
  }) async {
    int retries = 0;
    while (true) {
      try {
        final Response<dynamic> response = await request();
        final Object? payload = _unwrap(response.data);
        if (parser != null) return parser(payload);
        if (payload is T) return payload;
        if (null is T) return null as T;
        throw const AppException(
          code: AppErrorCode.unknown,
          message: 'The server returned an unexpected response.',
        );
      } on DioException catch (error) {
        final int? status = error.response?.statusCode;
        final bool transient = status == 408 ||
            status == 429 ||
            status == 502 ||
            status == 503 ||
            status == 504 ||
            error.type == DioExceptionType.connectionTimeout ||
            error.type == DioExceptionType.receiveTimeout ||
            error.type == DioExceptionType.connectionError;
        if (safeRead && transient && retries < 2) {
          await _waitBeforeRetry(Duration(milliseconds: 200 * (1 << retries)));
          retries++;
          continue;
        }
        throw _errorMapper.fromDioException(error);
      }
    }
  }

  /// The API wraps successful payloads as `{ success: true, data: ... }`.
  Object? _unwrap(Object? body) {
    if (body is Map && body.containsKey('data') && body['success'] == true) {
      return body['data'];
    }
    return body;
  }
}

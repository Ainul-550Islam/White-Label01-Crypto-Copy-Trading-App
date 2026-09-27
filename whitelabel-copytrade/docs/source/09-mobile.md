# Mobile app (Flutter)

Configuration, secure storage, the API client with refresh handling, routing, theming and localisation.

54 files. Part of the complete Part 1 source dump - see `docs/source/README.md`.

---

FILE: apps/mobile/.flutter-plugins

```text
# This is a generated file; do not edit or check into version control.
device_info_plus=/opt/pub_cache/hosted/pub.dev/device_info_plus-10.1.2/
flutter_secure_storage=/opt/pub_cache/hosted/pub.dev/flutter_secure_storage-9.2.4/
flutter_secure_storage_linux=/opt/pub_cache/hosted/pub.dev/flutter_secure_storage_linux-1.2.3/
flutter_secure_storage_macos=/opt/pub_cache/hosted/pub.dev/flutter_secure_storage_macos-3.1.3/
flutter_secure_storage_web=/opt/pub_cache/hosted/pub.dev/flutter_secure_storage_web-1.2.1/
flutter_secure_storage_windows=/opt/pub_cache/hosted/pub.dev/flutter_secure_storage_windows-3.1.2/
package_info_plus=/opt/pub_cache/hosted/pub.dev/package_info_plus-8.3.1/
path_provider=/opt/pub_cache/hosted/pub.dev/path_provider-2.1.5/
path_provider_android=/opt/pub_cache/hosted/pub.dev/path_provider_android-2.2.15/
path_provider_foundation=/opt/pub_cache/hosted/pub.dev/path_provider_foundation-2.4.1/
path_provider_linux=/opt/pub_cache/hosted/pub.dev/path_provider_linux-2.2.1/
path_provider_windows=/opt/pub_cache/hosted/pub.dev/path_provider_windows-2.3.0/
shared_preferences=/opt/pub_cache/hosted/pub.dev/shared_preferences-2.5.3/
shared_preferences_android=/opt/pub_cache/hosted/pub.dev/shared_preferences_android-2.4.7/
shared_preferences_foundation=/opt/pub_cache/hosted/pub.dev/shared_preferences_foundation-2.5.4/
shared_preferences_linux=/opt/pub_cache/hosted/pub.dev/shared_preferences_linux-2.4.1/
shared_preferences_web=/opt/pub_cache/hosted/pub.dev/shared_preferences_web-2.4.3/
shared_preferences_windows=/opt/pub_cache/hosted/pub.dev/shared_preferences_windows-2.4.1/
```

FILE: apps/mobile/.flutter-plugins-dependencies

```text
{"info":"This is a generated file; do not edit or check into version control.","plugins":{"ios":[{"name":"device_info_plus","path":"/opt/pub_cache/hosted/pub.dev/device_info_plus-10.1.2/","native_build":true,"dependencies":[]},{"name":"flutter_secure_storage","path":"/opt/pub_cache/hosted/pub.dev/flutter_secure_storage-9.2.4/","native_build":true,"dependencies":[]},{"name":"package_info_plus","path":"/opt/pub_cache/hosted/pub.dev/package_info_plus-8.3.1/","native_build":true,"dependencies":[]},{"name":"path_provider_foundation","path":"/opt/pub_cache/hosted/pub.dev/path_provider_foundation-2.4.1/","shared_darwin_source":true,"native_build":true,"dependencies":[]},{"name":"shared_preferences_foundation","path":"/opt/pub_cache/hosted/pub.dev/shared_preferences_foundation-2.5.4/","shared_darwin_source":true,"native_build":true,"dependencies":[]}],"android":[{"name":"device_info_plus","path":"/opt/pub_cache/hosted/pub.dev/device_info_plus-10.1.2/","native_build":true,"dependencies":[]},{"name":"flutter_secure_storage","path":"/opt/pub_cache/hosted/pub.dev/flutter_secure_storage-9.2.4/","native_build":true,"dependencies":[]},{"name":"package_info_plus","path":"/opt/pub_cache/hosted/pub.dev/package_info_plus-8.3.1/","native_build":true,"dependencies":[]},{"name":"path_provider_android","path":"/opt/pub_cache/hosted/pub.dev/path_provider_android-2.2.15/","native_build":true,"dependencies":[]},{"name":"shared_preferences_android","path":"/opt/pub_cache/hosted/pub.dev/shared_preferences_android-2.4.7/","native_build":true,"dependencies":[]}],"macos":[{"name":"device_info_plus","path":"/opt/pub_cache/hosted/pub.dev/device_info_plus-10.1.2/","native_build":true,"dependencies":[]},{"name":"flutter_secure_storage_macos","path":"/opt/pub_cache/hosted/pub.dev/flutter_secure_storage_macos-3.1.3/","native_build":true,"dependencies":[]},{"name":"package_info_plus","path":"/opt/pub_cache/hosted/pub.dev/package_info_plus-8.3.1/","native_build":true,"dependencies":[]},{"name":"path_provider_foundation","path":"/opt/pub_cache/hosted/pub.dev/path_provider_foundation-2.4.1/","shared_darwin_source":true,"native_build":true,"dependencies":[]},{"name":"shared_preferences_foundation","path":"/opt/pub_cache/hosted/pub.dev/shared_preferences_foundation-2.5.4/","shared_darwin_source":true,"native_build":true,"dependencies":[]}],"linux":[{"name":"device_info_plus","path":"/opt/pub_cache/hosted/pub.dev/device_info_plus-10.1.2/","native_build":false,"dependencies":[]},{"name":"flutter_secure_storage_linux","path":"/opt/pub_cache/hosted/pub.dev/flutter_secure_storage_linux-1.2.3/","native_build":true,"dependencies":[]},{"name":"package_info_plus","path":"/opt/pub_cache/hosted/pub.dev/package_info_plus-8.3.1/","native_build":false,"dependencies":[]},{"name":"path_provider_linux","path":"/opt/pub_cache/hosted/pub.dev/path_provider_linux-2.2.1/","native_build":false,"dependencies":[]},{"name":"shared_preferences_linux","path":"/opt/pub_cache/hosted/pub.dev/shared_preferences_linux-2.4.1/","native_build":false,"dependencies":["path_provider_linux"]}],"windows":[{"name":"device_info_plus","path":"/opt/pub_cache/hosted/pub.dev/device_info_plus-10.1.2/","native_build":false,"dependencies":[]},{"name":"flutter_secure_storage_windows","path":"/opt/pub_cache/hosted/pub.dev/flutter_secure_storage_windows-3.1.2/","native_build":true,"dependencies":[]},{"name":"package_info_plus","path":"/opt/pub_cache/hosted/pub.dev/package_info_plus-8.3.1/","native_build":false,"dependencies":[]},{"name":"path_provider_windows","path":"/opt/pub_cache/hosted/pub.dev/path_provider_windows-2.3.0/","native_build":false,"dependencies":[]},{"name":"shared_preferences_windows","path":"/opt/pub_cache/hosted/pub.dev/shared_preferences_windows-2.4.1/","native_build":false,"dependencies":["path_provider_windows"]}],"web":[{"name":"device_info_plus","path":"/opt/pub_cache/hosted/pub.dev/device_info_plus-10.1.2/","dependencies":[]},{"name":"flutter_secure_storage_web","path":"/opt/pub_cache/hosted/pub.dev/flutter_secure_storage_web-1.2.1/","dependencies":[]},{"name":"package_info_plus","path":"/opt/pub_cache/hosted/pub.dev/package_info_plus-8.3.1/","dependencies":[]},{"name":"shared_preferences_web","path":"/opt/pub_cache/hosted/pub.dev/shared_preferences_web-2.4.3/","dependencies":[]}]},"dependencyGraph":[{"name":"device_info_plus","dependencies":[]},{"name":"flutter_secure_storage","dependencies":["flutter_secure_storage_linux","flutter_secure_storage_macos","flutter_secure_storage_web","flutter_secure_storage_windows"]},{"name":"flutter_secure_storage_linux","dependencies":[]},{"name":"flutter_secure_storage_macos","dependencies":[]},{"name":"flutter_secure_storage_web","dependencies":[]},{"name":"flutter_secure_storage_windows","dependencies":["path_provider"]},{"name":"package_info_plus","dependencies":[]},{"name":"path_provider","dependencies":["path_provider_android","path_provider_foundation","path_provider_linux","path_provider_windows"]},{"name":"path_provider_android","dependencies":[]},{"name":"path_provider_foundation","dependencies":[]},{"name":"path_provider_linux","dependencies":[]},{"name":"path_provider_windows","dependencies":[]},{"name":"shared_preferences","dependencies":["shared_preferences_android","shared_preferences_foundation","shared_preferences_linux","shared_preferences_web","shared_preferences_windows"]},{"name":"shared_preferences_android","dependencies":[]},{"name":"shared_preferences_foundation","dependencies":[]},{"name":"shared_preferences_linux","dependencies":["path_provider_linux"]},{"name":"shared_preferences_web","dependencies":[]},{"name":"shared_preferences_windows","dependencies":["path_provider_windows"]}],"date_created":"2026-09-11 10:26:12.595775","version":"3.24.5","swift_package_manager_enabled":false}
```

FILE: apps/mobile/.gitignore

```gitignore
.dart_tool/
.packages
.pub-cache/
.pub/
build/
ios/Pods/
ios/.symlinks/
android/.gradle/
android/local.properties
*.iml
.flutter-plugins
.flutter-plugins-dependencies
lib/l10n/app_localizations*.dart
```

FILE: apps/mobile/README.md

````markdown
# Mobile client (Part 1 foundation)

Flutter client for the white-label copy-trading platform. Part 1 ships the
foundation only: configuration, networking, secure token storage, authentication
state, routing, theming, localisation and error handling. Trading screens are
intentionally absent.

## What is here

| Area | Location |
| --- | --- |
| Build-time configuration | `lib/core/config/` |
| Dependency injection (Riverpod) | `lib/core/di/providers.dart` |
| HTTP client, auth/refresh interceptor | `lib/core/network/` |
| Keychain / EncryptedSharedPreferences storage | `lib/core/storage/` |
| Error model and transport mapping | `lib/core/error/` |
| Redacting logger | `lib/core/logging/app_logger.dart` |
| Routing and auth guards | `lib/core/router/` |
| Theming from tenant branding | `lib/core/theme/` |
| Localisation (en, bn) | `lib/l10n/` |
| Authentication feature | `lib/features/auth/` |

## Security notes

* Tokens live only in platform secure storage; never in SharedPreferences.
* Refresh is serialised through a single completer. Parallel refreshes would
  trip the API's token-reuse detection and revoke the whole family.
* Refresh tokens are bound to a locally generated device id.
* Network logging is disabled outside development, and the logger redacts
  credential-like keys at every nesting depth.
* Production builds refuse a non-HTTPS API base URL.
* The app holds no exchange API secrets. Those are submitted once, encrypted
  server-side, and never returned.

## Running

```bash
flutter pub get
flutter gen-l10n            # generates lib/l10n/app_localizations.dart

flutter run \
  --dart-define=APP_ENV=development \
  --dart-define=API_BASE_URL=http://10.0.2.2:4000/api \
  --dart-define=API_VERSION=v1 \
  --dart-define=TENANT_SLUG=platform \
  --dart-define=WS_URL=http://10.0.2.2:4000
```

`10.0.2.2` is the host loopback as seen from the Android emulator. Use
`http://localhost:4000/api` for the iOS simulator.

## Tests and analysis

```bash
flutter analyze
flutter test
```

## Platform folders

`android/` and `ios/` are not committed. Generate them once against your
organisation identifiers:

```bash
flutter create --platforms=android,ios --org com.yourcompany .
```
````

FILE: apps/mobile/analysis_options.yaml

```yaml
include: package:flutter_lints/flutter.yaml

analyzer:
  language:
    strict-casts: true
    strict-inference: true
    strict-raw-types: true
  errors:
    invalid_annotation_target: ignore
    missing_required_param: error
    missing_return: error
  exclude:
    - "**/*.g.dart"
    - "**/*.freezed.dart"
    - "lib/l10n/app_localizations*.dart"

linter:
  rules:
    - always_declare_return_types
    - avoid_print
    - avoid_dynamic_calls
    - prefer_const_constructors
    - prefer_final_locals
    - prefer_single_quotes
    - require_trailing_commas
    - unawaited_futures
    - use_super_parameters
```

FILE: apps/mobile/l10n.yaml

```yaml
arb-dir: lib/l10n
template-arb-file: app_en.arb
output-localization-file: app_localizations.dart
output-class: AppLocalizations
# Emit into lib/l10n instead of the synthetic flutter_gen package so imports are
# ordinary relative paths and analysis works without a special resolver.
synthetic-package: false
nullable-getter: false
```

FILE: apps/mobile/lib/app.dart

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'core/router/app_router.dart';
import 'core/theme/app_theme.dart';
import 'core/theme/brand_tokens.dart';
import 'core/theme/branding_controller.dart';
import 'l10n/app_localizations.dart';

/// Root widget.
///
/// Theme and locale both come from providers so a branding refresh or a locale
/// change re-themes the whole app without a restart.
class WlctApp extends ConsumerWidget {
  const WlctApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final GoRouter router = ref.watch(routerProvider);
    final BrandTokens tokens = ref.watch(brandingProvider);

    return MaterialApp.router(
      title: tokens.appName,
      debugShowCheckedModeBanner: false,
      routerConfig: router,
      theme: AppTheme.light(tokens),
      darkTheme: AppTheme.dark(tokens),
      themeMode: tokens.themeMode,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      localeResolutionCallback: (Locale? locale, Iterable<Locale> supported) {
        if (locale == null) {
          return supported.first;
        }

        for (final Locale candidate in supported) {
          if (candidate.languageCode == locale.languageCode) {
            return candidate;
          }
        }

        return supported.first;
      },
    );
  }
}
```

FILE: apps/mobile/lib/core/config/app_config.dart

```dart
import 'app_environment.dart';

/// Immutable runtime configuration.
///
/// Values arrive through `--dart-define` so a single codebase can be built for
/// any tenant and any environment without editing source. Validation happens at
/// construction: a missing base URL should fail loudly at startup, not with a
/// confusing network error later.
class AppConfig {
  const AppConfig({
    required this.environment,
    required this.apiBaseUrl,
    required this.apiVersion,
    required this.tenantSlug,
    required this.websocketUrl,
    required this.connectTimeout,
    required this.receiveTimeout,
    required this.enableNetworkLogging,
  });

  final AppEnvironment environment;
  final String apiBaseUrl;
  final String apiVersion;

  /// Identifies the white-label organisation this build belongs to. The API
  /// treats it as a hint only and re-resolves the tenant from the user's token
  /// once authenticated.
  final String tenantSlug;

  final String websocketUrl;
  final Duration connectTimeout;
  final Duration receiveTimeout;

  /// Network logging is force-disabled outside development: request logs would
  /// otherwise contain bearer tokens on a user's device.
  final bool enableNetworkLogging;

  static const String _envName = String.fromEnvironment('APP_ENV', defaultValue: 'development');
  static const String _apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:4000/api',
  );
  static const String _apiVersion = String.fromEnvironment('API_VERSION', defaultValue: 'v1');
  static const String _tenantSlug = String.fromEnvironment('TENANT_SLUG', defaultValue: 'platform');
  static const String _websocketUrl = String.fromEnvironment(
    'WS_URL',
    defaultValue: 'http://10.0.2.2:4000',
  );

  factory AppConfig.fromEnvironment() {
    final AppEnvironment environment = AppEnvironment.fromName(_envName);

    if (_apiBaseUrl.isEmpty) {
      throw StateError('API_BASE_URL must be provided with --dart-define.');
    }

    if (environment.isProduction && !_apiBaseUrl.startsWith('https://')) {
      // Cleartext traffic in a production build would expose bearer tokens.
      throw StateError('Production builds require an https API_BASE_URL.');
    }

    return AppConfig(
      environment: environment,
      apiBaseUrl: _stripTrailingSlash(_apiBaseUrl),
      apiVersion: _apiVersion,
      tenantSlug: _tenantSlug,
      websocketUrl: _stripTrailingSlash(_websocketUrl),
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 30),
      enableNetworkLogging: environment.isDevelopment,
    );
  }

  /// Fully-qualified base for versioned endpoints, e.g. `https://host/api/v1`.
  String get versionedBaseUrl => '$apiBaseUrl/$apiVersion';

  static String _stripTrailingSlash(String value) {
    return value.endsWith('/') ? value.substring(0, value.length - 1) : value;
  }
}
```

FILE: apps/mobile/lib/core/config/app_environment.dart

```dart
/// Build-time environment selector.
///
/// The value is injected with `--dart-define=APP_ENV=...`. Nothing here is a
/// secret: a mobile binary is fully readable by anyone who downloads it, so the
/// app only ever carries public configuration. All privileged operations go
/// through the API with a user token.
enum AppEnvironment {
  development,
  staging,
  production;

  static AppEnvironment fromName(String value) {
    switch (value.toLowerCase()) {
      case 'production':
      case 'prod':
        return AppEnvironment.production;
      case 'staging':
      case 'stage':
        return AppEnvironment.staging;
      default:
        return AppEnvironment.development;
    }
  }

  bool get isProduction => this == AppEnvironment.production;
  bool get isDevelopment => this == AppEnvironment.development;
}
```

FILE: apps/mobile/lib/core/di/providers.dart

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/auth/data/auth_repository.dart';
import '../../features/auth/presentation/auth_controller.dart';
import '../../features/auth/presentation/auth_state.dart';
import '../../features/risk/data/risk_repository.dart';
import '../../features/risk/presentation/risk_controller.dart';
import '../../features/risk/presentation/risk_state.dart';
import '../../features/strategies/data/strategy_repository.dart';
import '../../features/strategies/presentation/strategy_controller.dart';
import '../../features/strategies/presentation/strategy_state.dart';
import '../config/app_config.dart';
import '../logging/app_logger.dart';
import '../network/api_client.dart';
import '../network/auth_interceptor.dart';
import '../storage/device_identity.dart';
import '../storage/secure_storage.dart';
import '../storage/token_storage.dart';

/// Composition root.
///
/// Riverpod is used for dependency injection as well as state so there is one
/// object graph, one override point for tests, and no service locator holding
/// global mutable state.

final Provider<AppConfig> appConfigProvider = Provider<AppConfig>((Ref ref) {
  return AppConfig.fromEnvironment();
});

final Provider<AppLogger> appLoggerProvider = Provider<AppLogger>((Ref ref) {
  return AppLogger(ref.watch(appConfigProvider).environment);
});

final Provider<SecureStorage> secureStorageProvider = Provider<SecureStorage>((Ref ref) {
  return SecureStorage();
});

final Provider<TokenStorage> tokenStorageProvider = Provider<TokenStorage>((Ref ref) {
  return TokenStorage(ref.watch(secureStorageProvider));
});

final Provider<DeviceIdentity> deviceIdentityProvider = Provider<DeviceIdentity>((Ref ref) {
  return DeviceIdentity(ref.watch(secureStorageProvider));
});

final Provider<AuthInterceptor> authInterceptorProvider = Provider<AuthInterceptor>((Ref ref) {
  return AuthInterceptor(
    config: ref.watch(appConfigProvider),
    tokenStorage: ref.watch(tokenStorageProvider),
    deviceIdentity: ref.watch(deviceIdentityProvider),
    logger: ref.watch(appLoggerProvider),
    onSessionExpired: () async {
      // `read`, not `watch`: this callback fires from the network layer and
      // must not create a dependency cycle with the controller.
      ref.read(authControllerProvider.notifier).onSessionExpired();
    },
  );
});

final Provider<ApiClient> apiClientProvider = Provider<ApiClient>((Ref ref) {
  return ApiClient(
    config: ref.watch(appConfigProvider),
    authInterceptor: ref.watch(authInterceptorProvider),
    logger: ref.watch(appLoggerProvider),
  );
});

final Provider<AuthRepository> authRepositoryProvider = Provider<AuthRepository>((Ref ref) {
  return AuthRepository(
    apiClient: ref.watch(apiClientProvider),
    tokenStorage: ref.watch(tokenStorageProvider),
    deviceIdentity: ref.watch(deviceIdentityProvider),
    logger: ref.watch(appLoggerProvider),
  );
});

final StateNotifierProvider<AuthController, AuthState> authControllerProvider =
    StateNotifierProvider<AuthController, AuthState>((Ref ref) {
  return AuthController(
    repository: ref.watch(authRepositoryProvider),
    logger: ref.watch(appLoggerProvider),
  );
});

/// Read-only strategy repository.
///
/// Registered alongside the auth graph so the screen has a single override
/// point in tests. It holds no credentials and performs no writes.
final Provider<StrategyRepository> strategyRepositoryProvider =
    Provider<StrategyRepository>((Ref ref) {
  return StrategyRepository(
    apiClient: ref.watch(apiClientProvider),
    logger: ref.watch(appLoggerProvider),
  );
});

final StateNotifierProvider<StrategyController, StrategyViewState> strategyControllerProvider =
    StateNotifierProvider<StrategyController, StrategyViewState>((Ref ref) {
  return StrategyController(
    repository: ref.watch(strategyRepositoryProvider),
    logger: ref.watch(appLoggerProvider),
  );
});

/// Read-only risk repository (Part 8).
///
/// Same registration shape as the strategy graph: GETs only, no
/// credentials, one override point in tests. The risk layer is the one
/// screen a trader role can legitimately want on a phone - "am I halted and
/// is the engine seeing fresh state" - and answering it needs no write.
final Provider<RiskRepository> riskRepositoryProvider =
    Provider<RiskRepository>((Ref ref) {
  return RiskRepository(
    apiClient: ref.watch(apiClientProvider),
    logger: ref.watch(appLoggerProvider),
  );
});

final StateNotifierProvider<RiskController, RiskViewState> riskControllerProvider =
    StateNotifierProvider<RiskController, RiskViewState>((Ref ref) {
  return RiskController(
    repository: ref.watch(riskRepositoryProvider),
    logger: ref.watch(appLoggerProvider),
  );
});
```

FILE: apps/mobile/lib/core/error/app_exception.dart

```dart
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
```

FILE: apps/mobile/lib/core/error/error_mapper.dart

```dart
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
```

FILE: apps/mobile/lib/core/logging/app_logger.dart

```dart
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
```

FILE: apps/mobile/lib/core/network/api_client.dart

```dart
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
  })  : _errorMapper = errorMapper,
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
    );
  }

  Future<T> post<T>(
    String path, {
    Object? body,
    Map<String, Object?>? queryParameters,
    bool authenticated = true,
    T Function(Object? data)? parser,
  }) {
    return _send<T>(
      () => _dio.post<dynamic>(
        path,
        data: body,
        queryParameters: queryParameters,
        options: authenticated ? null : AuthInterceptor.unauthenticated(),
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
    T Function(Object? data)? parser,
  }) {
    return _send<T>(
      () => _dio.delete<dynamic>(
        path,
        data: body,
        options: authenticated ? null : AuthInterceptor.unauthenticated(),
      ),
      parser,
    );
  }

  Future<T> _send<T>(
    Future<Response<dynamic>> Function() request,
    T Function(Object? data)? parser,
  ) async {
    try {
      final Response<dynamic> response = await request();
      final Object? payload = _unwrap(response.data);

      if (parser != null) {
        return parser(payload);
      }

      if (payload is T) {
        return payload;
      }

      if (null is T) {
        return null as T;
      }

      throw const AppException(
        code: AppErrorCode.unknown,
        message: 'The server returned an unexpected response.',
      );
    } on DioException catch (error) {
      throw _errorMapper.fromDioException(error);
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
```

FILE: apps/mobile/lib/core/network/api_endpoints.dart

```dart
/// Endpoint paths, relative to the versioned API base.
///
/// Centralised so a route rename is a one-line change and so no string literal
/// URL is scattered through the feature layer.
class ApiEndpoints {
  const ApiEndpoints._();

  static const String login = '/auth/login';
  static const String register = '/auth/register';
  static const String verifyTwoFactor = '/auth/two-factor/verify';
  static const String refresh = '/auth/refresh';
  static const String logout = '/auth/logout';
  static const String changePassword = '/auth/change-password';
  static const String me = '/auth/me';

  static const String sessions = '/auth/sessions';
  static String session(String id) => '/auth/sessions/$id';

  static const String twoFactorSetup = '/auth/two-factor/setup';
  static const String twoFactorEnable = '/auth/two-factor/enable';
  static const String twoFactorDisable = '/auth/two-factor/disable';

  static const String currentUser = '/users/me';
  static const String tenantPublicConfig = '/tenants/public-config';
  static const String featureFlags = '/feature-flags/resolved';

  /// Strategy layer. Read-only from mobile: the client is granted no
  /// permission that would let it enable an instance or start a session, and
  /// no write path is declared here.
  static const String strategyMetrics = '/strategies/metrics';
  static const String strategyInstances = '/strategies/instances';
  static const String strategyIncidents = '/strategies/incidents';
  static const String backtests = '/strategies/backtests';
  static const String paperSessions = '/strategies/paper-sessions';

  /// Part 8 risk surface - reads only. Deliberately only three paths: the
  /// status panel, the switch table and the event feed. There is no engage,
  /// no clear, no config route here to "wire up later", because the mobile
  /// brief is viewer-only and the absence is the API of this client.
  static const String riskStatus = '/risk/status';
  static const String riskKillSwitches = '/risk/kill-switches';
  static const String riskEvents = '/risk/events';

  static const String notifications = '/notifications';
  static const String notificationUnreadCount = '/notifications/unread-count';
  static const String notificationPreferences = '/notifications/preferences';
  static String markNotificationRead(String id) => '/notifications/$id/read';
}
```

FILE: apps/mobile/lib/core/network/auth_interceptor.dart

```dart
import 'dart:async';

import 'package:dio/dio.dart';

import '../config/app_config.dart';
import '../logging/app_logger.dart';
import '../storage/device_identity.dart';
import '../storage/token_storage.dart';

/// Attaches credentials and transparently refreshes an expired session.
///
/// Design notes:
///  * Refresh is serialised through a single [Completer]. Without it, a screen
///    firing three parallel requests would trigger three refreshes, and the
///    API's reuse detection would revoke the entire token family and sign the
///    user out.
///  * The refresh call uses a bare Dio instance so it cannot recurse back
///    through this interceptor.
///  * On unrecoverable failure the session is cleared and [onSessionExpired]
///    fires exactly once, letting the router send the user to the sign-in
///    screen.
class AuthInterceptor extends Interceptor {
  AuthInterceptor({
    required AppConfig config,
    required TokenStorage tokenStorage,
    required DeviceIdentity deviceIdentity,
    required AppLogger logger,
    required Future<void> Function() onSessionExpired,
    Dio? refreshClient,
  })  : _config = config,
        _tokenStorage = tokenStorage,
        _deviceIdentity = deviceIdentity,
        _logger = logger,
        _onSessionExpired = onSessionExpired,
        _refreshClient = refreshClient ??
            Dio(
              BaseOptions(
                baseUrl: config.versionedBaseUrl,
                connectTimeout: config.connectTimeout,
                receiveTimeout: config.receiveTimeout,
                headers: <String, String>{'x-tenant-slug': config.tenantSlug},
              ),
            );

  static const String _skipAuthKey = 'skipAuth';

  /// Marks a request as unauthenticated (sign-in, registration, refresh).
  static Options unauthenticated([Options? options]) {
    final Options base = options ?? Options();
    return base.copyWith(extra: <String, Object?>{...?base.extra, _skipAuthKey: true});
  }

  final AppConfig _config;
  final TokenStorage _tokenStorage;
  final DeviceIdentity _deviceIdentity;
  final AppLogger _logger;
  final Future<void> Function() _onSessionExpired;
  final Dio _refreshClient;

  Completer<AuthTokens?>? _refreshInFlight;

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    options.headers['x-tenant-slug'] = _config.tenantSlug;

    if (options.extra[_skipAuthKey] == true) {
      handler.next(options);
      return;
    }

    AuthTokens? tokens = await _tokenStorage.read();

    if (tokens == null) {
      handler.next(options);
      return;
    }

    if (tokens.isAccessExpired) {
      // Refresh before spending a round trip on a request that will 401.
      tokens = await _refreshTokens(tokens);
    }

    if (tokens != null) {
      options.headers['authorization'] = 'Bearer ${tokens.accessToken}';
    }

    handler.next(options);
  }

  @override
  Future<void> onError(DioException err, ErrorInterceptorHandler handler) async {
    final RequestOptions request = err.requestOptions;
    final bool isAuthError = err.response?.statusCode == 401;
    final bool alreadyRetried = request.extra['retried'] == true;
    final bool skipsAuth = request.extra[_skipAuthKey] == true;

    if (!isAuthError || alreadyRetried || skipsAuth) {
      handler.next(err);
      return;
    }

    final AuthTokens? current = await _tokenStorage.read();

    if (current == null) {
      handler.next(err);
      return;
    }

    final AuthTokens? refreshed = await _refreshTokens(current);

    if (refreshed == null) {
      handler.next(err);
      return;
    }

    request.extra['retried'] = true;
    request.headers['authorization'] = 'Bearer ${refreshed.accessToken}';

    try {
      final Response<dynamic> response = await _refreshClient.fetch<dynamic>(request);
      handler.resolve(response);
    } on DioException catch (retryError) {
      handler.next(retryError);
    }
  }

  Future<AuthTokens?> _refreshTokens(AuthTokens current) async {
    final Completer<AuthTokens?>? inFlight = _refreshInFlight;

    if (inFlight != null) {
      return inFlight.future;
    }

    final Completer<AuthTokens?> completer = Completer<AuthTokens?>();
    _refreshInFlight = completer;

    try {
      if (current.isRefreshExpired) {
        _logger.info('auth.refresh_token_expired');
        await _expireSession();
        completer.complete(null);
        return null;
      }

      final String deviceId = await _deviceIdentity.deviceId();

      final Response<dynamic> response = await _refreshClient.post<dynamic>(
        '/auth/refresh',
        data: <String, Object?>{
          'refreshToken': current.refreshToken,
          'deviceId': deviceId,
        },
      );

      final AuthTokens? tokens = _parseTokens(response.data);

      if (tokens == null) {
        await _expireSession();
        completer.complete(null);
        return null;
      }

      await _tokenStorage.write(tokens);
      _logger.debug('auth.session_refreshed');
      completer.complete(tokens);
      return tokens;
    } on DioException catch (error) {
      // A 401 here means the family was revoked - reuse detected, or the user
      // signed out elsewhere. Either way the session is gone for good.
      _logger.warning(
        'auth.refresh_failed',
        context: <String, Object?>{'status': error.response?.statusCode},
      );
      await _expireSession();
      completer.complete(null);
      return null;
    } finally {
      _refreshInFlight = null;
    }
  }

  Future<void> _expireSession() async {
    await _tokenStorage.clear();
    await _onSessionExpired();
  }

  AuthTokens? _parseTokens(Object? body) {
    if (body is! Map) {
      return null;
    }

    final Object? data = body['data'] ?? body;
    if (data is! Map) {
      return null;
    }

    final Object? tokens = data['tokens'];
    if (tokens is! Map) {
      return null;
    }

    final Object? accessToken = tokens['accessToken'];
    final Object? refreshToken = tokens['refreshToken'];
    final Object? expiresIn = tokens['expiresIn'];
    final Object? refreshExpiresIn = tokens['refreshExpiresIn'];

    if (accessToken is! String || refreshToken is! String) {
      return null;
    }

    final DateTime now = DateTime.now().toUtc();

    return AuthTokens(
      accessToken: accessToken,
      refreshToken: refreshToken,
      accessExpiresAt: now.add(Duration(seconds: expiresIn is int ? expiresIn : 900)),
      refreshExpiresAt: now.add(
        Duration(seconds: refreshExpiresIn is int ? refreshExpiresIn : 2592000),
      ),
    );
  }
}
```

FILE: apps/mobile/lib/core/network/logging_interceptor.dart

```dart
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
```

FILE: apps/mobile/lib/core/router/app_router.dart

```dart
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/presentation/auth_state.dart';
import '../../features/auth/presentation/login_screen.dart';
import '../../features/auth/presentation/two_factor_screen.dart';
import '../../features/home/home_screen.dart';
import '../../features/settings/security_screen.dart';
import '../../features/settings/settings_screen.dart';
import '../../features/splash/splash_screen.dart';
import '../../features/risk/presentation/risk_screen.dart';
import '../../features/strategies/presentation/strategies_screen.dart';
import '../di/providers.dart';
import 'route_paths.dart';

/// Bridges a Riverpod provider to go_router's [Listenable] refresh mechanism.
class _AuthRefreshNotifier extends ChangeNotifier {
  _AuthRefreshNotifier(this._ref) {
    _subscription = _ref.listen<AuthState>(
      authControllerProvider,
      (AuthState? previous, AuthState next) {
        if (previous?.status != next.status) {
          notifyListeners();
        }
      },
    );
  }

  final Ref _ref;
  late final ProviderSubscription<AuthState> _subscription;

  @override
  void dispose() {
    _subscription.close();
    super.dispose();
  }
}

/// The application router.
///
/// Redirection is centralised here rather than scattered across screens: a
/// single rule set means there is no window where an unauthenticated user can
/// see an authenticated screen, however they arrived at the route.
final Provider<GoRouter> routerProvider = Provider<GoRouter>((Ref ref) {
  final _AuthRefreshNotifier refresh = _AuthRefreshNotifier(ref);
  ref.onDispose(refresh.dispose);

  return GoRouter(
    initialLocation: RoutePaths.splash,
    refreshListenable: refresh,
    redirect: (BuildContext context, GoRouterState state) {
      final AuthState auth = ref.read(authControllerProvider);
      final String location = state.matchedLocation;

      if (auth.status == AuthStatus.initialising) {
        return location == RoutePaths.splash ? null : RoutePaths.splash;
      }

      final bool onAuthRoute =
          location == RoutePaths.login || location == RoutePaths.twoFactor;

      if (auth.status == AuthStatus.awaitingTwoFactor) {
        return location == RoutePaths.twoFactor ? null : RoutePaths.twoFactor;
      }

      if (auth.status == AuthStatus.unauthenticated) {
        return onAuthRoute ? null : RoutePaths.login;
      }

      // Authenticated: keep the user out of the sign-in flow and off the splash.
      if (onAuthRoute || location == RoutePaths.splash) {
        return RoutePaths.home;
      }

      return null;
    },
    routes: <RouteBase>[
      GoRoute(
        path: RoutePaths.splash,
        name: RouteNames.splash,
        builder: (BuildContext context, GoRouterState state) => const SplashScreen(),
      ),
      GoRoute(
        path: RoutePaths.login,
        name: RouteNames.login,
        builder: (BuildContext context, GoRouterState state) => const LoginScreen(),
      ),
      GoRoute(
        path: RoutePaths.twoFactor,
        name: RouteNames.twoFactor,
        builder: (BuildContext context, GoRouterState state) => const TwoFactorScreen(),
      ),
      GoRoute(
        path: RoutePaths.home,
        name: RouteNames.home,
        builder: (BuildContext context, GoRouterState state) => const HomeScreen(),
      ),
      GoRoute(
        path: RoutePaths.strategies,
        name: RouteNames.strategies,
        builder: (BuildContext context, GoRouterState state) => const StrategiesScreen(),
      ),
      GoRoute(
        path: RoutePaths.risk,
        name: RouteNames.risk,
        builder: (BuildContext context, GoRouterState state) => const RiskScreen(),
      ),
      GoRoute(
        path: RoutePaths.settings,
        name: RouteNames.settings,
        builder: (BuildContext context, GoRouterState state) => const SettingsScreen(),
        routes: <RouteBase>[
          GoRoute(
            path: 'security',
            name: RouteNames.security,
            builder: (BuildContext context, GoRouterState state) => const SecurityScreen(),
          ),
        ],
      ),
    ],
    errorBuilder: (BuildContext context, GoRouterState state) => const _RouteNotFoundScreen(),
  );
});

class _RouteNotFoundScreen extends StatelessWidget {
  const _RouteNotFoundScreen();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Text('This screen is not available.'),
    );
  }
}
```

FILE: apps/mobile/lib/core/router/route_paths.dart

```dart
/// Every navigable location in the app.
///
/// Declared as constants so a typo is a compile error rather than a blank
/// screen at runtime.
class RoutePaths {
  const RoutePaths._();

  static const String splash = '/';
  static const String login = '/login';
  static const String twoFactor = '/login/two-factor';
  static const String home = '/home';
  static const String strategies = '/strategies';
  static const String risk = '/risk';
  static const String settings = '/settings';
  static const String security = '/settings/security';
}

class RouteNames {
  const RouteNames._();

  static const String splash = 'splash';
  static const String login = 'login';
  static const String twoFactor = 'twoFactor';
  static const String home = 'home';
  static const String strategies = 'strategies';
  static const String risk = 'risk';
  static const String settings = 'settings';
  static const String security = 'security';
}
```

FILE: apps/mobile/lib/core/storage/device_identity.dart

```dart
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
```

FILE: apps/mobile/lib/core/storage/secure_storage.dart

```dart
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
```

FILE: apps/mobile/lib/core/storage/token_storage.dart

```dart
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
```

FILE: apps/mobile/lib/core/theme/app_theme.dart

```dart
import 'package:flutter/material.dart';

import 'brand_tokens.dart';

/// Builds Material themes from the active [BrandTokens].
///
/// One builder for both brightnesses keeps light and dark visually consistent,
/// and means a tenant only has to supply a handful of colours.
class AppTheme {
  const AppTheme._();

  static ThemeData light(BrandTokens tokens) => _build(tokens, Brightness.light);

  static ThemeData dark(BrandTokens tokens) => _build(tokens, Brightness.dark);

  static ThemeData _build(BrandTokens tokens, Brightness brightness) {
    final ColorScheme scheme = ColorScheme.fromSeed(
      seedColor: tokens.primary,
      brightness: brightness,
      primary: tokens.primary,
      secondary: tokens.accent,
    );

    final bool isDark = brightness == Brightness.dark;

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: isDark ? tokens.background : scheme.surface,
      appBarTheme: AppBarTheme(
        centerTitle: false,
        elevation: 0,
        backgroundColor: isDark ? tokens.background : scheme.surface,
        foregroundColor: isDark ? tokens.onBackground : scheme.onSurface,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide(color: scheme.outlineVariant),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide(color: scheme.outlineVariant),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide(color: scheme.primary, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide(color: scheme.error),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(50),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        ),
      ),
      cardTheme: CardTheme(
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: BorderSide(color: scheme.outlineVariant),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
    );
  }
}
```

FILE: apps/mobile/lib/core/theme/brand_tokens.dart

```dart
import 'package:flutter/material.dart';

/// Tenant-controlled visual identity.
///
/// Defaults ship with the binary so the app renders correctly before the
/// branding endpoint responds; the values are then replaced at runtime from
/// `GET /v1/tenants/public-config`. Colours arriving from the API are parsed
/// defensively - a malformed value falls back rather than throwing.
class BrandTokens {
  const BrandTokens({
    required this.appName,
    required this.primary,
    required this.secondary,
    required this.accent,
    required this.background,
    required this.onBackground,
    required this.themeMode,
    this.logoUrl,
    this.supportEmail,
    this.termsUrl,
    this.privacyUrl,
  });

  static const BrandTokens fallback = BrandTokens(
    appName: 'Copy Trading',
    primary: Color(0xFF4F7CFF),
    secondary: Color(0xFF1A2340),
    accent: Color(0xFF2FBF71),
    background: Color(0xFF0B1020),
    onBackground: Color(0xFFE8ECF7),
    themeMode: ThemeMode.dark,
  );

  final String appName;
  final Color primary;
  final Color secondary;
  final Color accent;
  final Color background;
  final Color onBackground;
  final ThemeMode themeMode;
  final String? logoUrl;
  final String? supportEmail;
  final String? termsUrl;
  final String? privacyUrl;

  static BrandTokens fromJson(Map<String, Object?> json) {
    final Object? branding = json['branding'];
    final Map<String, Object?> source =
        branding is Map ? Map<String, Object?>.from(branding) : json;

    return BrandTokens(
      appName: source['appName'] as String? ?? fallback.appName,
      primary: parseColor(source['primaryColor'], fallback.primary),
      secondary: parseColor(source['secondaryColor'], fallback.secondary),
      accent: parseColor(source['accentColor'], fallback.accent),
      background: parseColor(source['backgroundColor'], fallback.background),
      onBackground: parseColor(source['textColor'], fallback.onBackground),
      themeMode: parseThemeMode(source['themeMode']),
      logoUrl: source['logoUrl'] as String?,
      supportEmail: source['supportEmail'] as String?,
      termsUrl: source['termsUrl'] as String?,
      privacyUrl: source['privacyUrl'] as String?,
    );
  }

  /// Parses `#RGB`, `#RRGGBB` and `#AARRGGBB`. Anything else uses the fallback.
  static Color parseColor(Object? value, Color fallbackColor) {
    if (value is! String) {
      return fallbackColor;
    }

    final String hex = value.trim().replaceFirst('#', '');

    final String normalised;
    if (hex.length == 3) {
      normalised = 'FF${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}';
    } else if (hex.length == 6) {
      normalised = 'FF$hex';
    } else if (hex.length == 8) {
      normalised = hex;
    } else {
      return fallbackColor;
    }

    final int? parsed = int.tryParse(normalised, radix: 16);
    return parsed == null ? fallbackColor : Color(parsed);
  }

  static ThemeMode parseThemeMode(Object? value) {
    switch (value) {
      case 'light':
        return ThemeMode.light;
      case 'dark':
        return ThemeMode.dark;
      default:
        return ThemeMode.system;
    }
  }
}
```

FILE: apps/mobile/lib/core/theme/branding_controller.dart

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../di/providers.dart';
import '../error/app_exception.dart';
import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import 'brand_tokens.dart';

/// Loads tenant branding.
///
/// Unauthenticated on purpose: the sign-in screen must already look like the
/// tenant's product. A failure is not fatal - the app keeps the fallback theme
/// rather than blocking startup on a cosmetic request.
class BrandingController extends StateNotifier<BrandTokens> {
  BrandingController(this._apiClient) : super(BrandTokens.fallback);

  final ApiClient _apiClient;

  Future<void> load() async {
    try {
      final Map<String, Object?> payload = await _apiClient.get<Map<String, Object?>>(
        ApiEndpoints.tenantPublicConfig,
        authenticated: false,
        parser: (Object? data) =>
            data is Map ? Map<String, Object?>.from(data) : <String, Object?>{},
      );

      if (payload.isNotEmpty) {
        state = BrandTokens.fromJson(payload);
      }
    } on AppException {
      // Keep the fallback theme; branding is not worth failing startup over.
      state = BrandTokens.fallback;
    }
  }
}

final StateNotifierProvider<BrandingController, BrandTokens> brandingProvider =
    StateNotifierProvider<BrandingController, BrandTokens>((Ref ref) {
  return BrandingController(ref.watch(apiClientProvider));
});
```

FILE: apps/mobile/lib/features/auth/data/auth_repository.dart

```dart
import '../../../core/error/app_exception.dart';
import '../../../core/logging/app_logger.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_endpoints.dart';
import '../../../core/storage/device_identity.dart';
import '../../../core/storage/token_storage.dart';
import '../domain/auth_models.dart';

/// All authentication I/O.
///
/// The repository owns token persistence so no other layer ever handles a raw
/// token. Callers receive domain objects and exceptions, never HTTP details.
class AuthRepository {
  AuthRepository({
    required ApiClient apiClient,
    required TokenStorage tokenStorage,
    required DeviceIdentity deviceIdentity,
    required AppLogger logger,
  })  : _apiClient = apiClient,
        _tokenStorage = tokenStorage,
        _deviceIdentity = deviceIdentity,
        _logger = logger;

  final ApiClient _apiClient;
  final TokenStorage _tokenStorage;
  final DeviceIdentity _deviceIdentity;
  final AppLogger _logger;

  Future<LoginOutcome> login({required String email, required String password}) async {
    final String deviceId = await _deviceIdentity.deviceId();

    final Map<String, Object?> payload = await _apiClient.post<Map<String, Object?>>(
      ApiEndpoints.login,
      authenticated: false,
      body: <String, Object?>{
        'email': email.trim().toLowerCase(),
        'password': password,
        'deviceId': deviceId,
        'platform': 'ios',
      },
      parser: _asMap,
    );

    if (payload['twoFactorRequired'] == true) {
      final Object? methods = payload['methods'];

      return LoginNeedsTwoFactor(
        challengeToken: payload['challengeToken'] as String? ?? '',
        methods: methods is List ? methods.whereType<String>().toList(growable: false) : const <String>['TOTP'],
      );
    }

    final AuthUser user = await _persistSession(payload);
    _logger.info('auth.login_succeeded');
    return LoginSucceeded(user);
  }

  Future<AuthUser> verifyTwoFactor({
    required String challengeToken,
    required String code,
    required String method,
  }) async {
    final String deviceId = await _deviceIdentity.deviceId();

    final Map<String, Object?> payload = await _apiClient.post<Map<String, Object?>>(
      ApiEndpoints.verifyTwoFactor,
      authenticated: false,
      body: <String, Object?>{
        'challengeToken': challengeToken,
        'code': code.trim(),
        'method': method,
        'deviceId': deviceId,
      },
      parser: _asMap,
    );

    final AuthUser user = await _persistSession(payload);
    _logger.info('auth.two_factor_verified');
    return user;
  }

  Future<AuthUser> register({
    required String email,
    required String password,
    required bool acceptedTerms,
    String? firstName,
    String? lastName,
  }) async {
    final String deviceId = await _deviceIdentity.deviceId();

    final Map<String, Object?> payload = await _apiClient.post<Map<String, Object?>>(
      ApiEndpoints.register,
      authenticated: false,
      body: <String, Object?>{
        'email': email.trim().toLowerCase(),
        'password': password,
        'acceptedTerms': acceptedTerms,
        if (firstName != null && firstName.isNotEmpty) 'firstName': firstName,
        if (lastName != null && lastName.isNotEmpty) 'lastName': lastName,
        'deviceId': deviceId,
        'platform': 'ios',
      },
      parser: _asMap,
    );

    return _persistSession(payload);
  }

  /// Returns the current user, or null when there is no usable session.
  Future<AuthUser?> restoreSession() async {
    final AuthTokens? tokens = await _tokenStorage.read();

    if (tokens == null || tokens.isRefreshExpired) {
      // Nothing to restore; make sure no stale material is left behind.
      await _tokenStorage.clear();
      return null;
    }

    try {
      return await currentUser();
    } on AppException catch (error) {
      if (error.isAuthFailure) {
        await _tokenStorage.clear();
        return null;
      }
      rethrow;
    }
  }

  Future<AuthUser> currentUser() async {
    final Map<String, Object?> payload = await _apiClient.get<Map<String, Object?>>(
      ApiEndpoints.me,
      parser: _asMap,
    );

    return AuthUser.fromJson(payload);
  }

  Future<void> logout({bool allDevices = false}) async {
    try {
      await _apiClient.post<Object?>(
        ApiEndpoints.logout,
        body: <String, Object?>{'allDevices': allDevices},
        parser: (Object? data) => data,
      );
    } on AppException catch (error) {
      // Local sign-out must succeed even when the network call does not.
      _logger.warning('auth.logout_request_failed', context: <String, Object?>{'code': error.code.name});
    } finally {
      await _tokenStorage.clear();
    }
  }

  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    await _apiClient.post<Object?>(
      ApiEndpoints.changePassword,
      body: <String, Object?>{
        'currentPassword': currentPassword,
        'newPassword': newPassword,
      },
      parser: (Object? data) => data,
    );

    // The API revokes every other session on a password change; the local one
    // is rotated server-side, so the safest client behaviour is a clean start.
    await _tokenStorage.clear();
  }

  Future<AuthUser> _persistSession(Map<String, Object?> payload) async {
    final Object? tokensNode = payload['tokens'];
    final Object? userNode = payload['user'];

    if (tokensNode is! Map || userNode is! Map) {
      throw const AppException(
        code: AppErrorCode.unknown,
        message: 'The server returned an unexpected sign-in response.',
      );
    }

    final Object? accessToken = tokensNode['accessToken'];
    final Object? refreshToken = tokensNode['refreshToken'];

    if (accessToken is! String || refreshToken is! String) {
      throw const AppException(
        code: AppErrorCode.unknown,
        message: 'The server returned an unexpected sign-in response.',
      );
    }

    final DateTime now = DateTime.now().toUtc();
    final Object? expiresIn = tokensNode['expiresIn'];
    final Object? refreshExpiresIn = tokensNode['refreshExpiresIn'];

    await _tokenStorage.write(
      AuthTokens(
        accessToken: accessToken,
        refreshToken: refreshToken,
        accessExpiresAt: now.add(Duration(seconds: expiresIn is int ? expiresIn : 900)),
        refreshExpiresAt: now.add(
          Duration(seconds: refreshExpiresIn is int ? refreshExpiresIn : 2592000),
        ),
      ),
    );

    return AuthUser.fromJson(Map<String, Object?>.from(userNode));
  }

  Map<String, Object?> _asMap(Object? data) {
    if (data is Map) {
      return Map<String, Object?>.from(data);
    }

    throw const AppException(
      code: AppErrorCode.unknown,
      message: 'The server returned an unexpected response.',
    );
  }
}
```

FILE: apps/mobile/lib/features/auth/domain/auth_models.dart

```dart
import 'package:equatable/equatable.dart';

/// Account lifecycle state as reported by the API.
enum UserStatus {
  pendingVerification,
  active,
  suspended,
  locked,
  deactivated,
  unknown;

  static UserStatus fromApi(String? value) {
    switch (value) {
      case 'PENDING_VERIFICATION':
        return UserStatus.pendingVerification;
      case 'ACTIVE':
        return UserStatus.active;
      case 'SUSPENDED':
        return UserStatus.suspended;
      case 'LOCKED':
        return UserStatus.locked;
      case 'DEACTIVATED':
        return UserStatus.deactivated;
      default:
        return UserStatus.unknown;
    }
  }
}

/// The signed-in user.
///
/// Mirrors the API's `UserDto` minus anything the client has no business
/// holding. Permissions are carried for UI gating only - the API re-checks
/// every one of them on every request.
class AuthUser extends Equatable {
  const AuthUser({
    required this.id,
    required this.tenantId,
    required this.email,
    required this.status,
    required this.twoFactorEnabled,
    required this.roles,
    required this.permissions,
    this.displayName,
    this.avatarUrl,
    this.locale = 'en',
  });

  final String id;
  final String tenantId;
  final String email;
  final UserStatus status;
  final bool twoFactorEnabled;
  final List<String> roles;
  final List<String> permissions;
  final String? displayName;
  final String? avatarUrl;
  final String locale;

  bool get isActive => status == UserStatus.active;

  /// Supports exact matches and the wildcard forms the API issues.
  bool can(String permission) {
    if (permissions.contains('*') || permissions.contains(permission)) {
      return true;
    }

    final int separator = permission.indexOf(':');
    if (separator <= 0) {
      return false;
    }

    return permissions.contains('${permission.substring(0, separator)}:*');
  }

  static AuthUser fromJson(Map<String, Object?> json) {
    final Object? profile = json['profile'];
    final Object? roles = json['roles'];
    final Object? permissions = json['permissions'];

    return AuthUser(
      id: json['id'] as String? ?? '',
      tenantId: json['tenantId'] as String? ?? '',
      email: json['email'] as String? ?? '',
      status: UserStatus.fromApi(json['status'] as String?),
      twoFactorEnabled: json['twoFactorEnabled'] as bool? ?? false,
      roles: roles is List
          ? roles
              .whereType<Map<Object?, Object?>>()
              .map((Map<Object?, Object?> role) => role['key'] as String? ?? '')
              .where((String key) => key.isNotEmpty)
              .toList(growable: false)
          : const <String>[],
      permissions: permissions is List
          ? permissions.whereType<String>().toList(growable: false)
          : const <String>[],
      displayName: profile is Map<Object?, Object?> ? profile['displayName'] as String? : null,
      avatarUrl: profile is Map<Object?, Object?> ? profile['avatarUrl'] as String? : null,
      locale: profile is Map<Object?, Object?>
          ? (profile['locale'] as String? ?? 'en')
          : 'en',
    );
  }

  @override
  List<Object?> get props => <Object?>[id, tenantId, email, status, twoFactorEnabled, roles, permissions];
}

/// Outcome of a sign-in attempt: either a session, or a 2FA challenge.
sealed class LoginOutcome {
  const LoginOutcome();
}

class LoginSucceeded extends LoginOutcome {
  const LoginSucceeded(this.user);

  final AuthUser user;
}

class LoginNeedsTwoFactor extends LoginOutcome {
  const LoginNeedsTwoFactor({required this.challengeToken, required this.methods});

  /// Held in memory only, for the seconds the challenge screen is open.
  final String challengeToken;
  final List<String> methods;
}
```

FILE: apps/mobile/lib/features/auth/presentation/auth_controller.dart

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/error/app_exception.dart';
import '../../../core/logging/app_logger.dart';
import '../data/auth_repository.dart';
import '../domain/auth_models.dart';
import 'auth_state.dart';

/// Owns the authentication lifecycle.
///
/// Every method funnels failures through [AppException] so the UI renders a
/// safe message and never an exception string. The controller holds no tokens:
/// persistence is entirely the repository's job.
class AuthController extends StateNotifier<AuthState> {
  AuthController({required AuthRepository repository, required AppLogger logger})
      : _repository = repository,
        _logger = logger,
        super(const AuthState.initial());

  final AuthRepository _repository;
  final AppLogger _logger;

  /// Called once at startup and again whenever the session is invalidated.
  Future<void> restore() async {
    try {
      final AuthUser? user = await _repository.restoreSession();

      state = user == null
          ? const AuthState(status: AuthStatus.unauthenticated)
          : AuthState(status: AuthStatus.authenticated, user: user);
    } on AppException catch (error) {
      _logger.warning('auth.restore_failed', context: <String, Object?>{'code': error.code.name});
      state = AuthState(status: AuthStatus.unauthenticated, error: error);
    }
  }

  Future<void> signIn({required String email, required String password}) async {
    state = state.copyWith(isSubmitting: true, clearError: true);

    try {
      final LoginOutcome outcome = await _repository.login(email: email, password: password);

      switch (outcome) {
        case LoginSucceeded(user: final AuthUser user):
          state = AuthState(status: AuthStatus.authenticated, user: user);
        case LoginNeedsTwoFactor(
            challengeToken: final String token,
            methods: final List<String> methods,
          ):
          state = AuthState(
            status: AuthStatus.awaitingTwoFactor,
            challengeToken: token,
            twoFactorMethods: methods,
          );
      }
    } on AppException catch (error) {
      state = state.copyWith(isSubmitting: false, error: error);
    }
  }

  Future<void> submitTwoFactor({required String code, String method = 'TOTP'}) async {
    final String? challengeToken = state.challengeToken;

    if (challengeToken == null) {
      state = state.copyWith(
        status: AuthStatus.unauthenticated,
        error: const AppException(
          code: AppErrorCode.unauthorized,
          message: 'The challenge expired. Please sign in again.',
        ),
        isSubmitting: false,
        clearChallenge: true,
      );
      return;
    }

    state = state.copyWith(isSubmitting: true, clearError: true);

    try {
      final AuthUser user = await _repository.verifyTwoFactor(
        challengeToken: challengeToken,
        code: code,
        method: method,
      );

      state = AuthState(status: AuthStatus.authenticated, user: user);
    } on AppException catch (error) {
      state = state.copyWith(isSubmitting: false, error: error);
    }
  }

  Future<void> register({
    required String email,
    required String password,
    required bool acceptedTerms,
    String? firstName,
    String? lastName,
  }) async {
    state = state.copyWith(isSubmitting: true, clearError: true);

    try {
      final AuthUser user = await _repository.register(
        email: email,
        password: password,
        acceptedTerms: acceptedTerms,
        firstName: firstName,
        lastName: lastName,
      );

      state = AuthState(status: AuthStatus.authenticated, user: user);
    } on AppException catch (error) {
      state = state.copyWith(isSubmitting: false, error: error);
    }
  }

  Future<void> signOut({bool allDevices = false}) async {
    state = state.copyWith(isSubmitting: true, clearError: true);
    await _repository.logout(allDevices: allDevices);
    state = const AuthState(status: AuthStatus.unauthenticated);
  }

  /// Invoked by the network layer when a refresh fails irrecoverably.
  void onSessionExpired() {
    if (state.status == AuthStatus.unauthenticated) {
      return;
    }

    _logger.info('auth.session_expired');

    state = const AuthState(
      status: AuthStatus.unauthenticated,
      error: AppException(
        code: AppErrorCode.unauthorized,
        message: 'Your session has expired. Please sign in again.',
      ),
    );
  }

  void clearError() {
    state = state.copyWith(clearError: true);
  }

  void cancelTwoFactor() {
    state = const AuthState(status: AuthStatus.unauthenticated);
  }
}
```

FILE: apps/mobile/lib/features/auth/presentation/auth_state.dart

```dart
import 'package:equatable/equatable.dart';

import '../../../core/error/app_exception.dart';
import '../domain/auth_models.dart';

/// Where the session is, as far as the UI is concerned.
enum AuthStatus {
  /// Startup: the stored session has not been checked yet.
  initialising,

  unauthenticated,

  /// Password accepted, waiting on the second factor.
  awaitingTwoFactor,

  authenticated,
}

/// Immutable authentication state.
class AuthState extends Equatable {
  const AuthState({
    required this.status,
    this.user,
    this.error,
    this.isSubmitting = false,
    this.challengeToken,
    this.twoFactorMethods = const <String>[],
  });

  const AuthState.initial() : this(status: AuthStatus.initialising);

  final AuthStatus status;
  final AuthUser? user;
  final AppException? error;
  final bool isSubmitting;

  /// Kept in memory only and cleared as soon as the challenge resolves.
  final String? challengeToken;
  final List<String> twoFactorMethods;

  bool get isAuthenticated => status == AuthStatus.authenticated && user != null;

  AuthState copyWith({
    AuthStatus? status,
    AuthUser? user,
    AppException? error,
    bool? isSubmitting,
    String? challengeToken,
    List<String>? twoFactorMethods,
    bool clearError = false,
    bool clearUser = false,
    bool clearChallenge = false,
  }) {
    return AuthState(
      status: status ?? this.status,
      user: clearUser ? null : (user ?? this.user),
      error: clearError ? null : (error ?? this.error),
      isSubmitting: isSubmitting ?? this.isSubmitting,
      challengeToken: clearChallenge ? null : (challengeToken ?? this.challengeToken),
      twoFactorMethods: clearChallenge ? const <String>[] : (twoFactorMethods ?? this.twoFactorMethods),
    );
  }

  @override
  List<Object?> get props =>
      <Object?>[status, user, error, isSubmitting, challengeToken, twoFactorMethods];
}
```

FILE: apps/mobile/lib/features/auth/presentation/login_screen.dart

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/providers.dart';
import '../../../core/theme/branding_controller.dart';
import '../../../l10n/app_localizations.dart';
import 'auth_state.dart';

/// Sign-in screen.
///
/// Validation is client-side for responsiveness only; the API validates again
/// and its field errors are merged into the form. The password field is never
/// logged, never persisted and cleared as soon as the request completes.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _emailController = TextEditingController();
  final TextEditingController _passwordController = TextEditingController();

  bool _obscurePassword = true;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final FormState? form = _formKey.currentState;

    if (form == null || !form.validate()) {
      return;
    }

    FocusScope.of(context).unfocus();

    await ref.read(authControllerProvider.notifier).signIn(
          email: _emailController.text,
          password: _passwordController.text,
        );

    if (!mounted) {
      return;
    }

    // The password is not needed again in any flow.
    _passwordController.clear();
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AuthState state = ref.watch(authControllerProvider);
    final String appName = ref.watch(brandingProvider).appName;
    final Map<String, String> fieldErrors = state.error?.fieldErrorMap ?? const <String, String>{};

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _formKey,
                autovalidateMode: AutovalidateMode.onUserInteraction,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    Text(
                      appName,
                      style: Theme.of(context)
                          .textTheme
                          .headlineSmall
                          ?.copyWith(fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      l10n.signInSubtitle,
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                    const SizedBox(height: 28),
                    TextFormField(
                      controller: _emailController,
                      keyboardType: TextInputType.emailAddress,
                      textInputAction: TextInputAction.next,
                      autocorrect: false,
                      autofillHints: const <String>[AutofillHints.username],
                      decoration: InputDecoration(
                        labelText: l10n.emailLabel,
                        errorText: fieldErrors['email'],
                      ),
                      validator: (String? value) {
                        final String email = value?.trim() ?? '';
                        if (email.isEmpty) {
                          return l10n.emailRequired;
                        }
                        if (!RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(email)) {
                          return l10n.emailInvalid;
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _passwordController,
                      obscureText: _obscurePassword,
                      textInputAction: TextInputAction.done,
                      autofillHints: const <String>[AutofillHints.password],
                      decoration: InputDecoration(
                        labelText: l10n.passwordLabel,
                        errorText: fieldErrors['password'],
                        suffixIcon: IconButton(
                          onPressed: () =>
                              setState(() => _obscurePassword = !_obscurePassword),
                          icon: Icon(
                            _obscurePassword ? Icons.visibility_off : Icons.visibility,
                          ),
                        ),
                      ),
                      validator: (String? value) =>
                          (value == null || value.isEmpty) ? l10n.passwordRequired : null,
                      onFieldSubmitted: (_) => _submit(),
                    ),
                    if (state.error != null && fieldErrors.isEmpty) ...<Widget>[
                      const SizedBox(height: 16),
                      _ErrorBanner(message: state.error!.message),
                    ],
                    const SizedBox(height: 24),
                    FilledButton(
                      onPressed: state.isSubmitting ? null : _submit,
                      child: state.isSubmitting
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : Text(l10n.signIn),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final ColorScheme scheme = Theme.of(context).colorScheme;

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: scheme.errorContainer,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: <Widget>[
          Icon(Icons.error_outline, size: 20, color: scheme.onErrorContainer),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message,
              style: TextStyle(color: scheme.onErrorContainer, fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }
}
```

FILE: apps/mobile/lib/features/auth/presentation/two_factor_screen.dart

```dart
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/providers.dart';
import '../../../l10n/app_localizations.dart';
import 'auth_state.dart';

/// Second-factor challenge.
///
/// The challenge token lives only in [AuthState] for the lifetime of this
/// screen - it is never written to storage. Cancelling drops it and returns the
/// user to a clean sign-in.
class TwoFactorScreen extends ConsumerStatefulWidget {
  const TwoFactorScreen({super.key});

  @override
  ConsumerState<TwoFactorScreen> createState() => _TwoFactorScreenState();
}

class _TwoFactorScreenState extends ConsumerState<TwoFactorScreen> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _codeController = TextEditingController();

  bool _useRecoveryCode = false;

  @override
  void dispose() {
    _codeController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final FormState? form = _formKey.currentState;

    if (form == null || !form.validate()) {
      return;
    }

    FocusScope.of(context).unfocus();

    await ref.read(authControllerProvider.notifier).submitTwoFactor(
          code: _codeController.text,
          method: _useRecoveryCode ? 'RECOVERY_CODE' : 'TOTP',
        );

    if (!mounted) {
      return;
    }

    _codeController.clear();
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AuthState state = ref.watch(authControllerProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.twoFactorTitle),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => ref.read(authControllerProvider.notifier).cancelTwoFactor(),
        ),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Form(
              key: _formKey,
              autovalidateMode: AutovalidateMode.onUserInteraction,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Text(l10n.twoFactorSubtitle, style: Theme.of(context).textTheme.bodyMedium),
                  const SizedBox(height: 24),
                  TextFormField(
                    controller: _codeController,
                    keyboardType:
                        _useRecoveryCode ? TextInputType.text : TextInputType.number,
                    inputFormatters: _useRecoveryCode
                        ? const <TextInputFormatter>[]
                        : <TextInputFormatter>[
                            FilteringTextInputFormatter.digitsOnly,
                            LengthLimitingTextInputFormatter(6),
                          ],
                    autofillHints: const <String>[AutofillHints.oneTimeCode],
                    decoration: InputDecoration(
                      labelText: _useRecoveryCode
                          ? l10n.recoveryCodeLabel
                          : l10n.twoFactorCodeLabel,
                    ),
                    validator: (String? value) =>
                        (value == null || value.trim().length < 6) ? l10n.codeRequired : null,
                    onFieldSubmitted: (_) => _submit(),
                  ),
                  if (state.error != null) ...<Widget>[
                    const SizedBox(height: 16),
                    Text(
                      state.error!.message,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                        fontSize: 13,
                      ),
                    ),
                  ],
                  const SizedBox(height: 24),
                  FilledButton(
                    onPressed: state.isSubmitting ? null : _submit,
                    child: state.isSubmitting
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Text(l10n.verify),
                  ),
                  const SizedBox(height: 12),
                  TextButton(
                    onPressed: () {
                      setState(() {
                        _useRecoveryCode = !_useRecoveryCode;
                        _codeController.clear();
                      });
                      ref.read(authControllerProvider.notifier).clearError();
                    },
                    child: Text(
                      _useRecoveryCode ? l10n.useAuthenticator : l10n.useRecoveryCode,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
```

FILE: apps/mobile/lib/features/home/home_screen.dart

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/di/providers.dart';
import '../../core/router/route_paths.dart';
import '../../l10n/app_localizations.dart';
import '../auth/domain/auth_models.dart';
import '../auth/presentation/auth_state.dart';

/// Authenticated landing screen.
///
/// Part 1 deliberately shows account state rather than trading data: there is
/// no trading data yet, and inventing some would be worse than showing none.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AuthState state = ref.watch(authControllerProvider);
    final AuthUser? user = state.user;

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.homeTitle),
        actions: <Widget>[
          IconButton(
            icon: const Icon(Icons.settings_outlined),
            onPressed: () => context.push(RoutePaths.settings),
            tooltip: l10n.settingsTitle,
          ),
        ],
      ),
      body: user == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(20),
              children: <Widget>[
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(18),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(l10n.welcomeBack, style: Theme.of(context).textTheme.labelMedium),
                        const SizedBox(height: 6),
                        Text(
                          user.displayName ?? user.email,
                          style: Theme.of(context)
                              .textTheme
                              .titleLarge
                              ?.copyWith(fontWeight: FontWeight.w700),
                        ),
                        const SizedBox(height: 12),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: <Widget>[
                            for (final String role in user.roles) Chip(label: Text(role)),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(18),
                    child: Row(
                      children: <Widget>[
                        Icon(
                          user.twoFactorEnabled ? Icons.verified_user : Icons.gpp_maybe,
                          color: user.twoFactorEnabled
                              ? Theme.of(context).colorScheme.primary
                              : Theme.of(context).colorScheme.error,
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            user.twoFactorEnabled
                                ? l10n.twoFactorEnabled
                                : l10n.twoFactorDisabled,
                          ),
                        ),
                        TextButton(
                          onPressed: () => context.push(RoutePaths.security),
                          child: Text(l10n.securityTitle),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                // Shown only to users the API would actually answer. Hiding
                // the tile is a usability filter, not access control: the
                // endpoint re-checks the permission on every request.
                if (user.can('strategy_instance:read'))
                  Card(
                    child: ListTile(
                      leading: const Icon(Icons.insights_outlined),
                      title: Text(l10n.strategiesTitle),
                      subtitle: Text(l10n.strategiesSubtitle),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => context.push(RoutePaths.strategies),
                    ),
                  ),
                if (user.can('strategy_instance:read')) const SizedBox(height: 16),
                // Same rule as the strategies tile: the tile exists if the
                // API would answer; the endpoint re-checks the permission on
                // every request regardless of what is rendered here.
                if (user.can('risk:read'))
                  Card(
                    child: ListTile(
                      leading: const Icon(Icons.gpp_good_outlined),
                      title: Text(l10n.riskTitle),
                      subtitle: Text(l10n.riskSubtitle),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => context.push(RoutePaths.risk),
                    ),
                  ),
                if (user.can('risk:read')) const SizedBox(height: 16),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(18),
                    child: Row(
                      children: <Widget>[
                        const Icon(Icons.info_outline),
                        const SizedBox(width: 12),
                        Expanded(child: Text(l10n.executionDisabledNotice)),
                      ],
                    ),
                  ),
                ),
              ],
            ),
    );
  }
}
```

FILE: apps/mobile/lib/features/risk/data/risk_repository.dart

```dart
import '../../../core/logging/app_logger.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_endpoints.dart';
import '../domain/risk_models.dart';

/// Read-only access to the risk layer.
///
/// This repository exposes GET requests and nothing else, and that is
/// load-bearing: the mobile client is a viewer. Engaging or clearing a
/// switch requires a written reason and, for a triggered protection, a
/// typed confirmation phrase - an interaction shape the admin console
/// carries and a phone deliberately does not. There is no method here that
/// could PUT a limit or POST a halt even if a build were tampered with;
/// the API separately requires `risk:read` and refuses every write this
/// role cannot make.
///
/// Everything served through here is mirrored state, timestamped as such.
/// The screen never presents these numbers as a live venue read, because
/// the API does not perform one for this route.
class RiskRepository {
  RiskRepository({
    required ApiClient apiClient,
    required AppLogger logger,
  })  : _apiClient = apiClient,
        _logger = logger;

  final ApiClient _apiClient;
  final AppLogger _logger;

  /// The deployment posture: engine config, mirror freshness, active halts.
  Future<RiskMirrorStatus> fetchStatus() async {
    final RiskMirrorStatus status = await _apiClient.get<RiskMirrorStatus>(
      ApiEndpoints.riskStatus,
      parser: (Object? data) => RiskMirrorStatus.fromJson(_asMap(data)),
    );

    _logger.debug('risk.status_loaded');
    return status;
  }

  /// All kill switches visible to the organisation. The endpoint answers
  /// with a bare array (bounded server-side); a malformed payload degrades
  /// to empty rather than throwing - a viewer screen that shows "nothing"
  /// beats one that crashes, and the admin console is where truth is chased.
  Future<List<RiskSwitchInfo>> fetchSwitches() async {
    final List<RiskSwitchInfo> switches =
        await _apiClient.get<List<RiskSwitchInfo>>(
      ApiEndpoints.riskKillSwitches,
      parser: (Object? data) {
        if (data is! List) {
          return const <RiskSwitchInfo>[];
        }
        return data
            .whereType<Map<Object?, Object?>>()
            .map((Map<Object?, Object?> row) =>
                RiskSwitchInfo.fromJson(_asMap(row)))
            .toList(growable: false);
      },
    );

    return switches;
  }

  /// The newest risk events, live-path only (simulated rows are filtered
  /// server-side unless explicitly requested, and this client never
  /// requests them into the same feed).
  Future<List<RiskEventInfo>> fetchEvents({int limit = 25}) async {
    return _apiClient.get<List<RiskEventInfo>>(
      ApiEndpoints.riskEvents,
      queryParameters: <String, Object?>{'page': 1, 'limit': limit},
      parser: (Object? data) {
        final Map<String, Object?> map = _asMap(data);
        final Object? items = map['items'];
        if (items is! List) {
          return const <RiskEventInfo>[];
        }
        return items
            .whereType<Map<Object?, Object?>>()
            .map((Map<Object?, Object?> row) =>
                RiskEventInfo.fromJson(_asMap(row)))
            .toList(growable: false);
      },
    );
  }

  static Map<String, Object?> _asMap(Object? value) {
    if (value is Map) {
      return value.map<String, Object?>(
        (Object? key, Object? item) => MapEntry<String, Object?>(key.toString(), item),
      );
    }
    return const <String, Object?>{};
  }
}
```

FILE: apps/mobile/lib/features/risk/domain/risk_models.dart

```dart
import 'package:equatable/equatable.dart';

/// Read-only risk view models.
///
/// The mobile client is a **viewer** for the risk layer, and this file is
/// written so that staying that way is easy: every model is a plain value
/// object parsed from the API's risk views, and there is no command-shaped
/// model here that could be serialised back to the API as an attempt to
/// engage, clear or reconfigure anything. Controls over switches live in
/// the admin console, behind the permissions this client is not granted;
/// the API enforces that boundary independently of anything on a phone.
///
/// Money and versions stay as [String]s exactly as the server emits them
/// (the API's BigInt-as-string discipline). Parsing them into `double` to
/// render is how a UI starts disagreeing with the ledger.
///
/// A snapshot mirror that has not been captured for an account renders as
/// an explicit absence - never as zeros.

String _requiredString(Object? value, {String fallback = ''}) {
  return value is String && value.isNotEmpty ? value : fallback;
}

int _intOrZero(Object? value) {
  if (value is int) {
    return value;
  }
  if (value is num) {
    return value.toInt();
  }
  if (value is String) {
    return int.tryParse(value) ?? 0;
  }
  return 0;
}

bool _boolOrFalse(Object? value) => value is bool && value;

DateTime? _dateTime(Object? value) {
  if (value is String && value.isNotEmpty) {
    return DateTime.tryParse(value)?.toLocal();
  }
  return null;
}

List<String> _stringList(Object? value) {
  if (value is List) {
    return value.whereType<String>().toList(growable: false);
  }
  return const <String>[];
}

Map<String, Object?> _asMap(Object? value) {
  if (value is Map) {
    return value.map<String, Object?>(
      (Object? key, Object? item) => MapEntry<String, Object?>(key.toString(), item),
    );
  }
  return const <String, Object?>{};
}

/// The deployment's posture, as mirrored by the API (NOT a live venue read).
///
/// `refreshOutpacesStaleness` is the field a careful reader stops on: when
/// it is false the deployment's refresh cadence cannot keep mirrors inside
/// the staleness budget, and the engine will deny on freshness - a config
/// fault, stated plainly, not a trading signal.
class RiskMirrorStatus extends Equatable {
  const RiskMirrorStatus({
    required this.engineEnabled,
    required this.failClosed,
    required this.maxRiskStateAgeMs,
    required this.snapshotRefreshMs,
    required this.refreshOutpacesStaleness,
    required this.engagedSwitchCount,
    required this.triggeredProtectionCount,
    required this.staleAccountIds,
    required this.mirrors,
    required this.criticalEvents24h,
    required this.note,
  });

  factory RiskMirrorStatus.fromJson(Map<String, Object?> json) {
    final List<Map<String, Object?>> mirrors =
        (json['latestSnapshotPerAccount'] is List)
            ? (json['latestSnapshotPerAccount'] as List)
                .whereType<Map<Object?, Object?>>()
                .map(_asMap)
                .toList(growable: false)
            : const <Map<String, Object?>>[];
    final Map<String, Object?> severity = _asMap(json['eventsLast24hBySeverity']);
    final Set<String> staleIds = _stringList(json['staleAccounts']).toSet();

    return RiskMirrorStatus(
      engineEnabled: _boolOrFalse(json['engineEnabled']),
      failClosed: _boolOrFalse(json['failClosed']),
      maxRiskStateAgeMs: _intOrZero(json['maxRiskStateAgeMs']),
      snapshotRefreshMs: _intOrZero(json['snapshotRefreshMs']),
      refreshOutpacesStaleness: _boolOrFalse(json['refreshOutpacesStaleness']),
      engagedSwitchCount: _intOrZero(json['engagedSwitchCount']),
      triggeredProtectionCount: _intOrZero(json['triggeredProtectionCount']),
      staleAccountIds: _stringList(json['staleAccounts']),
      mirrors: mirrors
          .map((Map<String, Object?> row) =>
              RiskAccountMirror.fromJson(row, staleIds: staleIds))
          .toList(growable: false),
      criticalEvents24h:
          _intOrZero(severity['CRITICAL']) + _intOrZero(severity['HIGH']),
      note: _requiredString(json['note']),
    );
  }

  final bool engineEnabled;
  final bool failClosed;
  final int maxRiskStateAgeMs;
  final int snapshotRefreshMs;
  final bool refreshOutpacesStaleness;
  final int engagedSwitchCount;
  final int triggeredProtectionCount;
  final List<String> staleAccountIds;
  final List<RiskAccountMirror> mirrors;
  final int criticalEvents24h;
  final String note;

  int get staleMirrorCount => staleAccountIds.length;

  @override
  List<Object?> get props => <Object?>[
        engineEnabled,
        failClosed,
        maxRiskStateAgeMs,
        snapshotRefreshMs,
        refreshOutpacesStaleness,
        engagedSwitchCount,
        triggeredProtectionCount,
        staleAccountIds,
        mirrors,
        criticalEvents24h,
        note,
      ];
}

/// One account's newest synced snapshot metadata.
class RiskAccountMirror extends Equatable {
  const RiskAccountMirror({
    required this.accountId,
    required this.snapshotVersion,
    required this.capturedAt,
    required this.stale,
    required this.equity,
    required this.grossNotional,
    required this.netDailyPnl,
    required this.openOrderCount,
    required this.isSimulated,
    required this.staleSources,
  });

  factory RiskAccountMirror.fromJson(
    Map<String, Object?> json, {
    Set<String> staleIds = const <String>{},
  }) {
    final DateTime? capturedAt = _dateTime(json['capturedAt']);
    return RiskAccountMirror(
      accountId: _requiredString(json['accountId'], fallback: '?'),
      snapshotVersion: _requiredString(json['snapshotVersion'], fallback: '?'),
      capturedAt: capturedAt,
      // Stale when the status feed names this account OR when the captured
      // instant is missing: an untimeable mirror cannot claim freshness.
      stale: staleIds.contains(_requiredString(json['accountId'])) ||
          capturedAt == null,
      equity: _optionalString(json['equity']),
      grossNotional: _optionalString(json['accountGrossNotional']),
      netDailyPnl: _optionalString(json['netDailyPnl']),
      openOrderCount: json['openOrderCount'] == null
          ? null
          : _intOrZero(json['openOrderCount']),
      isSimulated: _boolOrFalse(json['isSimulated']),
      staleSources: _stringList(json['staleSources']),
    );
  }

  final String accountId;
  final String snapshotVersion;
  final DateTime? capturedAt;
  final bool stale;
  final String? equity;
  final String? grossNotional;
  final String? netDailyPnl;
  final int? openOrderCount;
  final bool isSimulated;
  final List<String> staleSources;

  @override
  List<Object?> get props => <Object?>[
        accountId,
        snapshotVersion,
        capturedAt,
        stale,
        equity,
        grossNotional,
        netDailyPnl,
        openOrderCount,
        isSimulated,
        staleSources,
      ];
}

/// A kill switch visible to the caller's organisation, with lifecycle.
class RiskSwitchInfo extends Equatable {
  const RiskSwitchInfo({
    required this.id,
    required this.scope,
    required this.target,
    required this.isEngaged,
    required this.status,
    required this.requiresExplicitClear,
    required this.triggeredByRule,
    required this.reason,
    required this.engagedAt,
  });

  factory RiskSwitchInfo.fromJson(Map<String, Object?> json) {
    return RiskSwitchInfo(
      id: _requiredString(json['id'], fallback: '?'),
      scope: _requiredString(json['scope'], fallback: '?'),
      target: _optionalString(json['target']),
      isEngaged: _boolOrFalse(json['isEngaged']),
      status: _requiredString(json['status'], fallback: 'UNKNOWN'),
      requiresExplicitClear: _boolOrFalse(json['requiresExplicitClear']),
      triggeredByRule: _optionalString(json['triggeredByRule']),
      reason: _optionalString(json['reason']),
      engagedAt: _dateTime(json['engagedAt']),
    );
  }

  final String id;
  final String scope;
  final String? target;
  final bool isEngaged;
  final String status;
  final bool requiresExplicitClear;
  final String? triggeredByRule;
  final String? reason;
  final DateTime? engagedAt;

  /// A protection the ENGINE pulled, as opposed to a manual halt.
  bool get isTriggeredProtection =>
      isEngaged && (status == 'TRIGGERED' || status == 'ACKNOWLEDGED');

  @override
  List<Object?> get props => <Object?>[
        id,
        scope,
        target,
        isEngaged,
        status,
        requiresExplicitClear,
        triggeredByRule,
        reason,
        engagedAt,
      ];
}

/// One recorded risk decision / protection event.
class RiskEventInfo extends Equatable {
  const RiskEventInfo({
    required this.id,
    required this.createdAt,
    required this.eventType,
    required this.severity,
    required this.message,
    required this.ruleId,
    required this.scope,
    required this.isSimulated,
  });

  factory RiskEventInfo.fromJson(Map<String, Object?> json) {
    return RiskEventInfo(
      id: _requiredString(json['id'], fallback: '?'),
      createdAt: _dateTime(json['createdAt']),
      eventType: _requiredString(json['eventType'], fallback: 'EVENT'),
      severity: _requiredString(json['severity'], fallback: 'INFO'),
      message: _requiredString(json['message']),
      ruleId: _optionalString(json['ruleId']),
      scope: _optionalString(json['scope']),
      isSimulated: _boolOrFalse(json['isSimulated']),
    );
  }

  final String id;
  final DateTime? createdAt;
  final String eventType;
  final String severity;
  final String message;
  final String? ruleId;
  final String? scope;
  final bool isSimulated;

  bool get isSevere => severity == 'CRITICAL' || severity == 'HIGH';

  @override
  List<Object?> get props => <Object?>[
        id,
        createdAt,
        eventType,
        severity,
        message,
        ruleId,
        scope,
        isSimulated,
      ];
}

String? _optionalString(Object? value) {
  if (value is String && value.isNotEmpty) {
    return value;
  }
  return null;
}
```

FILE: apps/mobile/lib/features/risk/presentation/risk_controller.dart

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/error/app_exception.dart';
import '../../../core/logging/app_logger.dart';
import '../data/risk_repository.dart';
import '../domain/risk_models.dart';
import 'risk_state.dart';

/// Drives the read-only risk screen.
///
/// Like the strategy controller, this class exposes exactly two operations -
/// [load] and [refresh] - and no mutation, deliberately: "acknowledge" and
/// "clear" are API routes behind permissions this client is not granted, and
/// a phone must never become the place where a triggered protection is
/// disarmed between notifications. If this controller ever grows a third
/// public method, stop and re-read the Part 8 brief.
class RiskController extends StateNotifier<RiskViewState> {
  RiskController({required RiskRepository repository, required AppLogger logger})
      : _repository = repository,
        _logger = logger,
        super(const RiskViewState.initial());

  final RiskRepository _repository;
  final AppLogger _logger;

  Future<void> load() => _fetch(isRefresh: false);

  Future<void> refresh() => _fetch(isRefresh: true);

  Future<void> _fetch({required bool isRefresh}) async {
    if (state.isRefreshing) {
      return;
    }

    state = state.copyWith(
      status: isRefresh ? state.status : RiskViewStatus.loading,
      isRefreshing: true,
      clearError: true,
    );

    final List<String> degraded = <String>[];
    AppException? lastFailure;

    Future<T?> attempt<T>(String panel, Future<T> Function() operation) async {
      try {
        return await operation();
      } on AppException catch (error) {
        degraded.add(panel);
        lastFailure = error;
        // Panel name and error code only. Never the payload: it can carry
        // organisation-identifying detail into device logs.
        _logger.warning(
          'risk.panel_failed',
          context: <String, Object?>{'panel': panel, 'code': error.code.name},
        );
        return null;
      }
    }

    final List<Object?> results = await Future.wait<Object?>(<Future<Object?>>[
      attempt<RiskMirrorStatus>('status', _repository.fetchStatus),
      attempt<List<RiskSwitchInfo>>('switches', _repository.fetchSwitches),
      attempt<List<RiskEventInfo>>('events', _repository.fetchEvents),
    ]);

    final RiskMirrorStatus? mirror = results[0] as RiskMirrorStatus?;
    final List<RiskSwitchInfo>? switches = results[1] as List<RiskSwitchInfo>?;
    final List<RiskEventInfo>? events = results[2] as List<RiskEventInfo>?;

    final bool everythingFailed = degraded.length == results.length;

    if (everythingFailed) {
      state = state.copyWith(
        status: RiskViewStatus.failed,
        isRefreshing: false,
        error: lastFailure,
        degradedPanels: const <String>[],
      );
      return;
    }

    state = RiskViewState(
      status: RiskViewStatus.ready,
      // A panel that failed keeps its previous content rather than blanking.
      mirror: mirror ?? state.mirror,
      switches: switches ?? state.switches,
      events: events ?? state.events,
      isRefreshing: false,
      degradedPanels: List<String>.unmodifiable(degraded),
    );
  }
}
```

FILE: apps/mobile/lib/features/risk/presentation/risk_screen.dart

```dart
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/providers.dart';
import '../../../l10n/app_localizations.dart';
import '../domain/risk_models.dart';
import 'risk_state.dart';

/// Read-only risk viewer.
///
/// This screen answers two questions and stops: is anything halted, and is
/// the engine looking at fresh state. There is no button here that engages
/// or clears a switch - clearing especially not, because a triggered
/// protection is exactly the thing that must NOT be dismissible from a
/// device one careless thumb from a "looks fine". The admin console carries
/// those actions behind reasons and typed confirmations; the API enforces
/// the same permissions whether or not any UI exists.
///
/// Every figure is mirrored state with a capture time, and the copy says
/// so: a phone showing a number without its age is how "equity" gets read
/// as a live quote.
class RiskScreen extends ConsumerStatefulWidget {
  const RiskScreen({super.key});

  @override
  ConsumerState<RiskScreen> createState() => _RiskScreenState();
}

class _RiskScreenState extends ConsumerState<RiskScreen> {
  @override
  void initState() {
    super.initState();
    // Deferred to after the first frame: the controller mutates provider
    // state and must not do so during the build that created it.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      unawaited(ref.read(riskControllerProvider.notifier).load());
    });
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final RiskViewState state = ref.watch(riskControllerProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.riskTitle)),
      body: RefreshIndicator(
        onRefresh: () => ref.read(riskControllerProvider.notifier).refresh(),
        child: _body(context, l10n, state),
      ),
    );
  }

  Widget _body(BuildContext context, AppLocalizations l10n, RiskViewState state) {
    if (state.status == RiskViewStatus.loading && !state.hasAnyData) {
      return const Center(child: CircularProgressIndicator());
    }

    if (state.status == RiskViewStatus.failed && !state.hasAnyData) {
      return _FailureView(
        message: state.error?.message ?? l10n.genericError,
        retryLabel: l10n.retry,
        onRetry: () => ref.read(riskControllerProvider.notifier).load(),
      );
    }

    return ListView(
      padding: const EdgeInsets.all(16),
      physics: const AlwaysScrollableScrollPhysics(),
      children: <Widget>[
        if (state.isDegraded) _DegradedBanner(message: l10n.riskPanelsDegraded),
        if (state.mirror != null) _PostureCard(status: state.mirror!, l10n: l10n),
        const SizedBox(height: 12),
        if (state.mirror != null) _CountersCard(status: state.mirror!, l10n: l10n),
        const SizedBox(height: 12),
        _SectionHeading(title: l10n.riskMirrorSection),
        if (state.mirror == null || state.mirror!.mirrors.isEmpty)
          _EmptyCard(message: l10n.riskNoMirror)
        else
          for (final RiskAccountMirror mirror in state.mirror!.mirrors)
            _MirrorCard(mirror: mirror, l10n: l10n),
        const SizedBox(height: 12),
        _SectionHeading(title: l10n.riskSwitchesSection),
        if (state.engagedSwitches.isEmpty)
          _EmptyCard(message: l10n.riskNoSwitches)
        else
          for (final RiskSwitchInfo row in state.engagedSwitches)
            _SwitchCard(switchInfo: row, l10n: l10n),
        const SizedBox(height: 12),
        _SectionHeading(title: l10n.riskEventsSection),
        if (state.events.isEmpty)
          _EmptyCard(message: l10n.riskNoEvents)
        else
          for (final RiskEventInfo event in state.events)
            _EventCard(event: event, l10n: l10n),
        const SizedBox(height: 16),
        _DisclaimerCard(l10n: l10n),
        const SizedBox(height: 24),
      ],
    );
  }
}

/// Engine posture, stated before any number on the page.
class _PostureCard extends StatelessWidget {
  const _PostureCard({required this.status, required this.l10n});

  final RiskMirrorStatus status;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Icon(
                  status.engineEnabled ? Icons.shield_outlined : Icons.gps_off_outlined,
                  color: status.engineEnabled ? colors.primary : colors.error,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    status.engineEnabled
                        ? l10n.riskEngineOn
                        : l10n.riskEngineOff,
                    style: Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: <Widget>[
                _StatusChip(label: l10n.riskFailClosedLabel, on: status.failClosed),
                _StatusChip(
                  label: '${l10n.riskCadenceLabel}: ${status.snapshotRefreshMs}ms / '
                      '${status.maxRiskStateAgeMs}ms',
                  on: status.refreshOutpacesStaleness,
                ),
              ],
            ),
            if (!status.refreshOutpacesStaleness) ...<Widget>[
              const SizedBox(height: 12),
              Text(
                l10n.riskCadenceWarn,
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: colors.error),
              ),
            ],
            if (status.note.isNotEmpty) ...<Widget>[
              const SizedBox(height: 8),
              Text(
                status.note,
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: colors.onSurfaceVariant),
              ),
            ],
            const SizedBox(height: 8),
            Text(
              l10n.riskReadOnlyNotice,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: colors.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}

class _CountersCard extends StatelessWidget {
  const _CountersCard({required this.status, required this.l10n});

  final RiskMirrorStatus status;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Wrap(
          spacing: 24,
          runSpacing: 16,
          children: <Widget>[
            _Counter(
              label: l10n.riskEngagedStopsLabel,
              value: '${status.engagedSwitchCount}',
              emphasise: status.engagedSwitchCount > 0,
            ),
            _Counter(
              label: l10n.riskTriggeredProtectionsLabel,
              value: '${status.triggeredProtectionCount}',
              emphasise: status.triggeredProtectionCount > 0,
            ),
            _Counter(
              label: l10n.riskStaleMirrorsLabel,
              value: '${status.staleMirrorCount}',
              emphasise: status.staleMirrorCount > 0,
            ),
            _Counter(
              label: l10n.riskSevereEventsLabel,
              value: '${status.criticalEvents24h}',
              emphasise: status.criticalEvents24h > 0,
            ),
          ],
        ),
      ),
    );
  }
}

class _MirrorCard extends StatelessWidget {
  const _MirrorCard({required this.mirror, required this.l10n});

  final RiskAccountMirror mirror;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    mirror.accountId,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
                if (mirror.stale) _AccentBadge(label: l10n.riskStaleBadge),
                if (mirror.isSimulated)
                  _AccentBadge(label: l10n.simulatedBadge, danger: false),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              '${l10n.riskSnapshotLabel}: v${mirror.snapshotVersion} · '
              '${l10n.riskCapturedLabel}: '
              '${mirror.capturedAt == null ? '—' : _formatTimestamp(mirror.capturedAt!)}',
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: colors.onSurfaceVariant),
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 20,
              runSpacing: 10,
              children: <Widget>[
                _Counter(
                  label: l10n.riskEquityLabel,
                  value: mirror.equity ?? l10n.notAvailableShort,
                ),
                _Counter(
                  label: l10n.riskDayPnlLabel,
                  value: mirror.netDailyPnl ?? l10n.notAvailableShort,
                  emphasise: _isNegative(mirror.netDailyPnl),
                ),
                _Counter(
                  label: l10n.riskGrossLabel,
                  value: mirror.grossNotional ?? l10n.notAvailableShort,
                ),
                _Counter(
                  label: l10n.riskOpenOrdersLabel,
                  value: mirror.openOrderCount == null
                      ? l10n.notAvailableShort
                      : '${mirror.openOrderCount}',
                ),
              ],
            ),
            if (mirror.staleSources.isNotEmpty) ...<Widget>[
              const SizedBox(height: 8),
              Text(
                '${l10n.riskStaleSourcesLabel}: ${mirror.staleSources.join(', ')}',
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: colors.error),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _SwitchCard extends StatelessWidget {
  const _SwitchCard({required this.switchInfo, required this.l10n});

  final RiskSwitchInfo switchInfo;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;
    final bool triggered = switchInfo.isTriggeredProtection;

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Icon(
                  triggered ? Icons.gpp_bad_outlined : Icons.stop_circle_outlined,
                  color: triggered ? colors.error : colors.primary,
                  size: 20,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    '${switchInfo.scope}'
                    '${switchInfo.target == null ? '' : ': ${switchInfo.target}'}',
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
                _AccentBadge(label: switchInfo.status, danger: triggered),
              ],
            ),
            const SizedBox(height: 6),
            if (switchInfo.reason != null)
              Text(
                '${l10n.riskReasonLabel}: ${switchInfo.reason}',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            const SizedBox(height: 4),
            Text(
              switchInfo.triggeredByRule == null
                  ? '${l10n.riskEngagedManualLabel} · '
                      '${switchInfo.engagedAt == null ? '—' : _formatTimestamp(switchInfo.engagedAt!)}'
                  : '${switchInfo.triggeredByRule} · '
                      '${switchInfo.engagedAt == null ? '—' : _formatTimestamp(switchInfo.engagedAt!)}',
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: colors.onSurfaceVariant),
            ),
            if (triggered && switchInfo.requiresExplicitClear) ...<Widget>[
              const SizedBox(height: 8),
              Text(
                l10n.riskExplicitClearNotice,
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: colors.error),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _EventCard extends StatelessWidget {
  const _EventCard({required this.event, required this.l10n});

  final RiskEventInfo event;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    _titleCase(event.eventType),
                    style: Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.w600),
                  ),
                ),
                if (event.isSevere) _AccentBadge(label: event.severity),
                if (event.isSimulated)
                  _AccentBadge(label: l10n.simulatedBadge, danger: false),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              '${event.createdAt == null ? '—' : _formatTimestamp(event.createdAt!)}'
              '${event.ruleId == null ? '' : ' · ${event.ruleId}'}'
              '${event.scope == null ? '' : ' · ${event.scope}'}',
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: colors.onSurfaceVariant),
            ),
            const SizedBox(height: 6),
            Text(
              event.message.length > 180
                  ? '${event.message.substring(0, 180)}…'
                  : event.message,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ],
        ),
      ),
    );
  }
}

class _DisclaimerCard extends StatelessWidget {
  const _DisclaimerCard({required this.l10n});

  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(Icons.info_outline, color: colors.onSurfaceVariant, size: 20),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                l10n.riskDisclaimer,
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: colors.onSurfaceVariant),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.label, required this.on});

  final String label;
  final bool on;

  @override
  Widget build(BuildContext context) {
    return Chip(
      avatar: Icon(
        on ? Icons.check_circle_outline : Icons.remove_circle_outline,
        size: 18,
      ),
      label: Text(label),
    );
  }
}

class _Counter extends StatelessWidget {
  const _Counter({required this.label, required this.value, this.emphasise = false});

  final String label;
  final String value;
  final bool emphasise;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Text(
          label,
          style: Theme.of(context)
              .textTheme
              .labelSmall
              ?.copyWith(color: colors.onSurfaceVariant),
        ),
        const SizedBox(height: 2),
        Text(
          value,
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w700,
                color: emphasise ? colors.error : null,
              ),
        ),
      ],
    );
  }
}

/// Version-safe accent badge: theme container colors only, no alpha math
/// (the project floor is Flutter 3.22, where `Color.withValues` does not
/// exist; `withOpacity` is deprecated at the ceiling - containers sidestep
/// both).
class _AccentBadge extends StatelessWidget {
  const _AccentBadge({required this.label, this.danger = true});

  final String label;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;
    final Color background = danger ? colors.errorContainer : colors.tertiaryContainer;
    final Color foreground = danger ? colors.onErrorContainer : colors.onTertiaryContainer;

    return Container(
      margin: const EdgeInsets.only(left: 6),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: Theme.of(context)
            .textTheme
            .labelSmall
            ?.copyWith(color: foreground, fontWeight: FontWeight.w700),
      ),
    );
  }
}

class _SectionHeading extends StatelessWidget {
  const _SectionHeading({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 8, bottom: 8),
      child: Text(
        title,
        style:
            Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
      ),
    );
  }
}

class _EmptyCard extends StatelessWidget {
  const _EmptyCard({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Text(
          message,
          style: Theme.of(context)
              .textTheme
              .bodyMedium
              ?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
        ),
      ),
    );
  }
}

class _DegradedBanner extends StatelessWidget {
  const _DegradedBanner({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: colors.tertiaryContainer,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: <Widget>[
          Icon(Icons.info_outline, color: colors.onTertiaryContainer, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: colors.onTertiaryContainer),
            ),
          ),
        ],
      ),
    );
  }
}

class _FailureView extends StatelessWidget {
  const _FailureView({
    required this.message,
    required this.retryLabel,
    required this.onRetry,
  });

  final String message;
  final String retryLabel;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(24),
      children: <Widget>[
        const SizedBox(height: 80),
        Icon(
          Icons.cloud_off_outlined,
          size: 40,
          color: Theme.of(context).colorScheme.onSurfaceVariant,
        ),
        const SizedBox(height: 16),
        Text(message, textAlign: TextAlign.center),
        const SizedBox(height: 16),
        Center(
          child: FilledButton(onPressed: onRetry, child: Text(retryLabel)),
        ),
      ],
    );
  }
}

/// `BTC_USDT_EXPOSURE`-style enums read better on a phone without the
/// shout; nothing smarter than this, because the payload is the same one
/// the console shows and re-casing it here would drift from it.
String _titleCase(String value) {
  return value
      .toLowerCase()
      .split('_')
      .map((String word) =>
          word.isEmpty ? word : word[0].toUpperCase() + word.substring(1))
      .join(' ');
}

bool _isNegative(String? decimal) {
  return decimal != null && decimal.startsWith('-');
}

/// Local, dependency-free timestamp rendering (same rule as the strategies
/// screen: wall-clock time, never "2 hours ago", so incident reading is
/// unambiguous).
String _formatTimestamp(DateTime value) {
  String two(int input) => input.toString().padLeft(2, '0');
  return '${value.year}-${two(value.month)}-${two(value.day)} '
      '${two(value.hour)}:${two(value.minute)}';
}
```

FILE: apps/mobile/lib/features/risk/presentation/risk_state.dart

```dart
import 'package:equatable/equatable.dart';

import '../../../core/error/app_exception.dart';
import '../domain/risk_models.dart';

/// Loading state of the risk viewer.
enum RiskViewStatus { initial, loading, ready, failed }

/// Immutable state for the read-only risk screen.
///
/// The three panels load in parallel and a partial failure keeps whatever
/// did load: the moment someone opens this screen is a moment something is
/// already wrong somewhere, and blanking the parts that answered would
/// hide that. Only a total failure surfaces as a page-level error.
class RiskViewState extends Equatable {
  const RiskViewState({
    required this.status,
    this.mirror,
    this.switches = const <RiskSwitchInfo>[],
    this.events = const <RiskEventInfo>[],
    this.error,
    this.isRefreshing = false,
    this.degradedPanels = const <String>[],
  });

  const RiskViewState.initial() : this(status: RiskViewStatus.initial);

  final RiskViewStatus status;
  final RiskMirrorStatus? mirror;
  final List<RiskSwitchInfo> switches;
  final List<RiskEventInfo> events;

  /// Set only when nothing at all could be loaded.
  final AppException? error;

  final bool isRefreshing;

  /// Human-readable names of panels that failed while others succeeded.
  final List<String> degradedPanels;

  bool get hasAnyData =>
      mirror != null || switches.isNotEmpty || events.isNotEmpty;

  bool get isDegraded => degradedPanels.isNotEmpty;

  /// Only engaged switches matter on a phone: an idle row is for the
  /// console's history tables, and scrolling past it adds noise here.
  List<RiskSwitchInfo> get engagedSwitches => switches
      .where((RiskSwitchInfo row) => row.isEngaged)
      .toList(growable: false);

  List<RiskSwitchInfo> get triggeredSwitches => switches
      .where((RiskSwitchInfo row) => row.isTriggeredProtection)
      .toList(growable: false);

  List<RiskEventInfo> get severeEvents => events
      .where((RiskEventInfo event) => event.isSevere)
      .toList(growable: false);

  RiskViewState copyWith({
    RiskViewStatus? status,
    RiskMirrorStatus? mirror,
    List<RiskSwitchInfo>? switches,
    List<RiskEventInfo>? events,
    AppException? error,
    bool? isRefreshing,
    List<String>? degradedPanels,
    bool clearError = false,
  }) {
    return RiskViewState(
      status: status ?? this.status,
      mirror: mirror ?? this.mirror,
      switches: switches ?? this.switches,
      events: events ?? this.events,
      error: clearError ? null : (error ?? this.error),
      isRefreshing: isRefreshing ?? this.isRefreshing,
      degradedPanels: degradedPanels ?? this.degradedPanels,
    );
  }

  @override
  List<Object?> get props => <Object?>[
        status,
        mirror,
        switches,
        events,
        error,
        isRefreshing,
        degradedPanels,
      ];
}
```

FILE: apps/mobile/lib/features/settings/security_screen.dart

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/di/providers.dart';
import '../../l10n/app_localizations.dart';
import '../auth/domain/auth_models.dart';
import '../auth/presentation/auth_state.dart';

/// Security overview.
///
/// Read-only in Part 1: it reports the account's security posture and the
/// device-management surface the API already exposes. Enrolment and session
/// revocation UI arrive with the security work in Part 2.
class SecurityScreen extends ConsumerWidget {
  const SecurityScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AuthState state = ref.watch(authControllerProvider);
    final AuthUser? user = state.user;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.securityTitle)),
      body: ListView(
        children: <Widget>[
          ListTile(
            leading: Icon(
              user?.twoFactorEnabled ?? false ? Icons.verified_user : Icons.gpp_maybe,
            ),
            title: Text(
              (user?.twoFactorEnabled ?? false)
                  ? l10n.twoFactorEnabled
                  : l10n.twoFactorDisabled,
            ),
          ),
          ListTile(
            leading: const Icon(Icons.devices_outlined),
            title: Text(l10n.activeSessions),
            subtitle: const Text('GET /v1/auth/sessions'),
          ),
          ListTile(
            leading: const Icon(Icons.password_outlined),
            title: Text(l10n.changePassword),
            subtitle: const Text('POST /v1/auth/change-password'),
          ),
        ],
      ),
    );
  }
}
```

FILE: apps/mobile/lib/features/settings/settings_screen.dart

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/di/providers.dart';
import '../../core/router/route_paths.dart';
import '../../l10n/app_localizations.dart';
import '../auth/domain/auth_models.dart';
import '../auth/presentation/auth_state.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AuthState state = ref.watch(authControllerProvider);
    final AuthUser? user = state.user;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.settingsTitle)),
      body: ListView(
        children: <Widget>[
          if (user != null)
            ListTile(
              title: Text(l10n.accountSection),
              subtitle: Text(user.email),
              leading: const Icon(Icons.person_outline),
            ),
          ListTile(
            title: Text(l10n.securitySection),
            leading: const Icon(Icons.shield_outlined),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push(RoutePaths.security),
          ),
          const Divider(),
          ListTile(
            title: Text(l10n.signOut),
            leading: Icon(Icons.logout, color: Theme.of(context).colorScheme.error),
            onTap: state.isSubmitting
                ? null
                : () => ref.read(authControllerProvider.notifier).signOut(),
          ),
        ],
      ),
    );
  }
}
```

FILE: apps/mobile/lib/features/splash/splash_screen.dart

```dart
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/di/providers.dart';
import '../../core/theme/branding_controller.dart';

/// Startup screen.
///
/// Two things happen here and nowhere else: tenant branding is fetched so the
/// sign-in screen is already themed, and the stored session is validated. The
/// router redirects away as soon as the auth state settles.
class SplashScreen extends ConsumerStatefulWidget {
  const SplashScreen({super.key});

  @override
  ConsumerState<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends ConsumerState<SplashScreen> {
  @override
  void initState() {
    super.initState();

    // Deferred to the first frame: providers must not be mutated during build.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      unawaited(_bootstrap());
    });
  }

  Future<void> _bootstrap() async {
    // Branding first so the sign-in screen never flashes the default palette.
    await ref.read(brandingProvider.notifier).load();

    if (!mounted) {
      return;
    }

    await ref.read(authControllerProvider.notifier).restore();
  }

  @override
  Widget build(BuildContext context) {
    final String appName = ref.watch(brandingProvider).appName;

    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Text(
              appName,
              style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
            ),
            const SizedBox(height: 24),
            const SizedBox(
              width: 28,
              height: 28,
              child: CircularProgressIndicator(strokeWidth: 3),
            ),
          ],
        ),
      ),
    );
  }
}
```

FILE: apps/mobile/lib/features/strategies/data/strategy_repository.dart

```dart
import '../../../core/logging/app_logger.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_endpoints.dart';
import '../domain/strategy_models.dart';

/// Read-only access to the strategy layer.
///
/// This repository exposes GET requests and nothing else. There is no method
/// here to enable an instance, start a session, submit a backtest or change a
/// parameter, and that is deliberate: those operations require a written
/// reason, a permission the mobile client is not granted, and - for anything
/// touching live mode - a typed confirmation phrase. A phone in a pocket is
/// the wrong place for a control that arms a trading strategy.
///
/// The API enforces the same boundary independently. Even if a build of this
/// app tried to POST, the caller's role would have to carry
/// `strategy_instance:enable`, which the mobile role does not.
class StrategyRepository {
  StrategyRepository({
    required ApiClient apiClient,
    required AppLogger logger,
  })  : _apiClient = apiClient,
        _logger = logger;

  final ApiClient _apiClient;
  final AppLogger _logger;

  /// Platform counters plus the configuration flags that decide what the
  /// strategy layer is allowed to reach.
  Future<StrategyOverview> fetchOverview() async {
    final StrategyOverview overview = await _apiClient.get<StrategyOverview>(
      ApiEndpoints.strategyMetrics,
      parser: (Object? data) => StrategyOverview.fromJson(_asMap(data)),
    );

    _logger.debug('strategy.overview_loaded');
    return overview;
  }

  Future<List<StrategyInstanceSummary>> fetchInstances({int limit = 25}) async {
    return _apiClient.get<List<StrategyInstanceSummary>>(
      ApiEndpoints.strategyInstances,
      queryParameters: <String, Object?>{'page': 1, 'limit': limit},
      parser: (Object? data) => _items(data)
          .map(StrategyInstanceSummary.fromJson)
          .toList(growable: false),
    );
  }

  Future<List<PaperSessionSummary>> fetchPaperSessions({int limit = 10}) async {
    return _apiClient.get<List<PaperSessionSummary>>(
      ApiEndpoints.paperSessions,
      queryParameters: <String, Object?>{'page': 1, 'limit': limit},
      parser: (Object? data) =>
          _items(data).map(PaperSessionSummary.fromJson).toList(growable: false),
    );
  }

  Future<List<BacktestSummary>> fetchBacktests({int limit = 10}) async {
    return _apiClient.get<List<BacktestSummary>>(
      ApiEndpoints.backtests,
      queryParameters: <String, Object?>{'page': 1, 'limit': limit},
      parser: (Object? data) =>
          _items(data).map(BacktestSummary.fromJson).toList(growable: false),
    );
  }

  /// Extracts `items` from the API's paginated envelope.
  ///
  /// A malformed page yields an empty list rather than throwing: a viewer
  /// screen showing "nothing to display" is better than one that crashes.
  static List<Map<String, Object?>> _items(Object? data) {
    final Map<String, Object?> map = _asMap(data);
    final Object? items = map['items'];

    if (items is! List) {
      return const <Map<String, Object?>>[];
    }

    return items
        .whereType<Map<Object?, Object?>>()
        .map(_asMap)
        .toList(growable: false);
  }

  static Map<String, Object?> _asMap(Object? value) {
    if (value is Map) {
      return value.map<String, Object?>(
        (Object? key, Object? item) => MapEntry<String, Object?>(key.toString(), item),
      );
    }
    return const <String, Object?>{};
  }
}
```

FILE: apps/mobile/lib/features/strategies/domain/strategy_models.dart

```dart
import 'package:equatable/equatable.dart';

/// Read-only strategy view models.
///
/// The mobile client is a **viewer** for the strategy layer. It can see what
/// instances exist, whether they are healthy, and what the simulator produced.
/// It cannot create, enable, disable or configure anything, and there is no
/// model here that could be serialised back to the API as a command.
///
/// Every number that arrives as a Decimal on the server is kept as a [String].
/// Parsing money into a `double` to render it is how a UI starts disagreeing
/// with the ledger; formatting is a display concern and happens in the widget.
///
/// A metric the server withheld for insufficient observations arrives as
/// `null`. `null` is rendered as "insufficient data", never as `0`.

/// Lifecycle state of an instance, as reported by the API.
enum StrategyInstanceStatus {
  idle,
  starting,
  running,
  paused,
  stopped,
  errored,
  unknown;

  static StrategyInstanceStatus fromApi(String? value) {
    switch (value) {
      case 'IDLE':
        return StrategyInstanceStatus.idle;
      case 'STARTING':
        return StrategyInstanceStatus.starting;
      case 'RUNNING':
        return StrategyInstanceStatus.running;
      case 'PAUSED':
        return StrategyInstanceStatus.paused;
      case 'STOPPED':
        return StrategyInstanceStatus.stopped;
      case 'ERROR':
      case 'ERRORED':
        return StrategyInstanceStatus.errored;
      default:
        return StrategyInstanceStatus.unknown;
    }
  }
}

/// Operational health, reported separately from [StrategyInstanceStatus].
///
/// An instance can be enabled and unhealthy at the same time; collapsing the
/// two into one badge hides exactly the case an operator needs to see.
enum StrategyHealth {
  unknown,
  healthy,
  degraded,
  unhealthy,
  quarantined;

  static StrategyHealth fromApi(String? value) {
    switch (value) {
      case 'HEALTHY':
        return StrategyHealth.healthy;
      case 'DEGRADED':
        return StrategyHealth.degraded;
      case 'UNHEALTHY':
        return StrategyHealth.unhealthy;
      case 'QUARANTINED':
        return StrategyHealth.quarantined;
      default:
        return StrategyHealth.unknown;
    }
  }

  bool get needsAttention =>
      this == StrategyHealth.degraded ||
      this == StrategyHealth.unhealthy ||
      this == StrategyHealth.quarantined;
}

/// Status of a simulated run (backtest or paper session).
enum SimulationStatus {
  queued,
  running,
  completed,
  stopped,
  failed,
  cancelled,
  unknown;

  static SimulationStatus fromApi(String? value) {
    switch (value) {
      case 'QUEUED':
        return SimulationStatus.queued;
      case 'STARTING':
      case 'RUNNING':
        return SimulationStatus.running;
      case 'COMPLETED':
        return SimulationStatus.completed;
      case 'STOPPED':
        return SimulationStatus.stopped;
      case 'FAILED':
        return SimulationStatus.failed;
      case 'CANCELLED':
        return SimulationStatus.cancelled;
      default:
        return SimulationStatus.unknown;
    }
  }
}

String? _optionalString(Object? value) {
  if (value is String && value.isNotEmpty) {
    return value;
  }
  return null;
}

String _requiredString(Object? value, {String fallback = ''}) {
  return value is String && value.isNotEmpty ? value : fallback;
}

int _intOrZero(Object? value) {
  if (value is int) {
    return value;
  }
  if (value is num) {
    return value.toInt();
  }
  if (value is String) {
    return int.tryParse(value) ?? 0;
  }
  return 0;
}

bool _boolOrFalse(Object? value) => value is bool && value;

DateTime? _dateTime(Object? value) {
  if (value is String && value.isNotEmpty) {
    return DateTime.tryParse(value)?.toLocal();
  }
  return null;
}

List<String> _stringList(Object? value) {
  if (value is List) {
    return value.whereType<String>().toList(growable: false);
  }
  return const <String>[];
}

Map<String, Object?> _asMap(Object? value) {
  if (value is Map) {
    return value.map<String, Object?>(
      (Object? key, Object? item) => MapEntry<String, Object?>(key.toString(), item),
    );
  }
  return const <String, Object?>{};
}

/// A strategy instance belonging to the caller's organisation.
class StrategyInstanceSummary extends Equatable {
  const StrategyInstanceSummary({
    required this.id,
    required this.name,
    required this.kind,
    required this.version,
    required this.status,
    required this.health,
    required this.enabled,
    required this.venue,
    required this.symbols,
    required this.consecutiveErrors,
    this.lastHeartbeatAt,
    this.lastErrorCode,
    this.quarantineReason,
  });

  factory StrategyInstanceSummary.fromJson(Map<String, Object?> json) {
    return StrategyInstanceSummary(
      id: _requiredString(json['id']),
      name: _requiredString(json['name'], fallback: 'Unnamed strategy'),
      kind: _requiredString(json['kind'], fallback: 'UNKNOWN'),
      version: _requiredString(json['version'], fallback: '0.0.0'),
      status: StrategyInstanceStatus.fromApi(json['status'] as String?),
      health: StrategyHealth.fromApi(json['health'] as String?),
      enabled: _boolOrFalse(json['enabled']),
      venue: _requiredString(json['venue'], fallback: 'UNKNOWN'),
      symbols: _stringList(json['symbols']),
      consecutiveErrors: _intOrZero(json['consecutiveErrors']),
      lastHeartbeatAt: _dateTime(json['lastHeartbeatAt']),
      lastErrorCode: _optionalString(json['lastErrorCode']),
      quarantineReason: _optionalString(json['quarantineReason']),
    );
  }

  final String id;
  final String name;
  final String kind;
  final String version;
  final StrategyInstanceStatus status;
  final StrategyHealth health;
  final bool enabled;
  final String venue;
  final List<String> symbols;
  final int consecutiveErrors;
  final DateTime? lastHeartbeatAt;
  final String? lastErrorCode;
  final String? quarantineReason;

  bool get isQuarantined => health == StrategyHealth.quarantined;

  @override
  List<Object?> get props => <Object?>[
        id,
        name,
        kind,
        version,
        status,
        health,
        enabled,
        venue,
        symbols,
        consecutiveErrors,
        lastHeartbeatAt,
        lastErrorCode,
        quarantineReason,
      ];
}

/// A paper-trading session. Every fill behind these numbers is simulated.
class PaperSessionSummary extends Equatable {
  const PaperSessionSummary({
    required this.id,
    required this.sessionIdentifier,
    required this.status,
    required this.strategyKey,
    required this.symbol,
    required this.initialCapital,
    required this.realisedPnl,
    required this.feesPaid,
    required this.simulatedOrders,
    required this.simulatedFills,
    required this.riskRejections,
    required this.isSimulated,
    required this.startedAt,
    this.currentEquity,
    this.unrealisedPnl,
    this.maxDrawdown,
    this.stoppedAt,
  });

  factory PaperSessionSummary.fromJson(Map<String, Object?> json) {
    return PaperSessionSummary(
      id: _requiredString(json['id']),
      sessionIdentifier: _requiredString(json['sessionIdentifier']),
      status: SimulationStatus.fromApi(json['status'] as String?),
      strategyKey: _requiredString(json['strategyKey'], fallback: 'UNKNOWN'),
      symbol: _requiredString(json['symbol'], fallback: '—'),
      initialCapital: _requiredString(json['initialCapital'], fallback: '0'),
      realisedPnl: _requiredString(json['realisedPnl'], fallback: '0'),
      feesPaid: _requiredString(json['feesPaid'], fallback: '0'),
      simulatedOrders: _intOrZero(json['simulatedOrders']),
      simulatedFills: _intOrZero(json['simulatedFills']),
      riskRejections: _intOrZero(json['riskRejections']),
      // Defaults to true. If the label is ever missing from a payload the safe
      // reading is "simulated", not "real".
      isSimulated: json['isSimulated'] is bool ? json['isSimulated']! as bool : true,
      startedAt: _dateTime(json['startedAt']),
      currentEquity: _optionalString(json['currentEquity']),
      unrealisedPnl: _optionalString(json['unrealisedPnl']),
      maxDrawdown: _optionalString(json['maxDrawdown']),
      stoppedAt: _dateTime(json['stoppedAt']),
    );
  }

  final String id;
  final String sessionIdentifier;
  final SimulationStatus status;
  final String strategyKey;
  final String symbol;
  final String initialCapital;
  final String realisedPnl;
  final String feesPaid;
  final int simulatedOrders;
  final int simulatedFills;
  final int riskRejections;
  final bool isSimulated;
  final DateTime? startedAt;
  final String? currentEquity;
  final String? unrealisedPnl;
  final String? maxDrawdown;
  final DateTime? stoppedAt;

  @override
  List<Object?> get props => <Object?>[
        id,
        sessionIdentifier,
        status,
        strategyKey,
        symbol,
        initialCapital,
        realisedPnl,
        feesPaid,
        simulatedOrders,
        simulatedFills,
        riskRejections,
        isSimulated,
        startedAt,
        currentEquity,
        unrealisedPnl,
        maxDrawdown,
        stoppedAt,
      ];
}

/// A completed or in-flight backtest, flattened for a phone-sized card.
class BacktestSummary extends Equatable {
  const BacktestSummary({
    required this.id,
    required this.runIdentifier,
    required this.status,
    required this.strategyKey,
    required this.strategyVersion,
    required this.symbol,
    required this.totalTrades,
    required this.hasSufficientObservations,
    required this.isReproducible,
    required this.queuedAt,
    this.netPnl,
    this.totalReturnPercent,
    this.maxDrawdownPercent,
    this.winRate,
    this.sharpeRatio,
    this.completedAt,
  });

  factory BacktestSummary.fromJson(Map<String, Object?> json) {
    final Map<String, Object?> result = _asMap(json['result']);

    return BacktestSummary(
      id: _requiredString(json['id']),
      runIdentifier: _requiredString(json['runIdentifier']),
      status: SimulationStatus.fromApi(json['status'] as String?),
      strategyKey: _requiredString(json['strategyKey'], fallback: 'UNKNOWN'),
      strategyVersion: _requiredString(json['strategyVersion'], fallback: '0.0.0'),
      symbol: _requiredString(json['symbol'], fallback: '—'),
      totalTrades: _intOrZero(result['totalTrades']),
      hasSufficientObservations: _boolOrFalse(result['hasSufficientObservations']),
      isReproducible: _boolOrFalse(json['isReproducible']),
      queuedAt: _dateTime(json['queuedAt']),
      netPnl: _optionalString(result['netPnl']),
      totalReturnPercent: _optionalString(result['totalReturnPercent']),
      maxDrawdownPercent: _optionalString(result['maxDrawdownPercent']),
      winRate: _optionalString(result['winRate']),
      sharpeRatio: _optionalString(result['sharpeRatio']),
      completedAt: _dateTime(json['completedAt']),
    );
  }

  final String id;
  final String runIdentifier;
  final SimulationStatus status;
  final String strategyKey;
  final String strategyVersion;
  final String symbol;
  final int totalTrades;

  /// False when the run had too few observations for risk-adjusted metrics.
  /// The affected fields arrive as `null` and must not be shown as zero.
  final bool hasSufficientObservations;

  final bool isReproducible;
  final DateTime? queuedAt;
  final String? netPnl;
  final String? totalReturnPercent;
  final String? maxDrawdownPercent;
  final String? winRate;
  final String? sharpeRatio;
  final DateTime? completedAt;

  @override
  List<Object?> get props => <Object?>[
        id,
        runIdentifier,
        status,
        strategyKey,
        strategyVersion,
        symbol,
        totalTrades,
        hasSufficientObservations,
        isReproducible,
        queuedAt,
        netPnl,
        totalReturnPercent,
        maxDrawdownPercent,
        winRate,
        sharpeRatio,
        completedAt,
      ];
}

/// Counters and the platform's current strategy configuration.
class StrategyOverview extends Equatable {
  const StrategyOverview({
    required this.totalInstances,
    required this.enabledInstances,
    required this.runningInstances,
    required this.quarantinedInstances,
    required this.unhealthyInstances,
    required this.openIncidents,
    required this.criticalIncidents,
    required this.runningPaperSessions,
    required this.queuedBacktests,
    required this.strategyEngineEnabled,
    required this.paperTradingEnabled,
    required this.backtestEnabled,
    required this.tradingMode,
    required this.liveExecutionReachable,
    required this.latencyNote,
    required this.disclaimer,
  });

  factory StrategyOverview.fromJson(Map<String, Object?> json) {
    final Map<String, Object?> instances = _asMap(json['instances']);
    final Map<String, Object?> incidents = _asMap(json['incidents']);
    final Map<String, Object?> sessions = _asMap(json['paperSessions']);
    final Map<String, Object?> backtests = _asMap(json['backtests']);
    final Map<String, Object?> configuration = _asMap(json['configuration']);

    return StrategyOverview(
      totalInstances: _intOrZero(instances['total']),
      enabledInstances: _intOrZero(instances['enabled']),
      runningInstances: _intOrZero(instances['running']),
      quarantinedInstances: _intOrZero(instances['quarantined']),
      unhealthyInstances: _intOrZero(instances['unhealthy']),
      openIncidents: _intOrZero(incidents['open']),
      criticalIncidents: _intOrZero(incidents['critical']),
      runningPaperSessions: _intOrZero(sessions['running']),
      queuedBacktests: _intOrZero(backtests['queued']),
      strategyEngineEnabled: _boolOrFalse(configuration['strategyEngineEnabled']),
      paperTradingEnabled: _boolOrFalse(configuration['paperTradingEnabled']),
      backtestEnabled: _boolOrFalse(configuration['backtestEnabled']),
      tradingMode: _requiredString(configuration['tradingMode'], fallback: 'UNKNOWN'),
      liveExecutionReachable: _boolOrFalse(configuration['liveExecutionReachable']),
      latencyNote: _requiredString(json['latencyNote']),
      disclaimer: _requiredString(json['disclaimer']),
    );
  }

  final int totalInstances;
  final int enabledInstances;
  final int runningInstances;
  final int quarantinedInstances;
  final int unhealthyInstances;
  final int openIncidents;
  final int criticalIncidents;
  final int runningPaperSessions;
  final int queuedBacktests;
  final bool strategyEngineEnabled;
  final bool paperTradingEnabled;
  final bool backtestEnabled;
  final String tradingMode;

  /// Whether a signal could, in this deployment, become a real order.
  final bool liveExecutionReachable;

  final String latencyNote;
  final String disclaimer;

  @override
  List<Object?> get props => <Object?>[
        totalInstances,
        enabledInstances,
        runningInstances,
        quarantinedInstances,
        unhealthyInstances,
        openIncidents,
        criticalIncidents,
        runningPaperSessions,
        queuedBacktests,
        strategyEngineEnabled,
        paperTradingEnabled,
        backtestEnabled,
        tradingMode,
        liveExecutionReachable,
        latencyNote,
        disclaimer,
      ];
}
```

FILE: apps/mobile/lib/features/strategies/presentation/strategies_screen.dart

```dart
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/providers.dart';
import '../../../l10n/app_localizations.dart';
import '../domain/strategy_models.dart';
import 'strategy_state.dart';

/// Read-only strategy viewer.
///
/// There is no button on this screen that changes anything. It answers three
/// questions and stops: what is running, is any of it unhealthy, and what did
/// the simulator produce. Controls live in the admin console, behind
/// permissions this client is not granted.
class StrategiesScreen extends ConsumerStatefulWidget {
  const StrategiesScreen({super.key});

  @override
  ConsumerState<StrategiesScreen> createState() => _StrategiesScreenState();
}

class _StrategiesScreenState extends ConsumerState<StrategiesScreen> {
  @override
  void initState() {
    super.initState();
    // Deferred to after the first frame: the controller mutates provider state
    // and must not do so during the build that created it.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      unawaited(ref.read(strategyControllerProvider.notifier).load());
    });
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final StrategyViewState state = ref.watch(strategyControllerProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.strategiesTitle)),
      body: RefreshIndicator(
        onRefresh: () => ref.read(strategyControllerProvider.notifier).refresh(),
        child: _body(context, l10n, state),
      ),
    );
  }

  Widget _body(BuildContext context, AppLocalizations l10n, StrategyViewState state) {
    if (state.status == StrategyViewStatus.loading && !state.hasAnyData) {
      return const Center(child: CircularProgressIndicator());
    }

    if (state.status == StrategyViewStatus.failed && !state.hasAnyData) {
      return _FailureView(
        message: state.error?.message ?? l10n.genericError,
        retryLabel: l10n.retry,
        onRetry: () => ref.read(strategyControllerProvider.notifier).load(),
      );
    }

    return ListView(
      padding: const EdgeInsets.all(16),
      physics: const AlwaysScrollableScrollPhysics(),
      children: <Widget>[
        if (state.isDegraded) _DegradedBanner(message: l10n.strategyPanelsDegraded),
        if (state.overview != null) _BoundaryCard(overview: state.overview!, l10n: l10n),
        const SizedBox(height: 12),
        if (state.overview != null) _CountersCard(overview: state.overview!, l10n: l10n),
        const SizedBox(height: 12),
        _SectionHeading(title: l10n.strategyInstancesSection),
        if (state.instances.isEmpty)
          _EmptyCard(message: l10n.strategyNoInstances)
        else
          for (final StrategyInstanceSummary instance in state.instances)
            _InstanceCard(instance: instance, l10n: l10n),
        const SizedBox(height: 12),
        _SectionHeading(title: l10n.paperSessionsSection),
        if (state.paperSessions.isEmpty)
          _EmptyCard(message: l10n.strategyNoPaperSessions)
        else
          for (final PaperSessionSummary session in state.paperSessions)
            _PaperSessionCard(session: session, l10n: l10n),
        const SizedBox(height: 12),
        _SectionHeading(title: l10n.backtestsSection),
        if (state.backtests.isEmpty)
          _EmptyCard(message: l10n.strategyNoBacktests)
        else
          for (final BacktestSummary backtest in state.backtests)
            _BacktestCard(backtest: backtest, l10n: l10n),
        const SizedBox(height: 16),
        _DisclaimerCard(l10n: l10n),
        const SizedBox(height: 24),
      ],
    );
  }
}

/// The execution boundary, stated before any number on the page.
class _BoundaryCard extends StatelessWidget {
  const _BoundaryCard({required this.overview, required this.l10n});

  final StrategyOverview overview;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;
    final bool live = overview.liveExecutionReachable;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Icon(
                  live ? Icons.warning_amber_rounded : Icons.shield_outlined,
                  color: live ? colors.error : colors.primary,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    live ? l10n.liveExecutionReachable : l10n.liveExecutionNotReachable,
                    style: Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: <Widget>[
                _StatusChip(
                  label: l10n.strategyEngineLabel,
                  on: overview.strategyEngineEnabled,
                ),
                _StatusChip(label: l10n.paperTradingLabel, on: overview.paperTradingEnabled),
                _StatusChip(label: l10n.backtestingLabel, on: overview.backtestEnabled),
                Chip(label: Text('${l10n.tradingModeLabel}: ${overview.tradingMode}')),
              ],
            ),
            if (overview.latencyNote.isNotEmpty) ...<Widget>[
              const SizedBox(height: 12),
              Text(
                overview.latencyNote,
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: colors.onSurfaceVariant),
              ),
            ],
            const SizedBox(height: 8),
            Text(
              l10n.strategyReadOnlyNotice,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: colors.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}

class _CountersCard extends StatelessWidget {
  const _CountersCard({required this.overview, required this.l10n});

  final StrategyOverview overview;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Wrap(
          spacing: 24,
          runSpacing: 16,
          children: <Widget>[
            _Counter(label: l10n.instancesLabel, value: '${overview.totalInstances}'),
            _Counter(label: l10n.runningLabel, value: '${overview.runningInstances}'),
            _Counter(
              label: l10n.needsAttentionLabel,
              value: '${overview.unhealthyInstances + overview.quarantinedInstances}',
              emphasise: overview.unhealthyInstances + overview.quarantinedInstances > 0,
            ),
            _Counter(
              label: l10n.openIncidentsLabel,
              value: '${overview.openIncidents}',
              emphasise: overview.criticalIncidents > 0,
            ),
            _Counter(
              label: l10n.paperSessionsSection,
              value: '${overview.runningPaperSessions}',
            ),
          ],
        ),
      ),
    );
  }
}

class _InstanceCard extends StatelessWidget {
  const _InstanceCard({required this.instance, required this.l10n});

  final StrategyInstanceSummary instance;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        instance.name,
                        style: Theme.of(context)
                            .textTheme
                            .titleSmall
                            ?.copyWith(fontWeight: FontWeight.w700),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '${instance.kind}@${instance.version}',
                        style: Theme.of(context)
                            .textTheme
                            .bodySmall
                            ?.copyWith(color: colors.onSurfaceVariant),
                      ),
                    ],
                  ),
                ),
                _HealthBadge(health: instance.health),
              ],
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: <Widget>[
                Chip(label: Text(instance.venue)),
                for (final String symbol in instance.symbols) Chip(label: Text(symbol)),
                Chip(
                  label: Text(
                    instance.enabled ? l10n.enabledLabel : l10n.disabledLabel,
                  ),
                ),
              ],
            ),
            if (instance.consecutiveErrors > 0 || instance.lastErrorCode != null) ...<Widget>[
              const SizedBox(height: 10),
              Text(
                '${l10n.consecutiveErrorsLabel}: ${instance.consecutiveErrors}'
                '${instance.lastErrorCode == null ? '' : ' · ${instance.lastErrorCode}'}',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.error),
              ),
            ],
            if (instance.quarantineReason != null) ...<Widget>[
              const SizedBox(height: 6),
              Text(
                instance.quarantineReason!,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.error),
              ),
            ],
            const SizedBox(height: 6),
            Text(
              instance.lastHeartbeatAt == null
                  ? l10n.noHeartbeatYet
                  : '${l10n.lastHeartbeatLabel}: ${_formatTimestamp(instance.lastHeartbeatAt!)}',
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: colors.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}

class _PaperSessionCard extends StatelessWidget {
  const _PaperSessionCard({required this.session, required this.l10n});

  final PaperSessionSummary session;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    '${session.strategyKey} · ${session.symbol}',
                    style: Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
                if (session.isSimulated) _SimulatedBadge(label: l10n.simulatedBadge),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              session.sessionIdentifier,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: colors.onSurfaceVariant),
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 20,
              runSpacing: 12,
              children: <Widget>[
                _Counter(label: l10n.statusLabel, value: _statusLabel(session.status, l10n)),
                _Counter(
                  label: l10n.equityLabel,
                  value: session.currentEquity ?? l10n.notAvailableShort,
                ),
                _Counter(label: l10n.realisedPnlLabel, value: session.realisedPnl),
                _Counter(
                  label: l10n.simulatedFillsLabel,
                  value: '${session.simulatedOrders} / ${session.simulatedFills}',
                ),
                _Counter(label: l10n.riskRejectionsLabel, value: '${session.riskRejections}'),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _BacktestCard extends StatelessWidget {
  const _BacktestCard({required this.backtest, required this.l10n});

  final BacktestSummary backtest;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;

    /// A withheld metric reads as "insufficient data", never as zero.
    String metric(String? value) {
      if (value != null) {
        return value;
      }
      return backtest.hasSufficientObservations
          ? l10n.notAvailableShort
          : l10n.insufficientData;
    }

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    '${backtest.strategyKey}@${backtest.strategyVersion} · ${backtest.symbol}',
                    style: Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
                _SimulatedBadge(label: l10n.simulatedBadge),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              backtest.runIdentifier,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: colors.onSurfaceVariant),
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 20,
              runSpacing: 12,
              children: <Widget>[
                _Counter(label: l10n.statusLabel, value: _statusLabel(backtest.status, l10n)),
                _Counter(label: l10n.netPnlLabel, value: metric(backtest.netPnl)),
                _Counter(label: l10n.tradesLabel, value: '${backtest.totalTrades}'),
                _Counter(label: l10n.winRateLabel, value: metric(backtest.winRate)),
                _Counter(label: l10n.sharpeLabel, value: metric(backtest.sharpeRatio)),
                _Counter(
                  label: l10n.maxDrawdownLabel,
                  value: metric(backtest.maxDrawdownPercent),
                ),
              ],
            ),
            if (!backtest.isReproducible) ...<Widget>[
              const SizedBox(height: 10),
              Text(
                l10n.backtestNotReproducible,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.error),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _DisclaimerCard extends StatelessWidget {
  const _DisclaimerCard({required this.l10n});

  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;

    return Card(
      color: colors.surfaceContainerHighest,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              l10n.simulationDisclaimerTitle,
              style: Theme.of(context)
                  .textTheme
                  .titleSmall
                  ?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            Text(l10n.backtestDisclaimer, style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 4),
            Text(l10n.paperDisclaimer, style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 4),
            Text(
              l10n.executionQualityDisclaimer,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 4),
            Text(
              l10n.insufficientDataDisclaimer,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }
}

class _HealthBadge extends StatelessWidget {
  const _HealthBadge({required this.health});

  final StrategyHealth health;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;

    final Color background = switch (health) {
      StrategyHealth.healthy => colors.primaryContainer,
      StrategyHealth.degraded => colors.tertiaryContainer,
      StrategyHealth.unhealthy || StrategyHealth.quarantined => colors.errorContainer,
      StrategyHealth.unknown => colors.surfaceContainerHighest,
    };

    final Color foreground = switch (health) {
      StrategyHealth.healthy => colors.onPrimaryContainer,
      StrategyHealth.degraded => colors.onTertiaryContainer,
      StrategyHealth.unhealthy || StrategyHealth.quarantined => colors.onErrorContainer,
      StrategyHealth.unknown => colors.onSurfaceVariant,
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        health.name.toUpperCase(),
        style: Theme.of(context)
            .textTheme
            .labelSmall
            ?.copyWith(color: foreground, fontWeight: FontWeight.w700),
      ),
    );
  }
}

class _SimulatedBadge extends StatelessWidget {
  const _SimulatedBadge({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: colors.secondaryContainer,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: colors.onSecondaryContainer,
              fontWeight: FontWeight.w700,
            ),
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.label, required this.on});

  final String label;
  final bool on;

  @override
  Widget build(BuildContext context) {
    return Chip(
      avatar: Icon(
        on ? Icons.check_circle_outline : Icons.remove_circle_outline,
        size: 18,
      ),
      label: Text(label),
    );
  }
}

class _Counter extends StatelessWidget {
  const _Counter({required this.label, required this.value, this.emphasise = false});

  final String label;
  final String value;
  final bool emphasise;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Text(
          label,
          style: Theme.of(context)
              .textTheme
              .labelSmall
              ?.copyWith(color: colors.onSurfaceVariant),
        ),
        const SizedBox(height: 2),
        Text(
          value,
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w700,
                color: emphasise ? colors.error : null,
              ),
        ),
      ],
    );
  }
}

class _SectionHeading extends StatelessWidget {
  const _SectionHeading({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 8, bottom: 8),
      child: Text(
        title,
        style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
      ),
    );
  }
}

class _EmptyCard extends StatelessWidget {
  const _EmptyCard({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Text(
          message,
          style: Theme.of(context)
              .textTheme
              .bodyMedium
              ?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
        ),
      ),
    );
  }
}

class _DegradedBanner extends StatelessWidget {
  const _DegradedBanner({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: colors.tertiaryContainer,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: <Widget>[
          Icon(Icons.info_outline, color: colors.onTertiaryContainer, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: colors.onTertiaryContainer),
            ),
          ),
        ],
      ),
    );
  }
}

class _FailureView extends StatelessWidget {
  const _FailureView({
    required this.message,
    required this.retryLabel,
    required this.onRetry,
  });

  final String message;
  final String retryLabel;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(24),
      children: <Widget>[
        const SizedBox(height: 80),
        Icon(
          Icons.cloud_off_outlined,
          size: 40,
          color: Theme.of(context).colorScheme.onSurfaceVariant,
        ),
        const SizedBox(height: 16),
        Text(message, textAlign: TextAlign.center),
        const SizedBox(height: 16),
        Center(
          child: FilledButton(onPressed: onRetry, child: Text(retryLabel)),
        ),
      ],
    );
  }
}

String _statusLabel(SimulationStatus status, AppLocalizations l10n) {
  switch (status) {
    case SimulationStatus.queued:
      return l10n.statusQueued;
    case SimulationStatus.running:
      return l10n.statusRunning;
    case SimulationStatus.completed:
      return l10n.statusCompleted;
    case SimulationStatus.stopped:
      return l10n.statusStopped;
    case SimulationStatus.failed:
      return l10n.statusFailed;
    case SimulationStatus.cancelled:
      return l10n.statusCancelled;
    case SimulationStatus.unknown:
      return l10n.notAvailableShort;
  }
}

/// Local, dependency-free timestamp rendering.
///
/// Deliberately not localised into a relative phrase: an operator reading an
/// incident needs an unambiguous wall-clock time, not "2 hours ago".
String _formatTimestamp(DateTime value) {
  String two(int input) => input.toString().padLeft(2, '0');
  return '${value.year}-${two(value.month)}-${two(value.day)} '
      '${two(value.hour)}:${two(value.minute)}';
}
```

FILE: apps/mobile/lib/features/strategies/presentation/strategy_controller.dart

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/error/app_exception.dart';
import '../../../core/logging/app_logger.dart';
import '../data/strategy_repository.dart';
import '../domain/strategy_models.dart';
import 'strategy_state.dart';

/// Drives the read-only strategy screen.
///
/// The controller exposes exactly two operations - [load] and [refresh] - and
/// no mutation. Adding one here would be the first step towards a trading
/// control on a phone, so the class is kept deliberately inert.
///
/// Panels are fetched concurrently and failures are isolated per panel. Only
/// a total failure surfaces as a page-level error.
class StrategyController extends StateNotifier<StrategyViewState> {
  StrategyController({required StrategyRepository repository, required AppLogger logger})
      : _repository = repository,
        _logger = logger,
        super(const StrategyViewState.initial());

  final StrategyRepository _repository;
  final AppLogger _logger;

  Future<void> load() => _fetch(isRefresh: false);

  Future<void> refresh() => _fetch(isRefresh: true);

  Future<void> _fetch({required bool isRefresh}) async {
    if (state.isRefreshing) {
      return;
    }

    state = state.copyWith(
      status: isRefresh ? state.status : StrategyViewStatus.loading,
      isRefreshing: true,
      clearError: true,
    );

    final List<String> degraded = <String>[];
    AppException? lastFailure;

    Future<T?> attempt<T>(String panel, Future<T> Function() operation) async {
      try {
        return await operation();
      } on AppException catch (error) {
        degraded.add(panel);
        lastFailure = error;
        // Panel name and error code only. Never the payload: it can carry
        // organisation-identifying detail into device logs.
        _logger.warning(
          'strategy.panel_failed',
          context: <String, Object?>{'panel': panel, 'code': error.code.name},
        );
        return null;
      }
    }

    final List<Object?> results = await Future.wait<Object?>(<Future<Object?>>[
      attempt<StrategyOverview>('overview', _repository.fetchOverview),
      attempt<List<StrategyInstanceSummary>>('instances', _repository.fetchInstances),
      attempt<List<PaperSessionSummary>>('paperSessions', _repository.fetchPaperSessions),
      attempt<List<BacktestSummary>>('backtests', _repository.fetchBacktests),
    ]);

    final StrategyOverview? overview = results[0] as StrategyOverview?;
    final List<StrategyInstanceSummary>? instances =
        results[1] as List<StrategyInstanceSummary>?;
    final List<PaperSessionSummary>? sessions = results[2] as List<PaperSessionSummary>?;
    final List<BacktestSummary>? backtests = results[3] as List<BacktestSummary>?;

    final bool everythingFailed = degraded.length == results.length;

    if (everythingFailed) {
      state = state.copyWith(
        status: StrategyViewStatus.failed,
        isRefreshing: false,
        error: lastFailure,
        degradedPanels: const <String>[],
      );
      return;
    }

    state = StrategyViewState(
      status: StrategyViewStatus.ready,
      // A panel that failed keeps its previous content rather than blanking.
      overview: overview ?? state.overview,
      instances: instances ?? state.instances,
      paperSessions: sessions ?? state.paperSessions,
      backtests: backtests ?? state.backtests,
      isRefreshing: false,
      degradedPanels: List<String>.unmodifiable(degraded),
    );
  }
}
```

FILE: apps/mobile/lib/features/strategies/presentation/strategy_state.dart

```dart
import 'package:equatable/equatable.dart';

import '../../../core/error/app_exception.dart';
import '../domain/strategy_models.dart';

/// Loading state of the strategy viewer.
enum StrategyViewStatus { initial, loading, ready, failed }

/// Immutable state for the read-only strategy screen.
///
/// The four panels load in parallel and are held together here. A partial
/// failure keeps whatever did load: an operator checking on a degraded
/// instance should not lose the whole screen because the backtest list timed
/// out.
class StrategyViewState extends Equatable {
  const StrategyViewState({
    required this.status,
    this.overview,
    this.instances = const <StrategyInstanceSummary>[],
    this.paperSessions = const <PaperSessionSummary>[],
    this.backtests = const <BacktestSummary>[],
    this.error,
    this.isRefreshing = false,
    this.degradedPanels = const <String>[],
  });

  const StrategyViewState.initial() : this(status: StrategyViewStatus.initial);

  final StrategyViewStatus status;
  final StrategyOverview? overview;
  final List<StrategyInstanceSummary> instances;
  final List<PaperSessionSummary> paperSessions;
  final List<BacktestSummary> backtests;

  /// Set only when nothing at all could be loaded.
  final AppException? error;

  final bool isRefreshing;

  /// Human-readable names of panels that failed while others succeeded.
  final List<String> degradedPanels;

  bool get hasAnyData =>
      overview != null ||
      instances.isNotEmpty ||
      paperSessions.isNotEmpty ||
      backtests.isNotEmpty;

  bool get isDegraded => degradedPanels.isNotEmpty;

  /// Instances an operator should look at first.
  List<StrategyInstanceSummary> get attentionInstances => instances
      .where((StrategyInstanceSummary instance) => instance.health.needsAttention)
      .toList(growable: false);

  StrategyViewState copyWith({
    StrategyViewStatus? status,
    StrategyOverview? overview,
    List<StrategyInstanceSummary>? instances,
    List<PaperSessionSummary>? paperSessions,
    List<BacktestSummary>? backtests,
    AppException? error,
    bool? isRefreshing,
    List<String>? degradedPanels,
    bool clearError = false,
  }) {
    return StrategyViewState(
      status: status ?? this.status,
      overview: overview ?? this.overview,
      instances: instances ?? this.instances,
      paperSessions: paperSessions ?? this.paperSessions,
      backtests: backtests ?? this.backtests,
      error: clearError ? null : (error ?? this.error),
      isRefreshing: isRefreshing ?? this.isRefreshing,
      degradedPanels: degradedPanels ?? this.degradedPanels,
    );
  }

  @override
  List<Object?> get props => <Object?>[
        status,
        overview,
        instances,
        paperSessions,
        backtests,
        error,
        isRefreshing,
        degradedPanels,
      ];
}
```

FILE: apps/mobile/lib/l10n/app_bn.arb

```text
{
  "@@locale": "bn",
  "appTitle": "কপি ট্রেডিং",
  "signIn": "সাইন ইন",
  "signOut": "সাইন আউট",
  "emailLabel": "ইমেইল",
  "passwordLabel": "পাসওয়ার্ড",
  "signInSubtitle": "চালিয়ে যেতে আপনার অ্যাকাউন্টে সাইন ইন করুন।",
  "twoFactorTitle": "দুই-ধাপ যাচাইকরণ",
  "twoFactorSubtitle": "আপনার অথেন্টিকেটর অ্যাপ থেকে ছয় সংখ্যার কোডটি লিখুন।",
  "twoFactorCodeLabel": "যাচাইকরণ কোড",
  "recoveryCodeLabel": "রিকভারি কোড",
  "useRecoveryCode": "পরিবর্তে রিকভারি কোড ব্যবহার করুন",
  "useAuthenticator": "পরিবর্তে অথেন্টিকেটর অ্যাপ ব্যবহার করুন",
  "verify": "যাচাই করুন",
  "cancel": "বাতিল",
  "homeTitle": "সারসংক্ষেপ",
  "settingsTitle": "সেটিংস",
  "securityTitle": "নিরাপত্তা",
  "loading": "লোড হচ্ছে",
  "emailRequired": "আপনার ইমেইল ঠিকানা লিখুন",
  "emailInvalid": "একটি সঠিক ইমেইল ঠিকানা লিখুন",
  "passwordRequired": "আপনার পাসওয়ার্ড লিখুন",
  "codeRequired": "আপনার যাচাইকরণ কোড লিখুন",
  "genericError": "কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।",
  "sessionExpired": "আপনার সেশনের মেয়াদ শেষ হয়েছে। আবার সাইন ইন করুন।",
  "welcomeBack": "স্বাগতম",
  "accountSection": "অ্যাকাউন্ট",
  "securitySection": "নিরাপত্তা",
  "twoFactorEnabled": "দুই-ধাপ যাচাইকরণ চালু আছে",
  "twoFactorDisabled": "দুই-ধাপ যাচাইকরণ বন্ধ আছে",
  "activeSessions": "সক্রিয় ডিভাইস",
  "changePassword": "পাসওয়ার্ড পরিবর্তন করুন",
  "executionDisabledNotice": "এই বিল্ডে লাইভ অর্ডার এক্সিকিউশন বন্ধ রাখা হয়েছে।",
  "strategiesTitle": "স্ট্র্যাটেজি",
  "strategiesSubtitle": "স্ট্র্যাটেজির স্বাস্থ্য ও সিমুলেটেড ফলাফল দেখুন।",
  "strategyReadOnlyNotice": "এই স্ক্রিনটি শুধু দেখার জন্য। স্ট্র্যাটেজি চালু, বন্ধ ও কনফিগার করা হয় অ্যাডমিন কনসোল থেকে।",
  "strategyPanelsDegraded": "কিছু অংশ লোড করা যায়নি। আবার চেষ্টা করতে নিচে টানুন।",
  "liveExecutionReachable": "এই ডিপ্লয়মেন্টে লাইভ এক্সিকিউশনে পৌঁছানো সম্ভব",
  "liveExecutionNotReachable": "এই ডিপ্লয়মেন্টে লাইভ এক্সিকিউশনে পৌঁছানো সম্ভব নয়",
  "strategyEngineLabel": "স্ট্র্যাটেজি ইঞ্জিন",
  "paperTradingLabel": "পেপার ট্রেডিং",
  "backtestingLabel": "ব্যাকটেস্টিং",
  "tradingModeLabel": "মোড",
  "strategyInstancesSection": "ইনস্ট্যান্স",
  "paperSessionsSection": "পেপার সেশন",
  "backtestsSection": "ব্যাকটেস্ট",
  "strategyNoInstances": "কোনো স্ট্র্যাটেজি ইনস্ট্যান্স তৈরি করা হয়নি।",
  "strategyNoPaperSessions": "কোনো পেপার সেশন চালানো হয়নি।",
  "strategyNoBacktests": "কোনো ব্যাকটেস্ট চালানো হয়নি।",
  "instancesLabel": "ইনস্ট্যান্স",
  "runningLabel": "চলমান",
  "needsAttentionLabel": "মনোযোগ প্রয়োজন",
  "openIncidentsLabel": "খোলা ইনসিডেন্ট",
  "enabledLabel": "চালু",
  "disabledLabel": "বন্ধ",
  "consecutiveErrorsLabel": "পরপর ত্রুটি",
  "lastHeartbeatLabel": "সর্বশেষ হার্টবিট",
  "noHeartbeatYet": "এখনো কোনো হার্টবিট আসেনি",
  "statusLabel": "অবস্থা",
  "equityLabel": "ইকুইটি",
  "realisedPnlLabel": "রিয়েলাইজড লাভ/ক্ষতি",
  "netPnlLabel": "নিট লাভ/ক্ষতি",
  "tradesLabel": "ট্রেড",
  "winRateLabel": "উইন রেট",
  "sharpeLabel": "শার্প",
  "maxDrawdownLabel": "সর্বোচ্চ ড্রডাউন",
  "simulatedFillsLabel": "অর্ডার / ফিল",
  "riskRejectionsLabel": "ঝুঁকি প্রত্যাখ্যান",
  "simulatedBadge": "সিমুলেটেড",
  "insufficientData": "পর্যাপ্ত তথ্য নেই",
  "notAvailableShort": "প্রযোজ্য নয়",
  "statusQueued": "সারিতে",
  "statusRunning": "চলমান",
  "statusCompleted": "সম্পন্ন",
  "statusStopped": "বন্ধ",
  "statusFailed": "ব্যর্থ",
  "statusCancelled": "বাতিল",
  "backtestNotReproducible": "এই রানের ডেটাসেট চেকসাম নেই, তাই হুবহু পুনরায় তৈরি করা যাবে না।",
  "simulationDisclaimerTitle": "এই সংখ্যাগুলো সম্পর্কে",
  "backtestDisclaimer": "ব্যাকটেস্ট পারফরম্যান্স ভবিষ্যৎ পারফরম্যান্সের নির্দেশক নয়।",
  "paperDisclaimer": "পেপার পারফরম্যান্স লাইভ পারফরম্যান্সের নির্দেশক নয়।",
  "executionQualityDisclaimer": "সিমুলেশন প্রকৃত এক্সিকিউশন মান নিশ্চিত করে না।",
  "insufficientDataDisclaimer": "পর্যবেক্ষণ কম হলে ঝুঁকি-সমন্বিত পরিসংখ্যান দেখানো হয় না। পর্যাপ্ত তথ্য না থাকা মানে শূন্য নয়।",
  "riskTitle": "ঝুঁকি",
  "riskSubtitle": "আপনার সংগঠনের হাল্ট অবস্থা ও মিরর সাম্প্রতিকতা।",
  "riskEngineOn": "ঝুঁকি ইঞ্জিন অর্ডার-পাথে সক্রিয়",
  "riskEngineOff": "ঝুঁকি ইঞ্জিন নিষ্ক্রিয় — শুধু লোকাল টুলিং মোড",
  "riskFailClosedLabel": "ফেল-ক্লোজড",
  "riskCadenceLabel": "রিফ্রেশ / স্টেলনেস বাজেট",
  "riskCadenceWarn": "স্ন্যাপশট রিফ্রেশ স্টেলনেস বাজেটকে ছাড়িয়ে যায় না; সাম্প্রতিকতার ভিত্তিতে প্রত্যাখ্যানের প্রত্যাশা করুন।",
  "riskReadOnlyNotice": "ডিজাইনেই শুধু-পড়া। সুইচ চালু বা বন্ধ করা অ্যাডমিন কনসোলে থাকে — লিখিত কারণ ও টাইপ-করা নিশ্চিতকরণের আড়ালে।",
  "riskPanelsDegraded": "কিছু ঝুঁকি প্যানেল লোড করা যায়নি। আবার চেষ্টায় নিচের দিকে টানুন।",
  "riskMirrorSection": "অ্যাকাউন্ট অনুযায়ী সর্বশেষ মিরর",
  "riskSwitchesSection": "সক্রিয় সুইচ",
  "riskEventsSection": "সাম্প্রতিক ঝুঁকি ইভেন্ট",
  "riskNoMirror": "এখনো কোনো অ্যাকাউন্ট মিরর নেই। ঝুঁকি-অবস্থা ওয়ার্কার সিঙ্ক না করা পর্যন্ত ইঞ্জিন নতুন অর্ডার প্রত্যাখ্যান করবে — এটি ফেল-ক্লোজড কাজ করছে, ফাঁকা স্ক্রিনের ত্রুটি নয়।",
  "riskNoSwitches": "কিছুই হাল্ট করা নেই। এখানে সারির অভাবই সুস্বাস্থ্যের লক্ষণ।",
  "riskNoEvents": "কোনো ঝুঁকি ইভেন্ট রেকর্ড হয়নি।",
  "riskEngagedStopsLabel": "সক্রিয় স্টপ",
  "riskTriggeredProtectionsLabel": "ট্রিগার হওয়া সুরক্ষা",
  "riskStaleMirrorsLabel": "পুরোনো মিরর",
  "riskSevereEventsLabel": "গুরুতর ইভেন্ট (২৪ ঘণ্টা)",
  "riskSnapshotLabel": "স্ন্যাপশট",
  "riskCapturedLabel": "ক্যাপচার",
  "riskEquityLabel": "ইকিউটি",
  "riskDayPnlLabel": "দিনের নিট PnL",
  "riskGrossLabel": "গ্রস নোশনাল",
  "riskOpenOrdersLabel": "খোলা অর্ডার",
  "riskStaleSourcesLabel": "পুরোনো সোর্স",
  "riskStaleBadge": "পুরোনো",
  "riskReasonLabel": "কারণ",
  "riskEngagedManualLabel": "ম্যানুয়াল হাল্ট",
  "riskExplicitClearNotice": "এই সুরক্ষা ইঞ্জিন ট্রিগার করেছে। এই অ্যাপ থেকে এটি খোলা যাবে না; acknowledge-and-clear অ্যাডমিন কনসোলে আছে, টাইপ-করা নিশ্চিতকরণের আড়ালে।",
  "riskDisclaimer": "ঝুঁকি নিয়ন্ত্রণ অপারেশনগত ঝুঁকি কমায়, কিন্তু সব ক্ষতি থেকে রক্ষার নিশ্চয়তা দিতে পারে না।",
  "retry": "আবার চেষ্টা করুন"
}
```

FILE: apps/mobile/lib/l10n/app_en.arb

```text
{
  "@@locale": "en",
  "appTitle": "Copy Trading",
  "signIn": "Sign in",
  "signOut": "Sign out",
  "emailLabel": "Email",
  "passwordLabel": "Password",
  "signInSubtitle": "Sign in to your account to continue.",
  "twoFactorTitle": "Two-factor authentication",
  "twoFactorSubtitle": "Enter the six-digit code from your authenticator app.",
  "twoFactorCodeLabel": "Authentication code",
  "recoveryCodeLabel": "Recovery code",
  "useRecoveryCode": "Use a recovery code instead",
  "useAuthenticator": "Use my authenticator app instead",
  "verify": "Verify",
  "cancel": "Cancel",
  "homeTitle": "Overview",
  "settingsTitle": "Settings",
  "securityTitle": "Security",
  "loading": "Loading",
  "emailRequired": "Enter your email address",
  "emailInvalid": "Enter a valid email address",
  "passwordRequired": "Enter your password",
  "codeRequired": "Enter your authentication code",
  "genericError": "Something went wrong. Please try again.",
  "sessionExpired": "Your session has expired. Please sign in again.",
  "welcomeBack": "Welcome back",
  "accountSection": "Account",
  "securitySection": "Security",
  "twoFactorEnabled": "Two-factor authentication is on",
  "twoFactorDisabled": "Two-factor authentication is off",
  "activeSessions": "Active devices",
  "changePassword": "Change password",
  "executionDisabledNotice": "Live order execution is disabled on this build.",
  "strategiesTitle": "Strategies",
  "strategiesSubtitle": "View strategy health and simulated results.",
  "strategyReadOnlyNotice": "This screen is read-only. Strategies are started, stopped and configured from the admin console.",
  "strategyPanelsDegraded": "Some panels could not be loaded. Pull down to try again.",
  "liveExecutionReachable": "Live execution is reachable in this deployment",
  "liveExecutionNotReachable": "Live execution is not reachable in this deployment",
  "strategyEngineLabel": "Strategy engine",
  "paperTradingLabel": "Paper trading",
  "backtestingLabel": "Backtesting",
  "tradingModeLabel": "Mode",
  "strategyInstancesSection": "Instances",
  "paperSessionsSection": "Paper sessions",
  "backtestsSection": "Backtests",
  "strategyNoInstances": "No strategy instances have been created.",
  "strategyNoPaperSessions": "No paper sessions have been run.",
  "strategyNoBacktests": "No backtests have been run.",
  "instancesLabel": "Instances",
  "runningLabel": "Running",
  "needsAttentionLabel": "Needs attention",
  "openIncidentsLabel": "Open incidents",
  "enabledLabel": "Enabled",
  "disabledLabel": "Disabled",
  "consecutiveErrorsLabel": "Consecutive errors",
  "lastHeartbeatLabel": "Last heartbeat",
  "noHeartbeatYet": "No heartbeat reported yet",
  "statusLabel": "Status",
  "equityLabel": "Equity",
  "realisedPnlLabel": "Realised PnL",
  "netPnlLabel": "Net PnL",
  "tradesLabel": "Trades",
  "winRateLabel": "Win rate",
  "sharpeLabel": "Sharpe",
  "maxDrawdownLabel": "Max drawdown",
  "simulatedFillsLabel": "Orders / fills",
  "riskRejectionsLabel": "Risk rejections",
  "simulatedBadge": "SIMULATED",
  "insufficientData": "Insufficient data",
  "notAvailableShort": "N/A",
  "statusQueued": "Queued",
  "statusRunning": "Running",
  "statusCompleted": "Completed",
  "statusStopped": "Stopped",
  "statusFailed": "Failed",
  "statusCancelled": "Cancelled",
  "backtestNotReproducible": "This run has no dataset checksum and cannot be reproduced exactly.",
  "simulationDisclaimerTitle": "About these numbers",
  "backtestDisclaimer": "Backtest performance is not indicative of future performance.",
  "paperDisclaimer": "Paper performance is not indicative of live performance.",
  "executionQualityDisclaimer": "Simulation does not guarantee real execution quality.",
  "insufficientDataDisclaimer": "Risk-adjusted figures are withheld when there were too few observations. Insufficient data is not zero.",
  "riskTitle": "Risk",
  "riskSubtitle": "Halt status and mirror freshness for your organisation.",
  "riskEngineOn": "Risk engine is in the order path",
  "riskEngineOff": "Risk engine disabled - local tooling mode",
  "riskFailClosedLabel": "Fail-closed",
  "riskCadenceLabel": "Refresh / staleness budget",
  "riskCadenceWarn": "Snapshot refresh does not outpace the staleness budget; expect denials on freshness.",
  "riskReadOnlyNotice": "Read-only by design. Engaging or clearing a switch lives in the admin console, behind reasons and typed confirmations.",
  "riskPanelsDegraded": "Some risk panels could not be loaded. Pull down to try again.",
  "riskMirrorSection": "Latest mirror by account",
  "riskSwitchesSection": "Engaged switches",
  "riskEventsSection": "Recent risk events",
  "riskNoMirror": "No mirrored account state yet. Until the risk-state worker syncs, the engine denies new orders - that is fail-closed working, not a blank-screen bug.",
  "riskNoSwitches": "Nothing is halted. The absence of rows is health here.",
  "riskNoEvents": "No risk events recorded.",
  "riskEngagedStopsLabel": "Engaged stops",
  "riskTriggeredProtectionsLabel": "Triggered protections",
  "riskStaleMirrorsLabel": "Stale mirrors",
  "riskSevereEventsLabel": "Severe events (24h)",
  "riskSnapshotLabel": "Snapshot",
  "riskCapturedLabel": "Captured",
  "riskEquityLabel": "Equity",
  "riskDayPnlLabel": "Net day PnL",
  "riskGrossLabel": "Gross notional",
  "riskOpenOrdersLabel": "Open orders",
  "riskStaleSourcesLabel": "Stale sources",
  "riskStaleBadge": "STALE",
  "riskReasonLabel": "Reason",
  "riskEngagedManualLabel": "manual halt",
  "riskExplicitClearNotice": "This protection was triggered by the engine. It cannot be cleared from this app; acknowledge-and-clear lives in the admin console, behind a typed confirmation.",
  "riskDisclaimer": "Risk controls reduce operational risk but cannot guarantee against all losses.",
  "retry": "Try again"
}
```

FILE: apps/mobile/lib/l10n/app_localizations.dart

```dart
import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_bn.dart';
import 'app_localizations_en.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale) : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate = _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates = <LocalizationsDelegate<dynamic>>[
    delegate,
    GlobalMaterialLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
  ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('bn'),
    Locale('en')
  ];

  /// No description provided for @appTitle.
  ///
  /// In en, this message translates to:
  /// **'Copy Trading'**
  String get appTitle;

  /// No description provided for @signIn.
  ///
  /// In en, this message translates to:
  /// **'Sign in'**
  String get signIn;

  /// No description provided for @signOut.
  ///
  /// In en, this message translates to:
  /// **'Sign out'**
  String get signOut;

  /// No description provided for @emailLabel.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get emailLabel;

  /// No description provided for @passwordLabel.
  ///
  /// In en, this message translates to:
  /// **'Password'**
  String get passwordLabel;

  /// No description provided for @signInSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Sign in to your account to continue.'**
  String get signInSubtitle;

  /// No description provided for @twoFactorTitle.
  ///
  /// In en, this message translates to:
  /// **'Two-factor authentication'**
  String get twoFactorTitle;

  /// No description provided for @twoFactorSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Enter the six-digit code from your authenticator app.'**
  String get twoFactorSubtitle;

  /// No description provided for @twoFactorCodeLabel.
  ///
  /// In en, this message translates to:
  /// **'Authentication code'**
  String get twoFactorCodeLabel;

  /// No description provided for @recoveryCodeLabel.
  ///
  /// In en, this message translates to:
  /// **'Recovery code'**
  String get recoveryCodeLabel;

  /// No description provided for @useRecoveryCode.
  ///
  /// In en, this message translates to:
  /// **'Use a recovery code instead'**
  String get useRecoveryCode;

  /// No description provided for @useAuthenticator.
  ///
  /// In en, this message translates to:
  /// **'Use my authenticator app instead'**
  String get useAuthenticator;

  /// No description provided for @verify.
  ///
  /// In en, this message translates to:
  /// **'Verify'**
  String get verify;

  /// No description provided for @cancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get cancel;

  /// No description provided for @homeTitle.
  ///
  /// In en, this message translates to:
  /// **'Overview'**
  String get homeTitle;

  /// No description provided for @settingsTitle.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get settingsTitle;

  /// No description provided for @securityTitle.
  ///
  /// In en, this message translates to:
  /// **'Security'**
  String get securityTitle;

  /// No description provided for @loading.
  ///
  /// In en, this message translates to:
  /// **'Loading'**
  String get loading;

  /// No description provided for @emailRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter your email address'**
  String get emailRequired;

  /// No description provided for @emailInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid email address'**
  String get emailInvalid;

  /// No description provided for @passwordRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter your password'**
  String get passwordRequired;

  /// No description provided for @codeRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter your authentication code'**
  String get codeRequired;

  /// No description provided for @genericError.
  ///
  /// In en, this message translates to:
  /// **'Something went wrong. Please try again.'**
  String get genericError;

  /// No description provided for @sessionExpired.
  ///
  /// In en, this message translates to:
  /// **'Your session has expired. Please sign in again.'**
  String get sessionExpired;

  /// No description provided for @welcomeBack.
  ///
  /// In en, this message translates to:
  /// **'Welcome back'**
  String get welcomeBack;

  /// No description provided for @accountSection.
  ///
  /// In en, this message translates to:
  /// **'Account'**
  String get accountSection;

  /// No description provided for @securitySection.
  ///
  /// In en, this message translates to:
  /// **'Security'**
  String get securitySection;

  /// No description provided for @twoFactorEnabled.
  ///
  /// In en, this message translates to:
  /// **'Two-factor authentication is on'**
  String get twoFactorEnabled;

  /// No description provided for @twoFactorDisabled.
  ///
  /// In en, this message translates to:
  /// **'Two-factor authentication is off'**
  String get twoFactorDisabled;

  /// No description provided for @activeSessions.
  ///
  /// In en, this message translates to:
  /// **'Active devices'**
  String get activeSessions;

  /// No description provided for @changePassword.
  ///
  /// In en, this message translates to:
  /// **'Change password'**
  String get changePassword;

  /// No description provided for @executionDisabledNotice.
  ///
  /// In en, this message translates to:
  /// **'Live order execution is disabled on this build.'**
  String get executionDisabledNotice;

  /// No description provided for @strategiesTitle.
  ///
  /// In en, this message translates to:
  /// **'Strategies'**
  String get strategiesTitle;

  /// No description provided for @strategiesSubtitle.
  ///
  /// In en, this message translates to:
  /// **'View strategy health and simulated results.'**
  String get strategiesSubtitle;

  /// No description provided for @strategyReadOnlyNotice.
  ///
  /// In en, this message translates to:
  /// **'This screen is read-only. Strategies are started, stopped and configured from the admin console.'**
  String get strategyReadOnlyNotice;

  /// No description provided for @strategyPanelsDegraded.
  ///
  /// In en, this message translates to:
  /// **'Some panels could not be loaded. Pull down to try again.'**
  String get strategyPanelsDegraded;

  /// No description provided for @liveExecutionReachable.
  ///
  /// In en, this message translates to:
  /// **'Live execution is reachable in this deployment'**
  String get liveExecutionReachable;

  /// No description provided for @liveExecutionNotReachable.
  ///
  /// In en, this message translates to:
  /// **'Live execution is not reachable in this deployment'**
  String get liveExecutionNotReachable;

  /// No description provided for @strategyEngineLabel.
  ///
  /// In en, this message translates to:
  /// **'Strategy engine'**
  String get strategyEngineLabel;

  /// No description provided for @paperTradingLabel.
  ///
  /// In en, this message translates to:
  /// **'Paper trading'**
  String get paperTradingLabel;

  /// No description provided for @backtestingLabel.
  ///
  /// In en, this message translates to:
  /// **'Backtesting'**
  String get backtestingLabel;

  /// No description provided for @tradingModeLabel.
  ///
  /// In en, this message translates to:
  /// **'Mode'**
  String get tradingModeLabel;

  /// No description provided for @strategyInstancesSection.
  ///
  /// In en, this message translates to:
  /// **'Instances'**
  String get strategyInstancesSection;

  /// No description provided for @paperSessionsSection.
  ///
  /// In en, this message translates to:
  /// **'Paper sessions'**
  String get paperSessionsSection;

  /// No description provided for @backtestsSection.
  ///
  /// In en, this message translates to:
  /// **'Backtests'**
  String get backtestsSection;

  /// No description provided for @strategyNoInstances.
  ///
  /// In en, this message translates to:
  /// **'No strategy instances have been created.'**
  String get strategyNoInstances;

  /// No description provided for @strategyNoPaperSessions.
  ///
  /// In en, this message translates to:
  /// **'No paper sessions have been run.'**
  String get strategyNoPaperSessions;

  /// No description provided for @strategyNoBacktests.
  ///
  /// In en, this message translates to:
  /// **'No backtests have been run.'**
  String get strategyNoBacktests;

  /// No description provided for @instancesLabel.
  ///
  /// In en, this message translates to:
  /// **'Instances'**
  String get instancesLabel;

  /// No description provided for @runningLabel.
  ///
  /// In en, this message translates to:
  /// **'Running'**
  String get runningLabel;

  /// No description provided for @needsAttentionLabel.
  ///
  /// In en, this message translates to:
  /// **'Needs attention'**
  String get needsAttentionLabel;

  /// No description provided for @openIncidentsLabel.
  ///
  /// In en, this message translates to:
  /// **'Open incidents'**
  String get openIncidentsLabel;

  /// No description provided for @enabledLabel.
  ///
  /// In en, this message translates to:
  /// **'Enabled'**
  String get enabledLabel;

  /// No description provided for @disabledLabel.
  ///
  /// In en, this message translates to:
  /// **'Disabled'**
  String get disabledLabel;

  /// No description provided for @consecutiveErrorsLabel.
  ///
  /// In en, this message translates to:
  /// **'Consecutive errors'**
  String get consecutiveErrorsLabel;

  /// No description provided for @lastHeartbeatLabel.
  ///
  /// In en, this message translates to:
  /// **'Last heartbeat'**
  String get lastHeartbeatLabel;

  /// No description provided for @noHeartbeatYet.
  ///
  /// In en, this message translates to:
  /// **'No heartbeat reported yet'**
  String get noHeartbeatYet;

  /// No description provided for @statusLabel.
  ///
  /// In en, this message translates to:
  /// **'Status'**
  String get statusLabel;

  /// No description provided for @equityLabel.
  ///
  /// In en, this message translates to:
  /// **'Equity'**
  String get equityLabel;

  /// No description provided for @realisedPnlLabel.
  ///
  /// In en, this message translates to:
  /// **'Realised PnL'**
  String get realisedPnlLabel;

  /// No description provided for @netPnlLabel.
  ///
  /// In en, this message translates to:
  /// **'Net PnL'**
  String get netPnlLabel;

  /// No description provided for @tradesLabel.
  ///
  /// In en, this message translates to:
  /// **'Trades'**
  String get tradesLabel;

  /// No description provided for @winRateLabel.
  ///
  /// In en, this message translates to:
  /// **'Win rate'**
  String get winRateLabel;

  /// No description provided for @sharpeLabel.
  ///
  /// In en, this message translates to:
  /// **'Sharpe'**
  String get sharpeLabel;

  /// No description provided for @maxDrawdownLabel.
  ///
  /// In en, this message translates to:
  /// **'Max drawdown'**
  String get maxDrawdownLabel;

  /// No description provided for @simulatedFillsLabel.
  ///
  /// In en, this message translates to:
  /// **'Orders / fills'**
  String get simulatedFillsLabel;

  /// No description provided for @riskRejectionsLabel.
  ///
  /// In en, this message translates to:
  /// **'Risk rejections'**
  String get riskRejectionsLabel;

  /// No description provided for @simulatedBadge.
  ///
  /// In en, this message translates to:
  /// **'SIMULATED'**
  String get simulatedBadge;

  /// No description provided for @insufficientData.
  ///
  /// In en, this message translates to:
  /// **'Insufficient data'**
  String get insufficientData;

  /// No description provided for @notAvailableShort.
  ///
  /// In en, this message translates to:
  /// **'N/A'**
  String get notAvailableShort;

  /// No description provided for @statusQueued.
  ///
  /// In en, this message translates to:
  /// **'Queued'**
  String get statusQueued;

  /// No description provided for @statusRunning.
  ///
  /// In en, this message translates to:
  /// **'Running'**
  String get statusRunning;

  /// No description provided for @statusCompleted.
  ///
  /// In en, this message translates to:
  /// **'Completed'**
  String get statusCompleted;

  /// No description provided for @statusStopped.
  ///
  /// In en, this message translates to:
  /// **'Stopped'**
  String get statusStopped;

  /// No description provided for @statusFailed.
  ///
  /// In en, this message translates to:
  /// **'Failed'**
  String get statusFailed;

  /// No description provided for @statusCancelled.
  ///
  /// In en, this message translates to:
  /// **'Cancelled'**
  String get statusCancelled;

  /// No description provided for @backtestNotReproducible.
  ///
  /// In en, this message translates to:
  /// **'This run has no dataset checksum and cannot be reproduced exactly.'**
  String get backtestNotReproducible;

  /// No description provided for @simulationDisclaimerTitle.
  ///
  /// In en, this message translates to:
  /// **'About these numbers'**
  String get simulationDisclaimerTitle;

  /// No description provided for @backtestDisclaimer.
  ///
  /// In en, this message translates to:
  /// **'Backtest performance is not indicative of future performance.'**
  String get backtestDisclaimer;

  /// No description provided for @paperDisclaimer.
  ///
  /// In en, this message translates to:
  /// **'Paper performance is not indicative of live performance.'**
  String get paperDisclaimer;

  /// No description provided for @executionQualityDisclaimer.
  ///
  /// In en, this message translates to:
  /// **'Simulation does not guarantee real execution quality.'**
  String get executionQualityDisclaimer;

  /// No description provided for @insufficientDataDisclaimer.
  ///
  /// In en, this message translates to:
  /// **'Risk-adjusted figures are withheld when there were too few observations. Insufficient data is not zero.'**
  String get insufficientDataDisclaimer;

  /// No description provided for @retry.
  ///
  /// In en, this message translates to:
  /// **'Try again'**
  String get retry;

  /// No description provided for @riskTitle.
  ///
  /// In en, this message translates to:
  /// **'Risk'**
  String get riskTitle;

  /// No description provided for @riskSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Halt status and mirror freshness for your organisation.'**
  String get riskSubtitle;

  /// No description provided for @riskEngineOn.
  ///
  /// In en, this message translates to:
  /// **'Risk engine is in the order path'**
  String get riskEngineOn;

  /// No description provided for @riskEngineOff.
  ///
  /// In en, this message translates to:
  /// **'Risk engine disabled - local tooling mode'**
  String get riskEngineOff;

  /// No description provided for @riskFailClosedLabel.
  ///
  /// In en, this message translates to:
  /// **'Fail-closed'**
  String get riskFailClosedLabel;

  /// No description provided for @riskCadenceLabel.
  ///
  /// In en, this message translates to:
  /// **'Refresh / staleness budget'**
  String get riskCadenceLabel;

  /// No description provided for @riskCadenceWarn.
  ///
  /// In en, this message translates to:
  /// **'Snapshot refresh does not outpace the staleness budget; expect denials on freshness.'**
  String get riskCadenceWarn;

  /// No description provided for @riskReadOnlyNotice.
  ///
  /// In en, this message translates to:
  /// **'Read-only by design. Engaging or clearing a switch lives in the admin console, behind reasons and typed confirmations.'**
  String get riskReadOnlyNotice;

  /// No description provided for @riskPanelsDegraded.
  ///
  /// In en, this message translates to:
  /// **'Some risk panels could not be loaded. Pull down to try again.'**
  String get riskPanelsDegraded;

  /// No description provided for @riskMirrorSection.
  ///
  /// In en, this message translates to:
  /// **'Latest mirror by account'**
  String get riskMirrorSection;

  /// No description provided for @riskSwitchesSection.
  ///
  /// In en, this message translates to:
  /// **'Engaged switches'**
  String get riskSwitchesSection;

  /// No description provided for @riskEventsSection.
  ///
  /// In en, this message translates to:
  /// **'Recent risk events'**
  String get riskEventsSection;

  /// No description provided for @riskNoMirror.
  ///
  /// In en, this message translates to:
  /// **'No mirrored account state yet. Until the risk-state worker syncs, the engine denies new orders - that is fail-closed working, not a blank-screen bug.'**
  String get riskNoMirror;

  /// No description provided for @riskNoSwitches.
  ///
  /// In en, this message translates to:
  /// **'Nothing is halted. The absence of rows is health here.'**
  String get riskNoSwitches;

  /// No description provided for @riskNoEvents.
  ///
  /// In en, this message translates to:
  /// **'No risk events recorded.'**
  String get riskNoEvents;

  /// No description provided for @riskEngagedStopsLabel.
  ///
  /// In en, this message translates to:
  /// **'Engaged stops'**
  String get riskEngagedStopsLabel;

  /// No description provided for @riskTriggeredProtectionsLabel.
  ///
  /// In en, this message translates to:
  /// **'Triggered protections'**
  String get riskTriggeredProtectionsLabel;

  /// No description provided for @riskStaleMirrorsLabel.
  ///
  /// In en, this message translates to:
  /// **'Stale mirrors'**
  String get riskStaleMirrorsLabel;

  /// No description provided for @riskSevereEventsLabel.
  ///
  /// In en, this message translates to:
  /// **'Severe events (24h)'**
  String get riskSevereEventsLabel;

  /// No description provided for @riskSnapshotLabel.
  ///
  /// In en, this message translates to:
  /// **'Snapshot'**
  String get riskSnapshotLabel;

  /// No description provided for @riskCapturedLabel.
  ///
  /// In en, this message translates to:
  /// **'Captured'**
  String get riskCapturedLabel;

  /// No description provided for @riskEquityLabel.
  ///
  /// In en, this message translates to:
  /// **'Equity'**
  String get riskEquityLabel;

  /// No description provided for @riskDayPnlLabel.
  ///
  /// In en, this message translates to:
  /// **'Net day PnL'**
  String get riskDayPnlLabel;

  /// No description provided for @riskGrossLabel.
  ///
  /// In en, this message translates to:
  /// **'Gross notional'**
  String get riskGrossLabel;

  /// No description provided for @riskOpenOrdersLabel.
  ///
  /// In en, this message translates to:
  /// **'Open orders'**
  String get riskOpenOrdersLabel;

  /// No description provided for @riskStaleSourcesLabel.
  ///
  /// In en, this message translates to:
  /// **'Stale sources'**
  String get riskStaleSourcesLabel;

  /// No description provided for @riskStaleBadge.
  ///
  /// In en, this message translates to:
  /// **'STALE'**
  String get riskStaleBadge;

  /// No description provided for @riskReasonLabel.
  ///
  /// In en, this message translates to:
  /// **'Reason'**
  String get riskReasonLabel;

  /// No description provided for @riskEngagedManualLabel.
  ///
  /// In en, this message translates to:
  /// **'manual halt'**
  String get riskEngagedManualLabel;

  /// No description provided for @riskExplicitClearNotice.
  ///
  /// In en, this message translates to:
  /// **'This protection was triggered by the engine. It cannot be cleared from this app; acknowledge-and-clear lives in the admin console, behind a typed confirmation.'**
  String get riskExplicitClearNotice;

  /// No description provided for @riskDisclaimer.
  ///
  /// In en, this message translates to:
  /// **'Risk controls reduce operational risk but cannot guarantee against all losses.'**
  String get riskDisclaimer;
}

class _AppLocalizationsDelegate extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) => <String>['bn', 'en'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {


  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'bn': return AppLocalizationsBn();
    case 'en': return AppLocalizationsEn();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.'
  );
}
```

FILE: apps/mobile/lib/l10n/app_localizations_bn.dart

```dart
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Bengali Bangla (`bn`).
class AppLocalizationsBn extends AppLocalizations {
  AppLocalizationsBn([String locale = 'bn']) : super(locale);

  @override
  String get appTitle => 'কপি ট্রেডিং';

  @override
  String get signIn => 'সাইন ইন';

  @override
  String get signOut => 'সাইন আউট';

  @override
  String get emailLabel => 'ইমেইল';

  @override
  String get passwordLabel => 'পাসওয়ার্ড';

  @override
  String get signInSubtitle => 'চালিয়ে যেতে আপনার অ্যাকাউন্টে সাইন ইন করুন।';

  @override
  String get twoFactorTitle => 'দুই-ধাপ যাচাইকরণ';

  @override
  String get twoFactorSubtitle => 'আপনার অথেন্টিকেটর অ্যাপ থেকে ছয় সংখ্যার কোডটি লিখুন।';

  @override
  String get twoFactorCodeLabel => 'যাচাইকরণ কোড';

  @override
  String get recoveryCodeLabel => 'রিকভারি কোড';

  @override
  String get useRecoveryCode => 'পরিবর্তে রিকভারি কোড ব্যবহার করুন';

  @override
  String get useAuthenticator => 'পরিবর্তে অথেন্টিকেটর অ্যাপ ব্যবহার করুন';

  @override
  String get verify => 'যাচাই করুন';

  @override
  String get cancel => 'বাতিল';

  @override
  String get homeTitle => 'সারসংক্ষেপ';

  @override
  String get settingsTitle => 'সেটিংস';

  @override
  String get securityTitle => 'নিরাপত্তা';

  @override
  String get loading => 'লোড হচ্ছে';

  @override
  String get emailRequired => 'আপনার ইমেইল ঠিকানা লিখুন';

  @override
  String get emailInvalid => 'একটি সঠিক ইমেইল ঠিকানা লিখুন';

  @override
  String get passwordRequired => 'আপনার পাসওয়ার্ড লিখুন';

  @override
  String get codeRequired => 'আপনার যাচাইকরণ কোড লিখুন';

  @override
  String get genericError => 'কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।';

  @override
  String get sessionExpired => 'আপনার সেশনের মেয়াদ শেষ হয়েছে। আবার সাইন ইন করুন।';

  @override
  String get welcomeBack => 'স্বাগতম';

  @override
  String get accountSection => 'অ্যাকাউন্ট';

  @override
  String get securitySection => 'নিরাপত্তা';

  @override
  String get twoFactorEnabled => 'দুই-ধাপ যাচাইকরণ চালু আছে';

  @override
  String get twoFactorDisabled => 'দুই-ধাপ যাচাইকরণ বন্ধ আছে';

  @override
  String get activeSessions => 'সক্রিয় ডিভাইস';

  @override
  String get changePassword => 'পাসওয়ার্ড পরিবর্তন করুন';

  @override
  String get executionDisabledNotice => 'এই বিল্ডে লাইভ অর্ডার এক্সিকিউশন বন্ধ রাখা হয়েছে।';

  @override
  String get strategiesTitle => 'স্ট্র্যাটেজি';

  @override
  String get strategiesSubtitle => 'স্ট্র্যাটেজির স্বাস্থ্য ও সিমুলেটেড ফলাফল দেখুন।';

  @override
  String get strategyReadOnlyNotice => 'এই স্ক্রিনটি শুধু দেখার জন্য। স্ট্র্যাটেজি চালু, বন্ধ ও কনফিগার করা হয় অ্যাডমিন কনসোল থেকে।';

  @override
  String get strategyPanelsDegraded => 'কিছু অংশ লোড করা যায়নি। আবার চেষ্টা করতে নিচে টানুন।';

  @override
  String get liveExecutionReachable => 'এই ডিপ্লয়মেন্টে লাইভ এক্সিকিউশনে পৌঁছানো সম্ভব';

  @override
  String get liveExecutionNotReachable => 'এই ডিপ্লয়মেন্টে লাইভ এক্সিকিউশনে পৌঁছানো সম্ভব নয়';

  @override
  String get strategyEngineLabel => 'স্ট্র্যাটেজি ইঞ্জিন';

  @override
  String get paperTradingLabel => 'পেপার ট্রেডিং';

  @override
  String get backtestingLabel => 'ব্যাকটেস্টিং';

  @override
  String get tradingModeLabel => 'মোড';

  @override
  String get strategyInstancesSection => 'ইনস্ট্যান্স';

  @override
  String get paperSessionsSection => 'পেপার সেশন';

  @override
  String get backtestsSection => 'ব্যাকটেস্ট';

  @override
  String get strategyNoInstances => 'কোনো স্ট্র্যাটেজি ইনস্ট্যান্স তৈরি করা হয়নি।';

  @override
  String get strategyNoPaperSessions => 'কোনো পেপার সেশন চালানো হয়নি।';

  @override
  String get strategyNoBacktests => 'কোনো ব্যাকটেস্ট চালানো হয়নি।';

  @override
  String get instancesLabel => 'ইনস্ট্যান্স';

  @override
  String get runningLabel => 'চলমান';

  @override
  String get needsAttentionLabel => 'মনোযোগ প্রয়োজন';

  @override
  String get openIncidentsLabel => 'খোলা ইনসিডেন্ট';

  @override
  String get enabledLabel => 'চালু';

  @override
  String get disabledLabel => 'বন্ধ';

  @override
  String get consecutiveErrorsLabel => 'পরপর ত্রুটি';

  @override
  String get lastHeartbeatLabel => 'সর্বশেষ হার্টবিট';

  @override
  String get noHeartbeatYet => 'এখনো কোনো হার্টবিট আসেনি';

  @override
  String get statusLabel => 'অবস্থা';

  @override
  String get equityLabel => 'ইকুইটি';

  @override
  String get realisedPnlLabel => 'রিয়েলাইজড লাভ/ক্ষতি';

  @override
  String get netPnlLabel => 'নিট লাভ/ক্ষতি';

  @override
  String get tradesLabel => 'ট্রেড';

  @override
  String get winRateLabel => 'উইন রেট';

  @override
  String get sharpeLabel => 'শার্প';

  @override
  String get maxDrawdownLabel => 'সর্বোচ্চ ড্রডাউন';

  @override
  String get simulatedFillsLabel => 'অর্ডার / ফিল';

  @override
  String get riskRejectionsLabel => 'ঝুঁকি প্রত্যাখ্যান';

  @override
  String get simulatedBadge => 'সিমুলেটেড';

  @override
  String get insufficientData => 'পর্যাপ্ত তথ্য নেই';

  @override
  String get notAvailableShort => 'প্রযোজ্য নয়';

  @override
  String get statusQueued => 'সারিতে';

  @override
  String get statusRunning => 'চলমান';

  @override
  String get statusCompleted => 'সম্পন্ন';

  @override
  String get statusStopped => 'বন্ধ';

  @override
  String get statusFailed => 'ব্যর্থ';

  @override
  String get statusCancelled => 'বাতিল';

  @override
  String get backtestNotReproducible => 'এই রানের ডেটাসেট চেকসাম নেই, তাই হুবহু পুনরায় তৈরি করা যাবে না।';

  @override
  String get simulationDisclaimerTitle => 'এই সংখ্যাগুলো সম্পর্কে';

  @override
  String get backtestDisclaimer => 'ব্যাকটেস্ট পারফরম্যান্স ভবিষ্যৎ পারফরম্যান্সের নির্দেশক নয়।';

  @override
  String get paperDisclaimer => 'পেপার পারফরম্যান্স লাইভ পারফরম্যান্সের নির্দেশক নয়।';

  @override
  String get executionQualityDisclaimer => 'সিমুলেশন প্রকৃত এক্সিকিউশন মান নিশ্চিত করে না।';

  @override
  String get insufficientDataDisclaimer => 'পর্যবেক্ষণ কম হলে ঝুঁকি-সমন্বিত পরিসংখ্যান দেখানো হয় না। পর্যাপ্ত তথ্য না থাকা মানে শূন্য নয়।';

  @override
  String get retry => 'আবার চেষ্টা করুন';

  @override
  String get riskTitle => 'ঝুঁকি';

  @override
  String get riskSubtitle => 'আপনার সংগঠনের হাল্ট অবস্থা ও মিরর সাম্প্রতিকতা।';

  @override
  String get riskEngineOn => 'ঝুঁকি ইঞ্জিন অর্ডার-পাথে সক্রিয়';

  @override
  String get riskEngineOff => 'ঝুঁকি ইঞ্জিন নিষ্ক্রিয় — শুধু লোকাল টুলিং মোড';

  @override
  String get riskFailClosedLabel => 'ফেল-ক্লোজড';

  @override
  String get riskCadenceLabel => 'রিফ্রেশ / স্টেলনেস বাজেট';

  @override
  String get riskCadenceWarn => 'স্ন্যাপশট রিফ্রেশ স্টেলনেস বাজেটকে ছাড়িয়ে যায় না; সাম্প্রতিকতার ভিত্তিতে প্রত্যাখ্যানের প্রত্যাশা করুন।';

  @override
  String get riskReadOnlyNotice => 'ডিজাইনেই শুধু-পড়া। সুইচ চালু বা বন্ধ করা অ্যাডমিন কনসোলে থাকে — লিখিত কারণ ও টাইপ-করা নিশ্চিতকরণের আড়ালে।';

  @override
  String get riskPanelsDegraded => 'কিছু ঝুঁকি প্যানেল লোড করা যায়নি। আবার চেষ্টায় নিচের দিকে টানুন।';

  @override
  String get riskMirrorSection => 'অ্যাকাউন্ট অনুযায়ী সর্বশেষ মিরর';

  @override
  String get riskSwitchesSection => 'সক্রিয় সুইচ';

  @override
  String get riskEventsSection => 'সাম্প্রতিক ঝুঁকি ইভেন্ট';

  @override
  String get riskNoMirror => 'এখনো কোনো অ্যাকাউন্ট মিরর নেই। ঝুঁকি-অবস্থা ওয়ার্কার সিঙ্ক না করা পর্যন্ত ইঞ্জিন নতুন অর্ডার প্রত্যাখ্যান করবে — এটি ফেল-ক্লোজড কাজ করছে, ফাঁকা স্ক্রিনের ত্রুটি নয়।';

  @override
  String get riskNoSwitches => 'কিছুই হাল্ট করা নেই। এখানে সারির অভাবই সুস্বাস্থ্যের লক্ষণ।';

  @override
  String get riskNoEvents => 'কোনো ঝুঁকি ইভেন্ট রেকর্ড হয়নি।';

  @override
  String get riskEngagedStopsLabel => 'সক্রিয় স্টপ';

  @override
  String get riskTriggeredProtectionsLabel => 'ট্রিগার হওয়া সুরক্ষা';

  @override
  String get riskStaleMirrorsLabel => 'পুরোনো মিরর';

  @override
  String get riskSevereEventsLabel => 'গুরুতর ইভেন্ট (২৪ ঘণ্টা)';

  @override
  String get riskSnapshotLabel => 'স্ন্যাপশট';

  @override
  String get riskCapturedLabel => 'ক্যাপচার';

  @override
  String get riskEquityLabel => 'ইকিউটি';

  @override
  String get riskDayPnlLabel => 'দিনের নিট PnL';

  @override
  String get riskGrossLabel => 'গ্রস নোশনাল';

  @override
  String get riskOpenOrdersLabel => 'খোলা অর্ডার';

  @override
  String get riskStaleSourcesLabel => 'পুরোনো সোর্স';

  @override
  String get riskStaleBadge => 'পুরোনো';

  @override
  String get riskReasonLabel => 'কারণ';

  @override
  String get riskEngagedManualLabel => 'ম্যানুয়াল হাল্ট';

  @override
  String get riskExplicitClearNotice => 'এই সুরক্ষা ইঞ্জিন ট্রিগার করেছে। এই অ্যাপ থেকে এটি খোলা যাবে না; acknowledge-and-clear অ্যাডমিন কনসোলে আছে, টাইপ-করা নিশ্চিতকরণের আড়ালে।';

  @override
  String get riskDisclaimer => 'ঝুঁকি নিয়ন্ত্রণ অপারেশনগত ঝুঁকি কমায়, কিন্তু সব ক্ষতি থেকে রক্ষার নিশ্চয়তা দিতে পারে না।';
}
```

FILE: apps/mobile/lib/l10n/app_localizations_en.dart

```dart
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'Copy Trading';

  @override
  String get signIn => 'Sign in';

  @override
  String get signOut => 'Sign out';

  @override
  String get emailLabel => 'Email';

  @override
  String get passwordLabel => 'Password';

  @override
  String get signInSubtitle => 'Sign in to your account to continue.';

  @override
  String get twoFactorTitle => 'Two-factor authentication';

  @override
  String get twoFactorSubtitle => 'Enter the six-digit code from your authenticator app.';

  @override
  String get twoFactorCodeLabel => 'Authentication code';

  @override
  String get recoveryCodeLabel => 'Recovery code';

  @override
  String get useRecoveryCode => 'Use a recovery code instead';

  @override
  String get useAuthenticator => 'Use my authenticator app instead';

  @override
  String get verify => 'Verify';

  @override
  String get cancel => 'Cancel';

  @override
  String get homeTitle => 'Overview';

  @override
  String get settingsTitle => 'Settings';

  @override
  String get securityTitle => 'Security';

  @override
  String get loading => 'Loading';

  @override
  String get emailRequired => 'Enter your email address';

  @override
  String get emailInvalid => 'Enter a valid email address';

  @override
  String get passwordRequired => 'Enter your password';

  @override
  String get codeRequired => 'Enter your authentication code';

  @override
  String get genericError => 'Something went wrong. Please try again.';

  @override
  String get sessionExpired => 'Your session has expired. Please sign in again.';

  @override
  String get welcomeBack => 'Welcome back';

  @override
  String get accountSection => 'Account';

  @override
  String get securitySection => 'Security';

  @override
  String get twoFactorEnabled => 'Two-factor authentication is on';

  @override
  String get twoFactorDisabled => 'Two-factor authentication is off';

  @override
  String get activeSessions => 'Active devices';

  @override
  String get changePassword => 'Change password';

  @override
  String get executionDisabledNotice => 'Live order execution is disabled on this build.';

  @override
  String get strategiesTitle => 'Strategies';

  @override
  String get strategiesSubtitle => 'View strategy health and simulated results.';

  @override
  String get strategyReadOnlyNotice => 'This screen is read-only. Strategies are started, stopped and configured from the admin console.';

  @override
  String get strategyPanelsDegraded => 'Some panels could not be loaded. Pull down to try again.';

  @override
  String get liveExecutionReachable => 'Live execution is reachable in this deployment';

  @override
  String get liveExecutionNotReachable => 'Live execution is not reachable in this deployment';

  @override
  String get strategyEngineLabel => 'Strategy engine';

  @override
  String get paperTradingLabel => 'Paper trading';

  @override
  String get backtestingLabel => 'Backtesting';

  @override
  String get tradingModeLabel => 'Mode';

  @override
  String get strategyInstancesSection => 'Instances';

  @override
  String get paperSessionsSection => 'Paper sessions';

  @override
  String get backtestsSection => 'Backtests';

  @override
  String get strategyNoInstances => 'No strategy instances have been created.';

  @override
  String get strategyNoPaperSessions => 'No paper sessions have been run.';

  @override
  String get strategyNoBacktests => 'No backtests have been run.';

  @override
  String get instancesLabel => 'Instances';

  @override
  String get runningLabel => 'Running';

  @override
  String get needsAttentionLabel => 'Needs attention';

  @override
  String get openIncidentsLabel => 'Open incidents';

  @override
  String get enabledLabel => 'Enabled';

  @override
  String get disabledLabel => 'Disabled';

  @override
  String get consecutiveErrorsLabel => 'Consecutive errors';

  @override
  String get lastHeartbeatLabel => 'Last heartbeat';

  @override
  String get noHeartbeatYet => 'No heartbeat reported yet';

  @override
  String get statusLabel => 'Status';

  @override
  String get equityLabel => 'Equity';

  @override
  String get realisedPnlLabel => 'Realised PnL';

  @override
  String get netPnlLabel => 'Net PnL';

  @override
  String get tradesLabel => 'Trades';

  @override
  String get winRateLabel => 'Win rate';

  @override
  String get sharpeLabel => 'Sharpe';

  @override
  String get maxDrawdownLabel => 'Max drawdown';

  @override
  String get simulatedFillsLabel => 'Orders / fills';

  @override
  String get riskRejectionsLabel => 'Risk rejections';

  @override
  String get simulatedBadge => 'SIMULATED';

  @override
  String get insufficientData => 'Insufficient data';

  @override
  String get notAvailableShort => 'N/A';

  @override
  String get statusQueued => 'Queued';

  @override
  String get statusRunning => 'Running';

  @override
  String get statusCompleted => 'Completed';

  @override
  String get statusStopped => 'Stopped';

  @override
  String get statusFailed => 'Failed';

  @override
  String get statusCancelled => 'Cancelled';

  @override
  String get backtestNotReproducible => 'This run has no dataset checksum and cannot be reproduced exactly.';

  @override
  String get simulationDisclaimerTitle => 'About these numbers';

  @override
  String get backtestDisclaimer => 'Backtest performance is not indicative of future performance.';

  @override
  String get paperDisclaimer => 'Paper performance is not indicative of live performance.';

  @override
  String get executionQualityDisclaimer => 'Simulation does not guarantee real execution quality.';

  @override
  String get insufficientDataDisclaimer => 'Risk-adjusted figures are withheld when there were too few observations. Insufficient data is not zero.';

  @override
  String get retry => 'Try again';

  @override
  String get riskTitle => 'Risk';

  @override
  String get riskSubtitle => 'Halt status and mirror freshness for your organisation.';

  @override
  String get riskEngineOn => 'Risk engine is in the order path';

  @override
  String get riskEngineOff => 'Risk engine disabled - local tooling mode';

  @override
  String get riskFailClosedLabel => 'Fail-closed';

  @override
  String get riskCadenceLabel => 'Refresh / staleness budget';

  @override
  String get riskCadenceWarn => 'Snapshot refresh does not outpace the staleness budget; expect denials on freshness.';

  @override
  String get riskReadOnlyNotice => 'Read-only by design. Engaging or clearing a switch lives in the admin console, behind reasons and typed confirmations.';

  @override
  String get riskPanelsDegraded => 'Some risk panels could not be loaded. Pull down to try again.';

  @override
  String get riskMirrorSection => 'Latest mirror by account';

  @override
  String get riskSwitchesSection => 'Engaged switches';

  @override
  String get riskEventsSection => 'Recent risk events';

  @override
  String get riskNoMirror => 'No mirrored account state yet. Until the risk-state worker syncs, the engine denies new orders - that is fail-closed working, not a blank-screen bug.';

  @override
  String get riskNoSwitches => 'Nothing is halted. The absence of rows is health here.';

  @override
  String get riskNoEvents => 'No risk events recorded.';

  @override
  String get riskEngagedStopsLabel => 'Engaged stops';

  @override
  String get riskTriggeredProtectionsLabel => 'Triggered protections';

  @override
  String get riskStaleMirrorsLabel => 'Stale mirrors';

  @override
  String get riskSevereEventsLabel => 'Severe events (24h)';

  @override
  String get riskSnapshotLabel => 'Snapshot';

  @override
  String get riskCapturedLabel => 'Captured';

  @override
  String get riskEquityLabel => 'Equity';

  @override
  String get riskDayPnlLabel => 'Net day PnL';

  @override
  String get riskGrossLabel => 'Gross notional';

  @override
  String get riskOpenOrdersLabel => 'Open orders';

  @override
  String get riskStaleSourcesLabel => 'Stale sources';

  @override
  String get riskStaleBadge => 'STALE';

  @override
  String get riskReasonLabel => 'Reason';

  @override
  String get riskEngagedManualLabel => 'manual halt';

  @override
  String get riskExplicitClearNotice => 'This protection was triggered by the engine. It cannot be cleared from this app; acknowledge-and-clear lives in the admin console, behind a typed confirmation.';

  @override
  String get riskDisclaimer => 'Risk controls reduce operational risk but cannot guarantee against all losses.';
}
```

FILE: apps/mobile/lib/main.dart

```dart
import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'core/config/app_config.dart';
import 'core/di/providers.dart';
import 'core/logging/app_logger.dart';

/// Application entry point.
///
/// Configuration is validated before the first frame so a misconfigured build
/// fails immediately and visibly instead of failing later as a mystery network
/// error. Uncaught errors are routed through [AppLogger], which redacts
/// sensitive values before anything reaches the device log.
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await SystemChrome.setPreferredOrientations(<DeviceOrientation>[
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  final AppConfig config = AppConfig.fromEnvironment();
  final AppLogger logger = AppLogger(config.environment);

  FlutterError.onError = (FlutterErrorDetails details) {
    logger.error(
      'flutter.uncaught_error',
      error: details.exception,
      stackTrace: details.stack,
      context: <String, Object?>{'library': details.library},
    );

    if (kDebugMode) {
      FlutterError.presentError(details);
    }
  };

  PlatformDispatcher.instance.onError = (Object error, StackTrace stack) {
    logger.error('platform.uncaught_error', error: error, stackTrace: stack);
    return true;
  };

  runZonedGuarded<void>(
    () {
      runApp(
        ProviderScope(
          overrides: <Override>[
            // The already-validated config is injected so it is parsed once.
            appConfigProvider.overrideWithValue(config),
          ],
          child: const WlctApp(),
        ),
      );
    },
    (Object error, StackTrace stack) {
      logger.error('zone.uncaught_error', error: error, stackTrace: stack);
    },
  );
}
```

FILE: apps/mobile/pubspec.yaml

```yaml
name: wlct_mobile
description: White-label copy trading mobile client. Part 1 foundation.
publish_to: "none"
version: 1.0.0+1

environment:
  sdk: ">=3.4.0 <4.0.0"
  flutter: ">=3.22.0"

dependencies:
  flutter:
    sdk: flutter
  flutter_localizations:
    sdk: flutter

  # State management and dependency injection.
  flutter_riverpod: ^2.5.1

  # Networking.
  dio: ^5.7.0

  # Routing.
  go_router: ^14.2.7

  # Storage. Tokens go to the Keychain / EncryptedSharedPreferences only.
  flutter_secure_storage: ^9.2.2
  shared_preferences: ^2.3.2

  # Platform metadata used for device binding and diagnostics.
  device_info_plus: ^10.1.2
  package_info_plus: ^8.0.2

  # Value equality for immutable models and states.
  equatable: ^2.0.5
  intl: ^0.19.0
  uuid: ^4.5.1

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^4.0.0
  mocktail: ^1.0.4

flutter:
  uses-material-design: true
  generate: true
```

FILE: apps/mobile/test/auth_state_test.dart

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:wlct_mobile/core/error/app_exception.dart';
import 'package:wlct_mobile/core/logging/app_logger.dart';
import 'package:wlct_mobile/features/auth/domain/auth_models.dart';
import 'package:wlct_mobile/features/auth/presentation/auth_state.dart';

void main() {
  group('AuthState', () {
    test('starts in the initialising state', () {
      const AuthState state = AuthState.initial();

      expect(state.status, AuthStatus.initialising);
      expect(state.isAuthenticated, isFalse);
      expect(state.user, isNull);
    });

    test('clearError removes the error without touching the user', () {
      const AuthUser user = AuthUser(
        id: 'user-1',
        tenantId: 'tenant-1',
        email: 'operator@example.test',
        status: UserStatus.active,
        twoFactorEnabled: true,
        roles: <String>['TENANT_ADMIN'],
        permissions: <String>['user:read'],
      );

      const AuthState state = AuthState(
        status: AuthStatus.authenticated,
        user: user,
        error: AppException(code: AppErrorCode.network, message: 'offline'),
      );

      final AuthState cleared = state.copyWith(clearError: true);

      expect(cleared.error, isNull);
      expect(cleared.user, user);
      expect(cleared.isAuthenticated, isTrue);
    });

    test('clearChallenge drops the challenge token and its methods', () {
      const AuthState state = AuthState(
        status: AuthStatus.awaitingTwoFactor,
        challengeToken: 'challenge-token',
        twoFactorMethods: <String>['TOTP'],
      );

      final AuthState cleared = state.copyWith(clearChallenge: true);

      expect(cleared.challengeToken, isNull);
      expect(cleared.twoFactorMethods, isEmpty);
    });
  });

  group('AuthUser.can', () {
    const AuthUser user = AuthUser(
      id: 'user-1',
      tenantId: 'tenant-1',
      email: 'trader@example.test',
      status: UserStatus.active,
      twoFactorEnabled: false,
      roles: <String>['TRADER'],
      permissions: <String>['order:read', 'strategy:*'],
    );

    test('matches an exact permission', () {
      expect(user.can('order:read'), isTrue);
    });

    test('matches a resource wildcard', () {
      expect(user.can('strategy:manage'), isTrue);
    });

    test('denies anything not granted', () {
      expect(user.can('tenant:manage'), isFalse);
    });
  });

  group('AppLogger.redact', () {
    test('masks credential-like keys at every depth', () {
      final Map<String, Object?> redacted = AppLogger.redact(<String, Object?>{
        'email': 'user@example.test',
        'password': 'super-secret',
        'tokens': <String, Object?>{'accessToken': 'jwt', 'refreshToken': 'jwt'},
        'apiSecret': 'exchange-secret',
      });

      expect(redacted['email'], 'user@example.test');
      expect(redacted['password'], '[REDACTED]');
      expect(redacted['apiSecret'], '[REDACTED]');
      expect(
        (redacted['tokens']! as Map<String, Object?>)['accessToken'],
        '[REDACTED]',
      );
    });
  });

  group('AppErrorCode.fromApiCode', () {
    test('maps known API codes', () {
      expect(AppErrorCode.fromApiCode('VALIDATION_ERROR', 400), AppErrorCode.validation);
      expect(AppErrorCode.fromApiCode('ACCOUNT_LOCKED', 423), AppErrorCode.accountLocked);
      expect(AppErrorCode.fromApiCode('RATE_LIMIT_EXCEEDED', 429), AppErrorCode.rateLimited);
    });

    test('falls back to the status code', () {
      expect(AppErrorCode.fromApiCode(null, 503), AppErrorCode.server);
      expect(AppErrorCode.fromApiCode('SOMETHING_NEW', 403), AppErrorCode.forbidden);
    });
  });
}
```

FILE: apps/mobile/test/strategy_view_test.dart

```dart
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:wlct_mobile/features/strategies/domain/strategy_models.dart';
import 'package:wlct_mobile/features/strategies/presentation/strategy_state.dart';

/// Safety and parsing tests for the mobile strategy viewer.
///
/// The first group is the important one: it asserts, from the source itself,
/// that the mobile client has no write path into the strategy layer. A unit
/// test cannot prove the absence of a capability by calling it, so it reads
/// the repository and fails if a mutating verb ever appears.
void main() {
  group('mobile strategy layer is read-only', () {
    final File repository =
        File('lib/features/strategies/data/strategy_repository.dart');

    test('the repository source exists where the test expects it', () {
      expect(
        repository.existsSync(),
        isTrue,
        reason: 'Run these tests from apps/mobile so the relative path resolves.',
      );
    });

    test('the repository issues no POST, PATCH, PUT or DELETE', () {
      final String source = repository.readAsStringSync();

      expect(source.contains('_apiClient.post'), isFalse);
      expect(source.contains('_apiClient.patch'), isFalse);
      expect(source.contains('_apiClient.put'), isFalse);
      expect(source.contains('_apiClient.delete'), isFalse);
    });

    test('the repository names no enable, disable, start or stop operation', () {
      final String source = repository.readAsStringSync().toLowerCase();

      for (final String forbidden in <String>[
        'future<void> enable',
        'future<void> disable',
        'startsession',
        'stopsession',
        'submitbacktest',
      ]) {
        expect(source.contains(forbidden), isFalse, reason: forbidden);
      }
    });

    test('the controller exposes only load and refresh', () {
      final String source =
          File('lib/features/strategies/presentation/strategy_controller.dart')
              .readAsStringSync();

      expect(source.contains('Future<void> load()'), isTrue);
      expect(source.contains('Future<void> refresh()'), isTrue);
      expect(source.contains('Future<void> enable'), isFalse);
      expect(source.contains('Future<void> disable'), isFalse);
    });
  });

  group('StrategyOverview', () {
    test('reads the execution boundary and the flags', () {
      final StrategyOverview overview =
          StrategyOverview.fromJson(const <String, Object?>{
        'instances': <String, Object?>{
          'total': 3,
          'enabled': 2,
          'running': 1,
          'quarantined': 1,
          'unhealthy': 0,
        },
        'incidents': <String, Object?>{'open': 2, 'critical': 1},
        'paperSessions': <String, Object?>{'running': 1},
        'backtests': <String, Object?>{'queued': 4},
        'configuration': <String, Object?>{
          'strategyEngineEnabled': true,
          'paperTradingEnabled': true,
          'backtestEnabled': false,
          'tradingMode': 'PAPER',
          'liveExecutionReachable': false,
        },
        'latencyNote': 'Not a guarantee.',
        'disclaimer': 'SIMULATED.',
      });

      expect(overview.totalInstances, 3);
      expect(overview.quarantinedInstances, 1);
      expect(overview.criticalIncidents, 1);
      expect(overview.tradingMode, 'PAPER');
      expect(overview.liveExecutionReachable, isFalse);
      expect(overview.backtestEnabled, isFalse);
    });

    test('a malformed payload degrades to zeros rather than throwing', () {
      final StrategyOverview overview =
          StrategyOverview.fromJson(const <String, Object?>{});

      expect(overview.totalInstances, 0);
      expect(overview.liveExecutionReachable, isFalse);
      expect(overview.tradingMode, 'UNKNOWN');
    });
  });

  group('PaperSessionSummary', () {
    test('keeps decimals as strings and reads the simulated label', () {
      final PaperSessionSummary session =
          PaperSessionSummary.fromJson(const <String, Object?>{
        'id': 'session-1',
        'sessionIdentifier': 'paper-000000000001',
        'status': 'RUNNING',
        'strategyKey': 'DETERMINISTIC_IMBALANCE_V1',
        'symbol': 'BTC-USDT',
        'initialCapital': '10000.000000',
        'realisedPnl': '-12.500000',
        'feesPaid': '3.250000',
        'currentEquity': '9987.500000',
        'simulatedOrders': 4,
        'simulatedFills': 3,
        'riskRejections': 1,
        'isSimulated': true,
        'startedAt': '2026-09-07T10:00:00.000Z',
      });

      expect(session.status, SimulationStatus.running);
      expect(session.realisedPnl, '-12.500000');
      expect(session.currentEquity, '9987.500000');
      expect(session.isSimulated, isTrue);
    });

    test('treats a missing simulated label as simulated', () {
      final PaperSessionSummary session =
          PaperSessionSummary.fromJson(const <String, Object?>{
        'id': 'session-2',
        'sessionIdentifier': 'paper-000000000002',
        'status': 'STOPPED',
      });

      expect(session.isSimulated, isTrue);
    });
  });

  group('BacktestSummary', () {
    test('withheld metrics stay null rather than becoming zero', () {
      final BacktestSummary backtest =
          BacktestSummary.fromJson(const <String, Object?>{
        'id': 'backtest-1',
        'runIdentifier': 'bt-000000000000000000000001',
        'status': 'COMPLETED',
        'strategyKey': 'DETERMINISTIC_IMBALANCE_V1',
        'strategyVersion': '1.0.0',
        'symbol': 'BTC-USDT',
        'isReproducible': true,
        'queuedAt': '2026-09-07T09:00:00.000Z',
        'result': <String, Object?>{
          'netPnl': '15.250000',
          'totalTrades': 4,
          'winRate': null,
          'sharpeRatio': null,
          'hasSufficientObservations': false,
        },
      });

      expect(backtest.netPnl, '15.250000');
      expect(backtest.totalTrades, 4);
      expect(backtest.winRate, isNull);
      expect(backtest.sharpeRatio, isNull);
      expect(backtest.hasSufficientObservations, isFalse);
    });
  });

  group('StrategyViewState', () {
    test('surfaces the instances that need attention', () {
      const StrategyInstanceSummary healthy = StrategyInstanceSummary(
        id: 'a',
        name: 'Healthy',
        kind: 'DETERMINISTIC_IMBALANCE_V1',
        version: '1.0.0',
        status: StrategyInstanceStatus.running,
        health: StrategyHealth.healthy,
        enabled: true,
        venue: 'BINANCE',
        symbols: <String>['BTC-USDT'],
        consecutiveErrors: 0,
      );

      const StrategyInstanceSummary quarantined = StrategyInstanceSummary(
        id: 'b',
        name: 'Quarantined',
        kind: 'DETERMINISTIC_IMBALANCE_V1',
        version: '1.0.0',
        status: StrategyInstanceStatus.stopped,
        health: StrategyHealth.quarantined,
        enabled: false,
        venue: 'BINANCE',
        symbols: <String>['ETH-USDT'],
        consecutiveErrors: 5,
      );

      const StrategyViewState state = StrategyViewState(
        status: StrategyViewStatus.ready,
        instances: <StrategyInstanceSummary>[healthy, quarantined],
      );

      expect(state.attentionInstances, <StrategyInstanceSummary>[quarantined]);
      expect(state.hasAnyData, isTrue);
      expect(state.isDegraded, isFalse);
    });

    test('a partial failure is degraded, not failed', () {
      const StrategyViewState state = StrategyViewState(
        status: StrategyViewStatus.ready,
        degradedPanels: <String>['backtests'],
      );

      expect(state.isDegraded, isTrue);
      expect(state.status, StrategyViewStatus.ready);
    });
  });
}
```


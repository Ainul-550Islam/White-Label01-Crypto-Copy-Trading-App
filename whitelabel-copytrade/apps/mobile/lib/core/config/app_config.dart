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

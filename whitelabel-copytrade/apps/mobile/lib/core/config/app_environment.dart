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

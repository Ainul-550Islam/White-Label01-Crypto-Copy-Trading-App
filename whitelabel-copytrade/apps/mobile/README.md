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

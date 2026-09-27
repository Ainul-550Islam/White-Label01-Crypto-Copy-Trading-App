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

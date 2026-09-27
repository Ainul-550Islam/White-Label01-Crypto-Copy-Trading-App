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

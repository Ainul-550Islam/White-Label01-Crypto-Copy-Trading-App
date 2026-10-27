import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'core/router/app_router.dart';
import 'core/di/providers.dart';
import 'features/settings/data/user_preferences_repository.dart';
import 'features/notifications/presentation/push_registration_observer.dart';
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
    final UserPreferences? preferences =
        ref.watch(userPreferencesProvider).asData?.value;

    return MaterialApp.router(
      title: tokens.appName,
      debugShowCheckedModeBanner: false,
      routerConfig: router,
      builder: (BuildContext context, Widget? child) => PushRegistrationObserver(child: child ?? const SizedBox.shrink()),
      theme: AppTheme.light(tokens),
      darkTheme: AppTheme.dark(tokens),
      themeMode: tokens.themeMode,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      locale: preferences == null ? null : Locale(preferences.locale),
      localeResolutionCallback: (Locale? locale, Iterable<Locale> supported) {
        if (locale == null) {
          return const Locale('en');
        }

        for (final Locale candidate in supported) {
          if (candidate.languageCode == locale.languageCode) {
            return candidate;
          }
        }

        return const Locale('en');
      },
    );
  }
}

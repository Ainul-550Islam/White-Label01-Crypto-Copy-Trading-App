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

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

// # Responsibility: batch-level guard over the Batch 05 mobile surfaces — every new screen is reachable, every endpoint it calls exists in ApiEndpoints, no money is parsed into a double, and no screen offers a write the API does not expose.
//
// This test reads the source files rather than pumping widgets: the build has no
// Flutter SDK here, and the properties being asserted (route reachability, a
// forbidden API call, a float on a money path) are properties of the source, not of
// a rendered frame. Each assert names the file it is about, so a failure points at
// the file to fix instead of at this test.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

const String _root = 'lib';

String _read(String path) {
  final File file = File('$_root/$path');
  expect(file.existsSync(), isTrue, reason: 'missing source file: $path');
  return file.readAsStringSync();
}

/// Comments are stripped before any "this file must not contain X" assertion: a
/// screen whose comment says "never calls double.parse" would otherwise fail its own
/// guard. Block comments are removed first, then line comments.
String _code(String path) {
  return _read(path)
      .replaceAll(RegExp(r'/\*[\s\S]*?\*/'), '')
      .replaceAll(RegExp(r'//[^\n]*'), '');
}

/// The four Batch 05 features and the API routes each one is allowed to call.
const Map<String, List<String>> _featureRoutes = <String, List<String>>{
  'venue_status': <String>['ApiEndpoints.venueStatus'],
  'security_alerts': <String>['ApiEndpoints.securityEvents'],
  'privacy_export': <String>[
    'ApiEndpoints.privacyRequests',
    'ApiEndpoints.privacyRequest(',
    'ApiEndpoints.privacyRequestDownloadToken(',
  ],
  'fee_schedule': <String>['ApiEndpoints.publicFeeSchedule'],
};

const Map<String, String> _featureScreen = <String, String>{
  'venue_status': 'venue_status/presentation/venue_status_screen.dart',
  'security_alerts': 'security_alerts/presentation/login_alerts_screen.dart',
  'privacy_export': 'privacy_export/presentation/data_export_screen.dart',
  'fee_schedule': 'fee_schedule/presentation/fee_schedule_screen.dart',
};

void main() {
  test('every Batch 05 endpoint is declared in ApiEndpoints and used by exactly its feature', () {
    final String endpoints = _read('core/network/api_endpoints.dart');
    for (final String name in <String>[
      'venueStatus',
      'securityEvents',
      'privacyRequests',
      'publicFeeSchedule',
    ]) {
      expect(
        RegExp('static const String $name =').hasMatch(endpoints),
        isTrue,
        reason: '$name is not a const in ApiEndpoints',
      );
    }
    for (final String name in <String>['privacyRequest(', 'privacyRequestDownloadToken(']) {
      expect(
        endpoints.contains('static String $name'),
        isTrue,
        reason: '$name is not a builder in ApiEndpoints',
      );
    }
  });

  test('each feature repository calls only its own endpoints', () {
    _featureRoutes.forEach((String feature, List<String> allowed) {
      final String repository = _code('features/$feature/data/${_repositoryName(feature)}');
      final Iterable<RegExpMatch> calls =
          RegExp(r'ApiEndpoints\.\w+[(\s,;]').allMatches(repository);
      expect(calls, isNotEmpty, reason: '$feature repository calls no endpoint at all');
      for (final RegExpMatch call in calls) {
        final String matched = call.group(0)!.trim();
        expect(
          allowed.any((String prefix) => matched.startsWith(prefix.replaceAll(RegExp(r'[(\s,;]$'), ''))),
          isTrue,
          reason: '$feature must not call $matched',
        );
      }
    });
  });

  test('no Batch 05 file parses money into a double', () {
    final RegExp forbidden = RegExp(r'double\.(parse|tryParse)|parseFloat|toStringAsFixed');
    for (final String feature in _featureRoutes.keys) {
      for (final FileSystemEntity entity in Directory('$_root/features/$feature').listSync(recursive: true)) {
        if (entity is! File || !entity.path.endsWith('.dart')) continue;
        expect(
          forbidden.hasMatch(entity.readAsStringSync().replaceAll(RegExp(r'/\*[\s\S]*?\*/'), '').replaceAll(RegExp(r'//[^\n]*'), '')),
          isFalse,
          reason: '${entity.path} converts a money value through a float',
        );
      }
    }
  });

  test('the fee schedule keeps its rates as strings and formats by shifting digits', () {
    final String models = _code('features/fee_schedule/domain/fee_schedule_models.dart');
    // Both rates are declared String; a double field here would let a rate round.
    expect(RegExp(r'final String managementFeeRate;').hasMatch(models), isTrue);
    expect(RegExp(r'final String profitShareRate;').hasMatch(models), isTrue);
    expect(models.contains('* 100'), isFalse, reason: 'percentage is computed by shifting digits, not by multiplying');
    expect(RegExp(r'formatRatePercent').hasMatch(models), isTrue);
  });

  test('no screen exposes a write the API does not offer', () {
    // Acknowledge, resolve and revoke have no customer route; a button for one would
    // 404 at runtime and look like a platform failure.
    for (final String feature in <String>['security_alerts', 'venue_status']) {
      final String screen = _code('features/${_featureScreen[feature]}');
      for (final String verb in <String>['acknowledge', 'resolve(', 'revoke', 'override(']) {
        expect(screen.toLowerCase().contains(verb), isFalse, reason: '$feature screen mentions $verb');
      }
    }
    // The repositories must be read-only too.
    for (final String feature in <String>['security_alerts', 'venue_status']) {
      final String repository = _code('features/$feature/data/${_repositoryName(feature)}');
      expect(repository.contains('.post<'), isFalse, reason: '$feature repository posts');
      expect(repository.contains('.put<'), isFalse, reason: '$feature repository puts');
      expect(repository.contains('.delete<'), isFalse, reason: '$feature repository deletes');
    }
  });

  test('data export never creates a deletion request and always sends an idempotency key', () {
    final String repository = _code('features/privacy_export/data/data_export_repository.dart');
    expect(repository.contains("requestType': 'EXPORT'"), isTrue);
    expect(repository.contains('DELETION'), isFalse, reason: 'deletion needs step-up and stays on the web');
    expect(repository.contains("'deletion'"), isFalse);
    expect(RegExp(r'idempotencyKey: idempotencyKey,').hasMatch(repository), isTrue);

    final String screen = _code('features/privacy_export/presentation/data_export_screen.dart');
    expect(screen.contains('ExportRequestIdentifiers.generate'), isTrue,
        reason: 'the identifiers are generated by the tested domain helper, not inline');
  });

  test('every new screen is mounted on a route the router actually declares', () {
    final String router = _code('core/router/app_router.dart');
    final String paths = _code('core/router/route_paths.dart');

    const Map<String, String> screenToPath = <String, String>{
      'VenueStatusScreen': 'RoutePaths.venueStatus',
      'FeeScheduleScreen': 'RoutePaths.feeSchedule',
      'LoginAlertsScreen': 'RoutePaths.loginAlerts',
      'DataExportScreen': 'RoutePaths.dataExport',
    };
    screenToPath.forEach((String screen, String path) {
      expect(router.contains('const $screen()'), isTrue, reason: '$screen is not built by the router');
      expect(router.contains('path: $path,'), isTrue, reason: '$screen is not routed through $path');
      expect(paths.contains('static const String ${path.split('.').last} ='), isTrue,
          reason: '$path is not declared in RoutePaths');
    });

    // A nested GoRoute with a leading slash would be read as absolute and make the
    // parent's path ambiguous; every child path here is declared at top level.
    expect(router.contains("path: '/"), isFalse, reason: 'use RoutePaths constants, not inline literals');
  });

  test('the customer can reach all four screens from a navigable surface', () {
    final String home = _code('features/home/home_screen.dart');
    final String settings = _code('features/settings/settings_screen.dart');
    expect(home.contains('RoutePaths.venueStatus'), isTrue, reason: 'venue status has no entry point');
    expect(settings.contains('RoutePaths.loginAlerts'), isTrue, reason: 'sign-in alerts have no entry point');
    expect(settings.contains('RoutePaths.dataExport'), isTrue, reason: 'data export has no entry point');
    expect(settings.contains('RoutePaths.feeSchedule'), isTrue, reason: 'fee schedule has no entry point');

    // The venue tile is gated on one of the three permissions the route accepts.
    expect(
      RegExp(r"user\.can\('exchange_account:read'\) \|\| user\.can\('execution:read'\) \|\| user\.can\('order:read'\)")
          .hasMatch(home),
      isTrue,
      reason: 'the venue tile must be gated on a permission the API accepts',
    );
  });

  test('every string these screens render exists in all five locales', () {
    final Set<String> used = <String>{};
    for (final String feature in _featureRoutes.keys) {
      for (final FileSystemEntity entity in Directory('$_root/features/$feature').listSync(recursive: true)) {
        if (entity is! File || !entity.path.endsWith('.dart')) continue;
        for (final RegExpMatch match in RegExp(r'l10n\.([a-zA-Z]+)').allMatches(entity.readAsStringSync())) {
          used.add(match.group(1)!);
        }
      }
    }
    // Two pre-existing screens gained links into these features and reuse the new
    // strings, so their keys are checked too.
    for (final String path in <String>[
      'features/home/home_screen.dart',
      'features/settings/settings_screen.dart',
      'features/settings/security_screen.dart',
    ]) {
      for (final RegExpMatch match in RegExp(r'l10n\.([a-zA-Z]+)').allMatches(_code(path))) {
        used.add(match.group(1)!);
      }
    }
    expect(used, isNotEmpty);

    final String abstract = _read('l10n/app_localizations.dart');
    for (final String key in used) {
      expect(abstract.contains('String get $key;'), isTrue, reason: '$key is missing from AppLocalizations');
      for (final String locale in <String>['ar', 'bn', 'en', 'es', 'tr']) {
        final String impl = _read('l10n/app_localizations_$locale.dart');
        expect(impl.contains('String get $key =>'), isTrue, reason: '$key is missing from the $locale translation');
      }
    }
  });

  test('every Batch 05 source file carries its responsibility comment on line 1', () {
    final List<String> files = <String>[];
    for (final String feature in _featureRoutes.keys) {
      for (final FileSystemEntity entity in Directory('$_root/features/$feature').listSync(recursive: true)) {
        if (entity is File && entity.path.endsWith('.dart')) files.add(entity.path);
      }
    }
    for (final FileSystemEntity entity in Directory('test/features').listSync(recursive: true)) {
      if (entity is File && entity.path.endsWith('.dart')) files.add(entity.path);
    }
    files.add('$_root/core/network/api_endpoints.dart');
    // api_endpoints.dart predates this batch and is extended, not created; it carries
    // its own header, so only the files this batch introduced are asserted here.
    files.remove('$_root/core/network/api_endpoints.dart');

    expect(files, isNotEmpty);
    for (final String path in files) {
      final String first = File(path).readAsLinesSync().first;
      expect(first.startsWith('// # Responsibility:'), isTrue, reason: '$path has no responsibility comment on line 1');
    }
  });
}

String _repositoryName(String feature) {
  switch (feature) {
    case 'venue_status':
      return 'venue_status_repository.dart';
    case 'security_alerts':
      return 'login_alert_repository.dart';
    case 'privacy_export':
      return 'data_export_repository.dart';
    case 'fee_schedule':
      return 'fee_schedule_repository.dart';
    default:
      throw StateError('unknown feature $feature');
  }
}

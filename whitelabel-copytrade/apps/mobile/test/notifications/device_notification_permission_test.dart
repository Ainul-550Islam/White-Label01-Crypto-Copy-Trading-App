import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wlct_mobile/features/notifications/platform/device_notification_permission.dart';
import 'package:wlct_mobile/features/notifications/presentation/device_notification_permission_card.dart';
import 'package:wlct_mobile/l10n/app_localizations.dart';

void main() {
  test('platform results fail closed and retain denied and limited states', () {
    expect(
      DeviceNotificationPermission.fromPlatformValue('denied'),
      DeviceNotificationPermission.denied,
    );
    expect(
      DeviceNotificationPermission.fromPlatformValue('limited'),
      DeviceNotificationPermission.limited,
    );
    expect(
      DeviceNotificationPermission.fromPlatformValue('authorized'),
      DeviceNotificationPermission.authorized,
    );
    expect(
      DeviceNotificationPermission.fromPlatformValue(null),
      DeviceNotificationPermission.unavailable,
    );
    expect(
      DeviceNotificationPermission.fromPlatformValue('unexpected'),
      DeviceNotificationPermission.unavailable,
    );
  });

  testWidgets('denied state offers settings and never claims push delivery',
      (WidgetTester tester) async {
    bool opened = false;
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        locale: const Locale('en'),
        home: Scaffold(
          body: DeviceNotificationPermissionView(
            status: DeviceNotificationPermission.denied,
            busy: false,
            settingsError: false,
            onRequest: () => fail('denied permission must not re-prompt'),
            onOpenSettings: () => opened = true,
          ),
        ),
      ),
    );
    expect(find.text('Denied in device settings'), findsOneWidget);
    expect(find.text('Request device permission'), findsNothing);
    expect(
      find.textContaining('requires a configured push service'),
      findsOneWidget,
    );
    await tester.tap(find.text('Open device settings'));
    expect(opened, isTrue);
  });
}

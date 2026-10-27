import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../data/push_registration.dart';

import '../../../l10n/app_localizations.dart';
import '../platform/device_notification_permission.dart';

/// The card is independent of server-side category preferences: allowing one
/// does not imply the other is enabled or that a push provider is configured.
class DeviceNotificationPermissionCard extends ConsumerStatefulWidget {
  const DeviceNotificationPermissionCard({super.key});

  @override
  ConsumerState<DeviceNotificationPermissionCard> createState() =>
      _DeviceNotificationPermissionCardState();
}

class _DeviceNotificationPermissionCardState
    extends ConsumerState<DeviceNotificationPermissionCard>
    with WidgetsBindingObserver {
  final DeviceNotificationPermissions _permissions =
      const DeviceNotificationPermissions();
  DeviceNotificationPermission? _status;
  bool _busy = false;
  bool _settingsError = false;
  PushRegistrationStatus? _registration;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _refresh();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refresh();
  }

  Future<void> _refresh() async {
    final DeviceNotificationPermission status = await _permissions.status();
    if (!mounted) return;
    setState(() {
      _status = status;
      if (status != DeviceNotificationPermission.authorized && status != DeviceNotificationPermission.limited) _registration = null;
    });
    if (status == DeviceNotificationPermission.authorized || status == DeviceNotificationPermission.limited) {
      final PushRegistrationStatus registration = await ref.read(pushRegistrationProvider).sync();
      if (mounted && _status == status) setState(() => _registration = registration);
    }
  }

  Future<void> _request() async {
    setState(() => _busy = true);
    final DeviceNotificationPermission status = await _permissions.request();
    if (!mounted) return;
    PushRegistrationStatus? registration;
    if (status == DeviceNotificationPermission.authorized || status == DeviceNotificationPermission.limited) {
      registration = await ref.read(pushRegistrationProvider).sync();
    }
    if (mounted) {
      setState(() {
        _registration = registration;
        _status = status;
        _busy = false;
      });
    }
  }

  Future<void> _openSettings() async {
    setState(() {
      _busy = true;
      _settingsError = false;
    });
    final bool opened = await _permissions.openSettings();
    if (mounted) {
      setState(() {
        _busy = false;
        _settingsError = !opened;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return DeviceNotificationPermissionView(
      status: _status,
      busy: _busy,
      settingsError: _settingsError,
      registration: _registration,
      onRequest: _request,
      onOpenSettings: _openSettings,
      onRetryRegistration: _refresh,
    );
  }
}

/// Stateless rendering also makes each actual platform state testable without
/// replacing a repository or faking push delivery.
class DeviceNotificationPermissionView extends StatelessWidget {
  const DeviceNotificationPermissionView({
    super.key,
    required this.status,
    required this.busy,
    required this.settingsError,
    this.registration,
    required this.onRequest,
    required this.onOpenSettings,
    this.onRetryRegistration,
  });

  final DeviceNotificationPermission? status;
  final bool busy;
  final bool settingsError;
  final PushRegistrationStatus? registration;
  final VoidCallback onRequest;
  final VoidCallback onOpenSettings;
  final VoidCallback? onRetryRegistration;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String statusLabel = switch (status) {
      DeviceNotificationPermission.undetermined =>
        l10n.deviceNotificationsUndetermined,
      DeviceNotificationPermission.authorized =>
        l10n.deviceNotificationsAllowed,
      DeviceNotificationPermission.limited => l10n.deviceNotificationsLimited,
      DeviceNotificationPermission.denied => l10n.deviceNotificationsDenied,
      DeviceNotificationPermission.unavailable =>
        l10n.deviceNotificationsUnavailable,
      null => l10n.loading,
    };
    return Card(
      margin: const EdgeInsets.all(16),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              l10n.deviceNotificationsTitle,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Text(l10n.deviceNotificationsExplanation),
            const SizedBox(height: 8),
            Semantics(liveRegion: true, child: Text(statusLabel)),
            if (registration == PushRegistrationStatus.registered)
              Semantics(liveRegion: true, child: Text(l10n.devicePushRegistered)),
            if (registration == PushRegistrationStatus.unavailable || registration == PushRegistrationStatus.failed)
              Semantics(liveRegion: true, child: Text(l10n.devicePushUnavailable)),
            if ((registration == PushRegistrationStatus.unavailable || registration == PushRegistrationStatus.failed) && onRetryRegistration != null)
              TextButton(onPressed: busy ? null : onRetryRegistration, child: Text(l10n.devicePushRetry)),
            if (settingsError)
              Semantics(
                liveRegion: true,
                child: Text(
                  l10n.deviceNotificationsSettingsError,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
            if (status == DeviceNotificationPermission.undetermined)
              TextButton(
                onPressed: busy ? null : onRequest,
                child: Text(l10n.deviceNotificationsRequest),
              ),
            if (status == DeviceNotificationPermission.denied ||
                status == DeviceNotificationPermission.limited)
              TextButton(
                onPressed: busy ? null : onOpenSettings,
                child: Text(l10n.deviceNotificationsSettings),
              ),
          ],
        ),
      ),
    );
  }
}

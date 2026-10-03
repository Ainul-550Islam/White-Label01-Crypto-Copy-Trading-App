import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/feature_providers.dart';
import '../../../core/widgets/async_body.dart';
import '../../../l10n/app_localizations.dart';
import '../domain/notification_models.dart';

/// Notification inbox plus channel preferences.
class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  void _refreshAll(WidgetRef ref) {
    ref.invalidate(notificationsProvider);
    ref.invalidate(unreadNotificationCountProvider);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: Text(l10n.notificationsTitle),
          actions: <Widget>[
            IconButton(
              tooltip: l10n.markAllRead,
              icon: const Icon(Icons.done_all),
              onPressed: () async {
                await runAction(context, () => ref.read(notificationRepositoryProvider).markAllRead(), success: l10n.allMarkedRead);
                _refreshAll(ref);
              },
            ),
          ],
          bottom: TabBar(tabs: <Widget>[Tab(text: l10n.inboxTab), Tab(text: l10n.preferencesTab)]),
        ),
        body: TabBarView(children: <Widget>[
          RefreshIndicator(
            onRefresh: () async {
              _refreshAll(ref);
              await ref.read(notificationsProvider.future);
            },
            child: AsyncBody<List<AppNotification>>(
              value: ref.watch(notificationsProvider),
              onRetry: () => _refreshAll(ref),
              isEmpty: (List<AppNotification> rows) => rows.isEmpty,
              emptyText: l10n.noNotifications,
              builder: (List<AppNotification> rows) => ListView.separated(
                itemCount: rows.length,
                separatorBuilder: (_, __) => const Divider(height: 1),
                itemBuilder: (BuildContext context, int i) {
                  final AppNotification n = rows[i];
                  return ListTile(
                    leading: Icon(n.isRead ? Icons.notifications_none : Icons.notifications_active, color: n.isRead ? null : Theme.of(context).colorScheme.primary),
                    title: Text(n.title, style: TextStyle(fontWeight: n.isRead ? FontWeight.normal : FontWeight.w600)),
                    subtitle: Text('${n.body}\n${formatTimestamp(n.createdAt)}'),
                    isThreeLine: true,
                    onTap: n.isRead
                        ? null
                        : () async {
                            await runAction(context, () => ref.read(notificationRepositoryProvider).markRead(n.id), success: l10n.markedRead);
                            _refreshAll(ref);
                          },
                  );
                },
              ),
            ),
          ),
          const _PreferencesTab(),
        ],),
      ),
    );
  }
}

class _PreferencesTab extends ConsumerWidget {
  const _PreferencesTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return AsyncBody<List<NotificationPreference>>(
      value: ref.watch(notificationPreferencesProvider),
      onRetry: () => ref.invalidate(notificationPreferencesProvider),
      isEmpty: (List<NotificationPreference> rows) => rows.isEmpty,
      builder: (List<NotificationPreference> prefs) => ListView(
        children: <Widget>[
          for (final NotificationPreference p in prefs)
            SwitchListTile(
              title: Text(p.category),
              subtitle: Text(p.channel),
              value: p.enabled,
              onChanged: (bool value) async {
                await runAction(
                  context,
                  () => ref.read(notificationRepositoryProvider).updatePreferences(<NotificationPreference>[p.withEnabled(value)]),
                  success: l10n.preferencesSaved,
                );
                ref.invalidate(notificationPreferencesProvider);
              },
            ),
        ],
      ),
    );
  }
}

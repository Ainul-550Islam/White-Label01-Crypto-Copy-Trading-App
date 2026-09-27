import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/di/providers.dart';
import '../../core/router/route_paths.dart';
import '../../l10n/app_localizations.dart';
import '../auth/domain/auth_models.dart';
import '../auth/presentation/auth_state.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AuthState state = ref.watch(authControllerProvider);
    final AuthUser? user = state.user;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.settingsTitle)),
      body: ListView(
        children: <Widget>[
          if (user != null)
            ListTile(
              title: Text(l10n.accountSection),
              subtitle: Text(user.email),
              leading: const Icon(Icons.person_outline),
            ),
          ListTile(
            title: Text(l10n.securitySection),
            leading: const Icon(Icons.shield_outlined),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push(RoutePaths.security),
          ),
          const Divider(),
          ListTile(
            title: Text(l10n.signOut),
            leading: Icon(Icons.logout, color: Theme.of(context).colorScheme.error),
            onTap: state.isSubmitting
                ? null
                : () => ref.read(authControllerProvider.notifier).signOut(),
          ),
        ],
      ),
    );
  }
}

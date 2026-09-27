import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/di/providers.dart';
import '../../core/router/route_paths.dart';
import '../../l10n/app_localizations.dart';
import '../auth/domain/auth_models.dart';
import '../auth/presentation/auth_state.dart';

/// Authenticated landing screen.
///
/// Part 1 deliberately shows account state rather than trading data: there is
/// no trading data yet, and inventing some would be worse than showing none.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AuthState state = ref.watch(authControllerProvider);
    final AuthUser? user = state.user;

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.homeTitle),
        actions: <Widget>[
          IconButton(
            icon: const Icon(Icons.settings_outlined),
            onPressed: () => context.push(RoutePaths.settings),
            tooltip: l10n.settingsTitle,
          ),
        ],
      ),
      body: user == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(20),
              children: <Widget>[
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(18),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(l10n.welcomeBack, style: Theme.of(context).textTheme.labelMedium),
                        const SizedBox(height: 6),
                        Text(
                          user.displayName ?? user.email,
                          style: Theme.of(context)
                              .textTheme
                              .titleLarge
                              ?.copyWith(fontWeight: FontWeight.w700),
                        ),
                        const SizedBox(height: 12),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: <Widget>[
                            for (final String role in user.roles) Chip(label: Text(role)),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(18),
                    child: Row(
                      children: <Widget>[
                        Icon(
                          user.twoFactorEnabled ? Icons.verified_user : Icons.gpp_maybe,
                          color: user.twoFactorEnabled
                              ? Theme.of(context).colorScheme.primary
                              : Theme.of(context).colorScheme.error,
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            user.twoFactorEnabled
                                ? l10n.twoFactorEnabled
                                : l10n.twoFactorDisabled,
                          ),
                        ),
                        TextButton(
                          onPressed: () => context.push(RoutePaths.security),
                          child: Text(l10n.securityTitle),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                // Shown only to users the API would actually answer. Hiding
                // the tile is a usability filter, not access control: the
                // endpoint re-checks the permission on every request.
                if (user.can('strategy_instance:read'))
                  Card(
                    child: ListTile(
                      leading: const Icon(Icons.insights_outlined),
                      title: Text(l10n.strategiesTitle),
                      subtitle: Text(l10n.strategiesSubtitle),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => context.push(RoutePaths.strategies),
                    ),
                  ),
                if (user.can('strategy_instance:read')) const SizedBox(height: 16),
                // Same rule as the strategies tile: the tile exists if the
                // API would answer; the endpoint re-checks the permission on
                // every request regardless of what is rendered here.
                if (user.can('risk:read'))
                  Card(
                    child: ListTile(
                      leading: const Icon(Icons.gpp_good_outlined),
                      title: Text(l10n.riskTitle),
                      subtitle: Text(l10n.riskSubtitle),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => context.push(RoutePaths.risk),
                    ),
                  ),
                if (user.can('risk:read')) const SizedBox(height: 16),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(18),
                    child: Row(
                      children: <Widget>[
                        const Icon(Icons.info_outline),
                        const SizedBox(width: 12),
                        Expanded(child: Text(l10n.executionDisabledNotice)),
                      ],
                    ),
                  ),
                ),
              ],
            ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/di/providers.dart';
import '../../core/router/route_paths.dart';
import '../../l10n/app_localizations.dart';
import '../auth/domain/auth_models.dart';
import '../auth/presentation/auth_state.dart';

/// Security overview.
///
/// Reports the authenticated user's security posture and links to the caller's own
/// sign-in alerts. Session and password management stay in the web security
/// settings: `security/sessions` and `security/sessions/revoke-all` exist, but a
/// session revoke from a phone the session may already be stolen from is not the
/// place to get that wrong, and the web surface is the one under test for it.
class SecurityScreen extends ConsumerWidget {
  const SecurityScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AuthState state = ref.watch(authControllerProvider);
    final AuthUser? user = state.user;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.securityTitle)),
      body: ListView(
        children: <Widget>[
          ListTile(
            leading: Icon(
              user?.twoFactorEnabled ?? false ? Icons.verified_user : Icons.gpp_maybe,
            ),
            title: Text(
              user == null
                  ? l10n.loading
                  : user.twoFactorEnabled
                      ? l10n.twoFactorEnabled
                      : l10n.twoFactorDisabled,
            ),
          ),
          // Sign-in alerts are readable in the app, so the security screen links to
          // them rather than repeating "manage this on the web" for the one thing a
          // customer is most likely to come here for.
          ListTile(
            leading: const Icon(Icons.gpp_maybe_outlined),
            title: Text(l10n.loginAlertsTitle),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push(RoutePaths.loginAlerts),
          ),
          ListTile(
            leading: const Icon(Icons.info_outline),
            title: Text(l10n.securityWebManagement),
          ),
        ],
      ),
    );
  }
}

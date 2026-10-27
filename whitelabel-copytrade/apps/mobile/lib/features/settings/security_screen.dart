import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/di/providers.dart';
import '../../l10n/app_localizations.dart';
import '../auth/domain/auth_models.dart';
import '../auth/presentation/auth_state.dart';

/// Security overview.
///
/// Reports the authenticated user's security posture. Session and password
/// management are available through the web security settings.
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
          ListTile(
            leading: const Icon(Icons.info_outline),
            title: Text(l10n.securityWebManagement),
          ),
        ],
      ),
    );
  }
}

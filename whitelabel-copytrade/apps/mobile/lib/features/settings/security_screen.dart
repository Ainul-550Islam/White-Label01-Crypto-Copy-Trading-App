import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/di/providers.dart';
import '../../l10n/app_localizations.dart';
import '../auth/domain/auth_models.dart';
import '../auth/presentation/auth_state.dart';

/// Security overview.
///
/// Read-only in Part 1: it reports the account's security posture and the
/// device-management surface the API already exposes. Enrolment and session
/// revocation UI arrive with the security work in Part 2.
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
              (user?.twoFactorEnabled ?? false)
                  ? l10n.twoFactorEnabled
                  : l10n.twoFactorDisabled,
            ),
          ),
          ListTile(
            leading: const Icon(Icons.devices_outlined),
            title: Text(l10n.activeSessions),
            subtitle: const Text('GET /v1/auth/sessions'),
          ),
          ListTile(
            leading: const Icon(Icons.password_outlined),
            title: Text(l10n.changePassword),
            subtitle: const Text('POST /v1/auth/change-password'),
          ),
        ],
      ),
    );
  }
}

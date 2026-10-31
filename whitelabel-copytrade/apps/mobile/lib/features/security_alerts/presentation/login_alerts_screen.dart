// # Responsibility: lists the caller's own sign-in security events, filtering by alert type, and tells the customer what to do rather than offering an acknowledge control the API does not have.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/feature_providers.dart';
import '../../../core/widgets/async_body.dart';
import '../../../l10n/app_localizations.dart';
import '../domain/login_alert_models.dart';

/// Sign-in alerts.
///
/// Read-only on purpose. `GET security/events` is scoped to the caller's tenant and
/// returns their events; there is no customer-facing acknowledge or resolve route,
/// and resolving one is an operator decision that carries a written resolution and
/// an audit trail (`POST security/threats/:id/resolve`). So the screen ends with the
/// two actions a customer can actually take: review their devices in the web
/// security settings, and change their password there.
class LoginAlertsScreen extends ConsumerStatefulWidget {
  const LoginAlertsScreen({super.key});

  @override
  ConsumerState<LoginAlertsScreen> createState() => _LoginAlertsScreenState();
}

class _LoginAlertsScreenState extends ConsumerState<LoginAlertsScreen> {
  String _type = '';

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<List<LoginAlert>> alerts = ref.watch(loginAlertsProvider(_type));

    return Scaffold(
      appBar: AppBar(title: Text(l10n.loginAlertsTitle)),
      body: Column(
        children: <Widget>[
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Row(
              children: <Widget>[
                ChoiceChip(
                  label: Text(l10n.loginAlertsAll),
                  selected: _type.isEmpty,
                  onSelected: (_) => setState(() => _type = ''),
                ),
                const SizedBox(width: 8),
                ...SecurityEventTypes.all.map(
                  (String type) => Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      label: Text(_labelFor(type, l10n)),
                      selected: _type == type,
                      onSelected: (_) => setState(() => _type = type),
                    ),
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: () => ref.refresh(loginAlertsProvider(_type).future),
              child: AsyncBody<List<LoginAlert>>(
                value: alerts,
                onRetry: () => ref.invalidate(loginAlertsProvider(_type)),
                isEmpty: (List<LoginAlert> rows) => rows.isEmpty,
                emptyText: l10n.loginAlertsEmpty,
                builder: (List<LoginAlert> rows) => ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                  itemCount: rows.length + 1,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (BuildContext context, int index) {
                    if (index == rows.length) {
                      return Padding(
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        child: Text(l10n.loginAlertsAdvice, style: Theme.of(context).textTheme.bodySmall),
                      );
                    }
                    return _AlertTile(alert: rows[index]);
                  },
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  String _labelFor(String type, AppLocalizations l10n) {
    switch (type) {
      case SecurityEventTypes.loginSuccess:
        return l10n.loginAlertsSignIns;
      case SecurityEventTypes.loginFailure:
        return l10n.loginAlertsFailures;
      case SecurityEventTypes.newDevice:
        return l10n.loginAlertsNewDevice;
      case SecurityEventTypes.suspiciousLogin:
        return l10n.loginAlertsSuspicious;
      case SecurityEventTypes.passwordChange:
        return l10n.loginAlertsPassword;
      default:
        return type;
    }
  }
}

class _AlertTile extends StatelessWidget {
  const _AlertTile({required this.alert});

  final LoginAlert alert;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ThemeData theme = Theme.of(context);
    final bool serious = alert.isSuspicious || alert.isHighSeverity;

    return ListTile(
      leading: Icon(
        serious ? Icons.gpp_bad_outlined : Icons.shield_outlined,
        color: serious ? theme.colorScheme.error : null,
      ),
      title: Text(alert.type),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text('${l10n.loginAlertsSeverityLabel}: ${alert.severity}'),
          if (alert.createdAt != null) Text(_formatDate(alert.createdAt!)),
          if (alert.deviceId != null) Text('${l10n.loginAlertsDevice} ${alert.deviceId}'),
          if (alert.userAgent != null) Text(alert.userAgent!, maxLines: 2, overflow: TextOverflow.ellipsis),
        ],
      ),
      isThreeLine: true,
    );
  }
}

String _formatDate(DateTime value) {
  String two(int part) => part.toString().padLeft(2, '0');
  return '${value.year}-${two(value.month)}-${two(value.day)} ${two(value.hour)}:${two(value.minute)}';
}

// # Responsibility: shows each venue the customer trades on with its maintenance/degraded state, when it changed, and whether the platform could confirm it — leading with the venues that block trading rather than sorting alphabetically past them.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/feature_providers.dart';
import '../../../core/widgets/async_body.dart';
import '../../../l10n/app_localizations.dart';
import '../domain/venue_status_models.dart';

/// Venue status for customers.
///
/// The list is ordered by consequence, not by name: a venue in maintenance or an
/// outage comes first, then degraded, then operational, and an unverified row is
/// never collapsed into "fine". A customer opens this screen because an order was
/// refused, and the answer has to be the first thing they see.
class VenueStatusScreen extends ConsumerWidget {
  const VenueStatusScreen({super.key});

  static int _rank(VenueStatus status) {
    if (status.blocksTrading) return 0;
    if (status.state == VenueStates.degraded) return 1;
    if (!status.verified || status.state == VenueStates.unknown) return 2;
    return 3;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<List<VenueStatus>> statuses = ref.watch(venueStatusesProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.venueStatusTitle)),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(venueStatusesProvider.future),
        child: AsyncBody<List<VenueStatus>>(
          value: statuses,
          onRetry: () => ref.invalidate(venueStatusesProvider),
          isEmpty: (List<VenueStatus> rows) => rows.isEmpty,
          emptyText: l10n.venueStatusEmpty,
          builder: (List<VenueStatus> rows) {
            final List<VenueStatus> ordered = List<VenueStatus>.of(rows)
              ..sort((VenueStatus a, VenueStatus b) {
                final int byRank = _rank(a).compareTo(_rank(b));
                return byRank != 0 ? byRank : a.venue.compareTo(b.venue);
              });
            return ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: ordered.length,
              separatorBuilder: (_, __) => const SizedBox(height: 12),
              itemBuilder: (BuildContext context, int index) => _VenueStatusCard(status: ordered[index]),
            );
          },
        ),
      ),
    );
  }
}

class _VenueStatusCard extends StatelessWidget {
  const _VenueStatusCard({required this.status});

  final VenueStatus status;

  ({IconData icon, Color color, String label}) _appearance(AppLocalizations l10n, ColorScheme scheme) {
    switch (status.state) {
      case VenueStates.operational:
        return (icon: Icons.check_circle_outline, color: scheme.primary, label: l10n.venueStatusOperational);
      case VenueStates.degraded:
        return (icon: Icons.warning_amber_outlined, color: scheme.tertiary, label: l10n.venueStatusDegraded);
      case VenueStates.maintenance:
        return (icon: Icons.build_outlined, color: scheme.error, label: l10n.venueStatusMaintenance);
      case VenueStates.outage:
        return (icon: Icons.dangerous_outlined, color: scheme.error, label: l10n.venueStatusOutage);
      default:
        // An unrecognised state is reported as unknown, never as operational: the
        // phone does not know, and pretending otherwise is how a customer loses money.
        return (icon: Icons.help_outline, color: scheme.outline, label: l10n.venueStatusUnknown);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ThemeData theme = Theme.of(context);
    final ({IconData icon, Color color, String label}) look = _appearance(l10n, theme.colorScheme);

    return Card(
      child: ListTile(
        leading: Icon(look.icon, color: look.color),
        title: Text(status.venue, style: theme.textTheme.titleMedium),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(look.label, style: theme.textTheme.bodyMedium),
            if (status.message != null) Text(status.message!),
            if (status.reason != null && status.message == null) Text(status.reason!),
            if (status.since != null)
              Text('${l10n.venueStatusSince}: ${_formatDate(status.since!)}'),
            if (!status.verified) Text(l10n.venueStatusUnverified),
            if (status.isOverridden)
              Text('${l10n.venueStatusOperatorSet}${status.override?.reason.isNotEmpty ?? false ? ' — ${status.override!.reason}' : ''}'),
            if (status.checkedAt != null)
              Text('${l10n.venueStatusChecked}: ${_formatDate(status.checkedAt!)}'),
          ],
        ),
        isThreeLine: true,
      ),
    );
  }
}

/// Local `yyyy-MM-dd HH:mm`, built from the parts rather than through `intl` so the
/// phone formats an instant without a locale table the build may not carry.
String _formatDate(DateTime value) {
  String two(int part) => part.toString().padLeft(2, '0');
  return '${value.year}-${two(value.month)}-${two(value.day)} ${two(value.hour)}:${two(value.minute)}';
}

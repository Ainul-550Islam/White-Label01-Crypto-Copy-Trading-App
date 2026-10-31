// # Responsibility: shows the fee schedule that is in force for this customer right now — rates as exact decimal strings, the date they started, and whether a tenant override applies — with the history beneath it.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/feature_providers.dart';
import '../../../core/widgets/async_body.dart';
import '../../../l10n/app_localizations.dart';
import '../domain/fee_schedule_models.dart';

/// Fee schedule: read-only.
///
/// Every rate is rendered from the string the API sent through `formatRatePercent`,
/// which shifts digits instead of multiplying by 100. Nothing on this screen can
/// turn `0.0025` into a float, because none of the code paths here build one.
class FeeScheduleScreen extends ConsumerWidget {
  const FeeScheduleScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<FeeSchedule> schedule = ref.watch(feeScheduleProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.feeScheduleTitle)),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(feeScheduleProvider.future),
        child: AsyncBody<FeeSchedule>(
          value: schedule,
          onRetry: () => ref.invalidate(feeScheduleProvider),
          isEmpty: (FeeSchedule data) => data.managementFeeRate.isEmpty && data.profitShareRate.isEmpty,
          emptyText: l10n.feeScheduleEmpty,
          builder: (FeeSchedule data) => ListView(
            padding: const EdgeInsets.all(16),
            children: <Widget>[
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(l10n.feeScheduleEffective, style: Theme.of(context).textTheme.titleMedium),
                      if (data.effectiveFrom != null)
                        Text('${l10n.feeScheduleFromLabel}: ${_formatDate(data.effectiveFrom!)}'),
                      if (data.isTenantOverride) Text(l10n.feeScheduleOverride),
                      const SizedBox(height: 12),
                      _RateRow(label: l10n.feeScheduleManagement, value: formatRatePercent(data.managementFeeRate)),
                      _RateRow(label: l10n.feeScheduleProfitShare, value: formatRatePercent(data.profitShareRate)),
                      if (data.currency.isNotEmpty) _RateRow(label: l10n.feeScheduleCurrency, value: data.currency),
                      _RateRow(label: l10n.feeScheduleVersion, value: data.version.toString()),
                    ],
                  ),
                ),
              ),
              if (data.versions.isNotEmpty) ...<Widget>[
                const SizedBox(height: 24),
                Text(l10n.feeScheduleHistory, style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                ...data.versions.map(
                  (FeeScheduleVersion version) => Card(
                    margin: const EdgeInsets.only(bottom: 8),
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text('v${version.version}', style: Theme.of(context).textTheme.titleSmall),
                          if (version.effectiveFrom != null)
                            Text('${l10n.feeScheduleFromLabel}: ${_formatDate(version.effectiveFrom!)}'),
                          if (version.effectiveUntil != null)
                            Text('${l10n.feeScheduleUntilLabel}: ${_formatDate(version.effectiveUntil!)}'),
                          _RateRow(label: l10n.feeScheduleManagement, value: formatRatePercent(version.managementFeeRate)),
                          _RateRow(label: l10n.feeScheduleProfitShare, value: formatRatePercent(version.profitShareRate)),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _RateRow extends StatelessWidget {
  const _RateRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: <Widget>[
          Flexible(child: Text(label)),
          const SizedBox(width: 12),
          Text(value, style: const TextStyle(fontFeatures: <FontFeature>[FontFeature.tabularFigures()])),
        ],
      ),
    );
  }
}

String _formatDate(DateTime value) {
  String two(int part) => part.toString().padLeft(2, '0');
  return '${value.year}-${two(value.month)}-${two(value.day)}';
}

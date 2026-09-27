import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/providers.dart';
import '../../../l10n/app_localizations.dart';
import '../domain/strategy_models.dart';
import 'strategy_state.dart';

/// Read-only strategy viewer.
///
/// There is no button on this screen that changes anything. It answers three
/// questions and stops: what is running, is any of it unhealthy, and what did
/// the simulator produce. Controls live in the admin console, behind
/// permissions this client is not granted.
class StrategiesScreen extends ConsumerStatefulWidget {
  const StrategiesScreen({super.key});

  @override
  ConsumerState<StrategiesScreen> createState() => _StrategiesScreenState();
}

class _StrategiesScreenState extends ConsumerState<StrategiesScreen> {
  @override
  void initState() {
    super.initState();
    // Deferred to after the first frame: the controller mutates provider state
    // and must not do so during the build that created it.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      unawaited(ref.read(strategyControllerProvider.notifier).load());
    });
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final StrategyViewState state = ref.watch(strategyControllerProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.strategiesTitle)),
      body: RefreshIndicator(
        onRefresh: () => ref.read(strategyControllerProvider.notifier).refresh(),
        child: _body(context, l10n, state),
      ),
    );
  }

  Widget _body(BuildContext context, AppLocalizations l10n, StrategyViewState state) {
    if (state.status == StrategyViewStatus.loading && !state.hasAnyData) {
      return const Center(child: CircularProgressIndicator());
    }

    if (state.status == StrategyViewStatus.failed && !state.hasAnyData) {
      return _FailureView(
        message: state.error?.message ?? l10n.genericError,
        retryLabel: l10n.retry,
        onRetry: () => ref.read(strategyControllerProvider.notifier).load(),
      );
    }

    return ListView(
      padding: const EdgeInsets.all(16),
      physics: const AlwaysScrollableScrollPhysics(),
      children: <Widget>[
        if (state.isDegraded) _DegradedBanner(message: l10n.strategyPanelsDegraded),
        if (state.overview != null) _BoundaryCard(overview: state.overview!, l10n: l10n),
        const SizedBox(height: 12),
        if (state.overview != null) _CountersCard(overview: state.overview!, l10n: l10n),
        const SizedBox(height: 12),
        _SectionHeading(title: l10n.strategyInstancesSection),
        if (state.instances.isEmpty)
          _EmptyCard(message: l10n.strategyNoInstances)
        else
          for (final StrategyInstanceSummary instance in state.instances)
            _InstanceCard(instance: instance, l10n: l10n),
        const SizedBox(height: 12),
        _SectionHeading(title: l10n.paperSessionsSection),
        if (state.paperSessions.isEmpty)
          _EmptyCard(message: l10n.strategyNoPaperSessions)
        else
          for (final PaperSessionSummary session in state.paperSessions)
            _PaperSessionCard(session: session, l10n: l10n),
        const SizedBox(height: 12),
        _SectionHeading(title: l10n.backtestsSection),
        if (state.backtests.isEmpty)
          _EmptyCard(message: l10n.strategyNoBacktests)
        else
          for (final BacktestSummary backtest in state.backtests)
            _BacktestCard(backtest: backtest, l10n: l10n),
        const SizedBox(height: 16),
        _DisclaimerCard(l10n: l10n),
        const SizedBox(height: 24),
      ],
    );
  }
}

/// The execution boundary, stated before any number on the page.
class _BoundaryCard extends StatelessWidget {
  const _BoundaryCard({required this.overview, required this.l10n});

  final StrategyOverview overview;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;
    final bool live = overview.liveExecutionReachable;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Icon(
                  live ? Icons.warning_amber_rounded : Icons.shield_outlined,
                  color: live ? colors.error : colors.primary,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    live ? l10n.liveExecutionReachable : l10n.liveExecutionNotReachable,
                    style: Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: <Widget>[
                _StatusChip(
                  label: l10n.strategyEngineLabel,
                  on: overview.strategyEngineEnabled,
                ),
                _StatusChip(label: l10n.paperTradingLabel, on: overview.paperTradingEnabled),
                _StatusChip(label: l10n.backtestingLabel, on: overview.backtestEnabled),
                Chip(label: Text('${l10n.tradingModeLabel}: ${overview.tradingMode}')),
              ],
            ),
            if (overview.latencyNote.isNotEmpty) ...<Widget>[
              const SizedBox(height: 12),
              Text(
                overview.latencyNote,
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: colors.onSurfaceVariant),
              ),
            ],
            const SizedBox(height: 8),
            Text(
              l10n.strategyReadOnlyNotice,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: colors.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}

class _CountersCard extends StatelessWidget {
  const _CountersCard({required this.overview, required this.l10n});

  final StrategyOverview overview;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Wrap(
          spacing: 24,
          runSpacing: 16,
          children: <Widget>[
            _Counter(label: l10n.instancesLabel, value: '${overview.totalInstances}'),
            _Counter(label: l10n.runningLabel, value: '${overview.runningInstances}'),
            _Counter(
              label: l10n.needsAttentionLabel,
              value: '${overview.unhealthyInstances + overview.quarantinedInstances}',
              emphasise: overview.unhealthyInstances + overview.quarantinedInstances > 0,
            ),
            _Counter(
              label: l10n.openIncidentsLabel,
              value: '${overview.openIncidents}',
              emphasise: overview.criticalIncidents > 0,
            ),
            _Counter(
              label: l10n.paperSessionsSection,
              value: '${overview.runningPaperSessions}',
            ),
          ],
        ),
      ),
    );
  }
}

class _InstanceCard extends StatelessWidget {
  const _InstanceCard({required this.instance, required this.l10n});

  final StrategyInstanceSummary instance;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        instance.name,
                        style: Theme.of(context)
                            .textTheme
                            .titleSmall
                            ?.copyWith(fontWeight: FontWeight.w700),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '${instance.kind}@${instance.version}',
                        style: Theme.of(context)
                            .textTheme
                            .bodySmall
                            ?.copyWith(color: colors.onSurfaceVariant),
                      ),
                    ],
                  ),
                ),
                _HealthBadge(health: instance.health),
              ],
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: <Widget>[
                Chip(label: Text(instance.venue)),
                for (final String symbol in instance.symbols) Chip(label: Text(symbol)),
                Chip(
                  label: Text(
                    instance.enabled ? l10n.enabledLabel : l10n.disabledLabel,
                  ),
                ),
              ],
            ),
            if (instance.consecutiveErrors > 0 || instance.lastErrorCode != null) ...<Widget>[
              const SizedBox(height: 10),
              Text(
                '${l10n.consecutiveErrorsLabel}: ${instance.consecutiveErrors}'
                '${instance.lastErrorCode == null ? '' : ' · ${instance.lastErrorCode}'}',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.error),
              ),
            ],
            if (instance.quarantineReason != null) ...<Widget>[
              const SizedBox(height: 6),
              Text(
                instance.quarantineReason!,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.error),
              ),
            ],
            const SizedBox(height: 6),
            Text(
              instance.lastHeartbeatAt == null
                  ? l10n.noHeartbeatYet
                  : '${l10n.lastHeartbeatLabel}: ${_formatTimestamp(instance.lastHeartbeatAt!)}',
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: colors.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}

class _PaperSessionCard extends StatelessWidget {
  const _PaperSessionCard({required this.session, required this.l10n});

  final PaperSessionSummary session;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    '${session.strategyKey} · ${session.symbol}',
                    style: Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
                if (session.isSimulated) _SimulatedBadge(label: l10n.simulatedBadge),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              session.sessionIdentifier,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: colors.onSurfaceVariant),
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 20,
              runSpacing: 12,
              children: <Widget>[
                _Counter(label: l10n.statusLabel, value: _statusLabel(session.status, l10n)),
                _Counter(
                  label: l10n.equityLabel,
                  value: session.currentEquity ?? l10n.notAvailableShort,
                ),
                _Counter(label: l10n.realisedPnlLabel, value: session.realisedPnl),
                _Counter(
                  label: l10n.simulatedFillsLabel,
                  value: '${session.simulatedOrders} / ${session.simulatedFills}',
                ),
                _Counter(label: l10n.riskRejectionsLabel, value: '${session.riskRejections}'),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _BacktestCard extends StatelessWidget {
  const _BacktestCard({required this.backtest, required this.l10n});

  final BacktestSummary backtest;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;

    /// A withheld metric reads as "insufficient data", never as zero.
    String metric(String? value) {
      if (value != null) {
        return value;
      }
      return backtest.hasSufficientObservations
          ? l10n.notAvailableShort
          : l10n.insufficientData;
    }

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    '${backtest.strategyKey}@${backtest.strategyVersion} · ${backtest.symbol}',
                    style: Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
                _SimulatedBadge(label: l10n.simulatedBadge),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              backtest.runIdentifier,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: colors.onSurfaceVariant),
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 20,
              runSpacing: 12,
              children: <Widget>[
                _Counter(label: l10n.statusLabel, value: _statusLabel(backtest.status, l10n)),
                _Counter(label: l10n.netPnlLabel, value: metric(backtest.netPnl)),
                _Counter(label: l10n.tradesLabel, value: '${backtest.totalTrades}'),
                _Counter(label: l10n.winRateLabel, value: metric(backtest.winRate)),
                _Counter(label: l10n.sharpeLabel, value: metric(backtest.sharpeRatio)),
                _Counter(
                  label: l10n.maxDrawdownLabel,
                  value: metric(backtest.maxDrawdownPercent),
                ),
              ],
            ),
            if (!backtest.isReproducible) ...<Widget>[
              const SizedBox(height: 10),
              Text(
                l10n.backtestNotReproducible,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.error),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _DisclaimerCard extends StatelessWidget {
  const _DisclaimerCard({required this.l10n});

  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;

    return Card(
      color: colors.surfaceContainerHighest,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              l10n.simulationDisclaimerTitle,
              style: Theme.of(context)
                  .textTheme
                  .titleSmall
                  ?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            Text(l10n.backtestDisclaimer, style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 4),
            Text(l10n.paperDisclaimer, style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 4),
            Text(
              l10n.executionQualityDisclaimer,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 4),
            Text(
              l10n.insufficientDataDisclaimer,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }
}

class _HealthBadge extends StatelessWidget {
  const _HealthBadge({required this.health});

  final StrategyHealth health;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;

    final Color background = switch (health) {
      StrategyHealth.healthy => colors.primaryContainer,
      StrategyHealth.degraded => colors.tertiaryContainer,
      StrategyHealth.unhealthy || StrategyHealth.quarantined => colors.errorContainer,
      StrategyHealth.unknown => colors.surfaceContainerHighest,
    };

    final Color foreground = switch (health) {
      StrategyHealth.healthy => colors.onPrimaryContainer,
      StrategyHealth.degraded => colors.onTertiaryContainer,
      StrategyHealth.unhealthy || StrategyHealth.quarantined => colors.onErrorContainer,
      StrategyHealth.unknown => colors.onSurfaceVariant,
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        health.name.toUpperCase(),
        style: Theme.of(context)
            .textTheme
            .labelSmall
            ?.copyWith(color: foreground, fontWeight: FontWeight.w700),
      ),
    );
  }
}

class _SimulatedBadge extends StatelessWidget {
  const _SimulatedBadge({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: colors.secondaryContainer,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: colors.onSecondaryContainer,
              fontWeight: FontWeight.w700,
            ),
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.label, required this.on});

  final String label;
  final bool on;

  @override
  Widget build(BuildContext context) {
    return Chip(
      avatar: Icon(
        on ? Icons.check_circle_outline : Icons.remove_circle_outline,
        size: 18,
      ),
      label: Text(label),
    );
  }
}

class _Counter extends StatelessWidget {
  const _Counter({required this.label, required this.value, this.emphasise = false});

  final String label;
  final String value;
  final bool emphasise;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Text(
          label,
          style: Theme.of(context)
              .textTheme
              .labelSmall
              ?.copyWith(color: colors.onSurfaceVariant),
        ),
        const SizedBox(height: 2),
        Text(
          value,
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w700,
                color: emphasise ? colors.error : null,
              ),
        ),
      ],
    );
  }
}

class _SectionHeading extends StatelessWidget {
  const _SectionHeading({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 8, bottom: 8),
      child: Text(
        title,
        style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
      ),
    );
  }
}

class _EmptyCard extends StatelessWidget {
  const _EmptyCard({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Text(
          message,
          style: Theme.of(context)
              .textTheme
              .bodyMedium
              ?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
        ),
      ),
    );
  }
}

class _DegradedBanner extends StatelessWidget {
  const _DegradedBanner({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: colors.tertiaryContainer,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: <Widget>[
          Icon(Icons.info_outline, color: colors.onTertiaryContainer, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: colors.onTertiaryContainer),
            ),
          ),
        ],
      ),
    );
  }
}

class _FailureView extends StatelessWidget {
  const _FailureView({
    required this.message,
    required this.retryLabel,
    required this.onRetry,
  });

  final String message;
  final String retryLabel;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(24),
      children: <Widget>[
        const SizedBox(height: 80),
        Icon(
          Icons.cloud_off_outlined,
          size: 40,
          color: Theme.of(context).colorScheme.onSurfaceVariant,
        ),
        const SizedBox(height: 16),
        Text(message, textAlign: TextAlign.center),
        const SizedBox(height: 16),
        Center(
          child: FilledButton(onPressed: onRetry, child: Text(retryLabel)),
        ),
      ],
    );
  }
}

String _statusLabel(SimulationStatus status, AppLocalizations l10n) {
  switch (status) {
    case SimulationStatus.queued:
      return l10n.statusQueued;
    case SimulationStatus.running:
      return l10n.statusRunning;
    case SimulationStatus.completed:
      return l10n.statusCompleted;
    case SimulationStatus.stopped:
      return l10n.statusStopped;
    case SimulationStatus.failed:
      return l10n.statusFailed;
    case SimulationStatus.cancelled:
      return l10n.statusCancelled;
    case SimulationStatus.unknown:
      return l10n.notAvailableShort;
  }
}

/// Local, dependency-free timestamp rendering.
///
/// Deliberately not localised into a relative phrase: an operator reading an
/// incident needs an unambiguous wall-clock time, not "2 hours ago".
String _formatTimestamp(DateTime value) {
  String two(int input) => input.toString().padLeft(2, '0');
  return '${value.year}-${two(value.month)}-${two(value.day)} '
      '${two(value.hour)}:${two(value.minute)}';
}

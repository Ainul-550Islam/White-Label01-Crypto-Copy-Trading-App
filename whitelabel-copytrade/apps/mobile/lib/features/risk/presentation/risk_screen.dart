import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/providers.dart';
import '../../../l10n/app_localizations.dart';
import '../domain/risk_models.dart';
import 'risk_state.dart';

/// Read-only risk viewer.
///
/// This screen answers two questions and stops: is anything halted, and is
/// the engine looking at fresh state. There is no button here that engages
/// or clears a switch - clearing especially not, because a triggered
/// protection is exactly the thing that must NOT be dismissible from a
/// device one careless thumb from a "looks fine". The admin console carries
/// those actions behind reasons and typed confirmations; the API enforces
/// the same permissions whether or not any UI exists.
///
/// Every figure is mirrored state with a capture time, and the copy says
/// so: a phone showing a number without its age is how "equity" gets read
/// as a live quote.
class RiskScreen extends ConsumerStatefulWidget {
  const RiskScreen({super.key});

  @override
  ConsumerState<RiskScreen> createState() => _RiskScreenState();
}

class _RiskScreenState extends ConsumerState<RiskScreen> {
  @override
  void initState() {
    super.initState();
    // Deferred to after the first frame: the controller mutates provider
    // state and must not do so during the build that created it.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      unawaited(ref.read(riskControllerProvider.notifier).load());
    });
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final RiskViewState state = ref.watch(riskControllerProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.riskTitle)),
      body: RefreshIndicator(
        onRefresh: () => ref.read(riskControllerProvider.notifier).refresh(),
        child: _body(context, l10n, state),
      ),
    );
  }

  Widget _body(BuildContext context, AppLocalizations l10n, RiskViewState state) {
    if (state.status == RiskViewStatus.loading && !state.hasAnyData) {
      return const Center(child: CircularProgressIndicator());
    }

    if (state.status == RiskViewStatus.failed && !state.hasAnyData) {
      return _FailureView(
        message: state.error?.message ?? l10n.genericError,
        retryLabel: l10n.retry,
        onRetry: () => ref.read(riskControllerProvider.notifier).load(),
      );
    }

    return ListView(
      padding: const EdgeInsets.all(16),
      physics: const AlwaysScrollableScrollPhysics(),
      children: <Widget>[
        if (state.isDegraded) _DegradedBanner(message: l10n.riskPanelsDegraded),
        if (state.mirror != null) _PostureCard(status: state.mirror!, l10n: l10n),
        const SizedBox(height: 12),
        if (state.mirror != null) _CountersCard(status: state.mirror!, l10n: l10n),
        const SizedBox(height: 12),
        _SectionHeading(title: l10n.riskMirrorSection),
        if (state.mirror == null || state.mirror!.mirrors.isEmpty)
          _EmptyCard(message: l10n.riskNoMirror)
        else
          for (final RiskAccountMirror mirror in state.mirror!.mirrors)
            _MirrorCard(mirror: mirror, l10n: l10n),
        const SizedBox(height: 12),
        _SectionHeading(title: l10n.riskSwitchesSection),
        if (state.engagedSwitches.isEmpty)
          _EmptyCard(message: l10n.riskNoSwitches)
        else
          for (final RiskSwitchInfo row in state.engagedSwitches)
            _SwitchCard(switchInfo: row, l10n: l10n),
        const SizedBox(height: 12),
        _SectionHeading(title: l10n.riskEventsSection),
        if (state.events.isEmpty)
          _EmptyCard(message: l10n.riskNoEvents)
        else
          for (final RiskEventInfo event in state.events)
            _EventCard(event: event, l10n: l10n),
        const SizedBox(height: 16),
        _DisclaimerCard(l10n: l10n),
        const SizedBox(height: 24),
      ],
    );
  }
}

/// Engine posture, stated before any number on the page.
class _PostureCard extends StatelessWidget {
  const _PostureCard({required this.status, required this.l10n});

  final RiskMirrorStatus status;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Icon(
                  status.engineEnabled ? Icons.shield_outlined : Icons.gps_off_outlined,
                  color: status.engineEnabled ? colors.primary : colors.error,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    status.engineEnabled
                        ? l10n.riskEngineOn
                        : l10n.riskEngineOff,
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
                _StatusChip(label: l10n.riskFailClosedLabel, on: status.failClosed),
                _StatusChip(
                  label: '${l10n.riskCadenceLabel}: ${status.snapshotRefreshMs}ms / '
                      '${status.maxRiskStateAgeMs}ms',
                  on: status.refreshOutpacesStaleness,
                ),
              ],
            ),
            if (!status.refreshOutpacesStaleness) ...<Widget>[
              const SizedBox(height: 12),
              Text(
                l10n.riskCadenceWarn,
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: colors.error),
              ),
            ],
            if (status.note.isNotEmpty) ...<Widget>[
              const SizedBox(height: 8),
              Text(
                status.note,
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: colors.onSurfaceVariant),
              ),
            ],
            const SizedBox(height: 8),
            Text(
              l10n.riskReadOnlyNotice,
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
  const _CountersCard({required this.status, required this.l10n});

  final RiskMirrorStatus status;
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
            _Counter(
              label: l10n.riskEngagedStopsLabel,
              value: '${status.engagedSwitchCount}',
              emphasise: status.engagedSwitchCount > 0,
            ),
            _Counter(
              label: l10n.riskTriggeredProtectionsLabel,
              value: '${status.triggeredProtectionCount}',
              emphasise: status.triggeredProtectionCount > 0,
            ),
            _Counter(
              label: l10n.riskStaleMirrorsLabel,
              value: '${status.staleMirrorCount}',
              emphasise: status.staleMirrorCount > 0,
            ),
            _Counter(
              label: l10n.riskSevereEventsLabel,
              value: '${status.criticalEvents24h}',
              emphasise: status.criticalEvents24h > 0,
            ),
          ],
        ),
      ),
    );
  }
}

class _MirrorCard extends StatelessWidget {
  const _MirrorCard({required this.mirror, required this.l10n});

  final RiskAccountMirror mirror;
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
                    mirror.accountId,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
                if (mirror.stale) _AccentBadge(label: l10n.riskStaleBadge),
                if (mirror.isSimulated)
                  _AccentBadge(label: l10n.simulatedBadge, danger: false),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              '${l10n.riskSnapshotLabel}: v${mirror.snapshotVersion} · '
              '${l10n.riskCapturedLabel}: '
              '${mirror.capturedAt == null ? '—' : _formatTimestamp(mirror.capturedAt!)}',
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: colors.onSurfaceVariant),
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 20,
              runSpacing: 10,
              children: <Widget>[
                _Counter(
                  label: l10n.riskEquityLabel,
                  value: mirror.equity ?? l10n.notAvailableShort,
                ),
                _Counter(
                  label: l10n.riskDayPnlLabel,
                  value: mirror.netDailyPnl ?? l10n.notAvailableShort,
                  emphasise: _isNegative(mirror.netDailyPnl),
                ),
                _Counter(
                  label: l10n.riskGrossLabel,
                  value: mirror.grossNotional ?? l10n.notAvailableShort,
                ),
                _Counter(
                  label: l10n.riskOpenOrdersLabel,
                  value: mirror.openOrderCount == null
                      ? l10n.notAvailableShort
                      : '${mirror.openOrderCount}',
                ),
              ],
            ),
            if (mirror.staleSources.isNotEmpty) ...<Widget>[
              const SizedBox(height: 8),
              Text(
                '${l10n.riskStaleSourcesLabel}: ${mirror.staleSources.join(', ')}',
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: colors.error),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _SwitchCard extends StatelessWidget {
  const _SwitchCard({required this.switchInfo, required this.l10n});

  final RiskSwitchInfo switchInfo;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;
    final bool triggered = switchInfo.isTriggeredProtection;

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Icon(
                  triggered ? Icons.gpp_bad_outlined : Icons.stop_circle_outlined,
                  color: triggered ? colors.error : colors.primary,
                  size: 20,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    '${switchInfo.scope}'
                    '${switchInfo.target == null ? '' : ': ${switchInfo.target}'}',
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
                _AccentBadge(label: switchInfo.status, danger: triggered),
              ],
            ),
            const SizedBox(height: 6),
            if (switchInfo.reason != null)
              Text(
                '${l10n.riskReasonLabel}: ${switchInfo.reason}',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            const SizedBox(height: 4),
            Text(
              switchInfo.triggeredByRule == null
                  ? '${l10n.riskEngagedManualLabel} · '
                      '${switchInfo.engagedAt == null ? '—' : _formatTimestamp(switchInfo.engagedAt!)}'
                  : '${switchInfo.triggeredByRule} · '
                      '${switchInfo.engagedAt == null ? '—' : _formatTimestamp(switchInfo.engagedAt!)}',
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: colors.onSurfaceVariant),
            ),
            if (triggered && switchInfo.requiresExplicitClear) ...<Widget>[
              const SizedBox(height: 8),
              Text(
                l10n.riskExplicitClearNotice,
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: colors.error),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _EventCard extends StatelessWidget {
  const _EventCard({required this.event, required this.l10n});

  final RiskEventInfo event;
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
                    _titleCase(event.eventType),
                    style: Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.w600),
                  ),
                ),
                if (event.isSevere) _AccentBadge(label: event.severity),
                if (event.isSimulated)
                  _AccentBadge(label: l10n.simulatedBadge, danger: false),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              '${event.createdAt == null ? '—' : _formatTimestamp(event.createdAt!)}'
              '${event.ruleId == null ? '' : ' · ${event.ruleId}'}'
              '${event.scope == null ? '' : ' · ${event.scope}'}',
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: colors.onSurfaceVariant),
            ),
            const SizedBox(height: 6),
            Text(
              event.message.length > 180
                  ? '${event.message.substring(0, 180)}…'
                  : event.message,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
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
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(Icons.info_outline, color: colors.onSurfaceVariant, size: 20),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                l10n.riskDisclaimer,
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: colors.onSurfaceVariant),
              ),
            ),
          ],
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

/// Version-safe accent badge: theme container colors only, no alpha math
/// (the project floor is Flutter 3.22, where `Color.withValues` does not
/// exist; `withOpacity` is deprecated at the ceiling - containers sidestep
/// both).
class _AccentBadge extends StatelessWidget {
  const _AccentBadge({required this.label, this.danger = true});

  final String label;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;
    final Color background = danger ? colors.errorContainer : colors.tertiaryContainer;
    final Color foreground = danger ? colors.onErrorContainer : colors.onTertiaryContainer;

    return Container(
      margin: const EdgeInsets.only(left: 6),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: Theme.of(context)
            .textTheme
            .labelSmall
            ?.copyWith(color: foreground, fontWeight: FontWeight.w700),
      ),
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
        style:
            Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
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

/// `BTC_USDT_EXPOSURE`-style enums read better on a phone without the
/// shout; nothing smarter than this, because the payload is the same one
/// the console shows and re-casing it here would drift from it.
String _titleCase(String value) {
  return value
      .toLowerCase()
      .split('_')
      .map((String word) =>
          word.isEmpty ? word : word[0].toUpperCase() + word.substring(1))
      .join(' ');
}

bool _isNegative(String? decimal) {
  return decimal != null && decimal.startsWith('-');
}

/// Local, dependency-free timestamp rendering (same rule as the strategies
/// screen: wall-clock time, never "2 hours ago", so incident reading is
/// unambiguous).
String _formatTimestamp(DateTime value) {
  String two(int input) => input.toString().padLeft(2, '0');
  return '${value.year}-${two(value.month)}-${two(value.day)} '
      '${two(value.hour)}:${two(value.minute)}';
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../../../core/di/feature_providers.dart';
import '../../../core/widgets/async_body.dart';
import '../../../l10n/app_localizations.dart';
import '../../exchange_accounts/domain/exchange_account_models.dart';
import '../domain/copy_models.dart';

/// Copy trading, follower side: Traders (ranking) · My copies · Activity.
class CopyTradingScreen extends ConsumerWidget {
  const CopyTradingScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          title: Text(l10n.copyTradingTitle),
          bottom: TabBar(tabs: <Widget>[Tab(text: l10n.tradersTab), Tab(text: l10n.myCopiesTab), Tab(text: l10n.activityTab)]),
        ),
        body: const TabBarView(children: <Widget>[_TradersTab(), _SubscriptionsTab(), _ExecutionsTab()]),
      ),
    );
  }
}

class _TradersTab extends ConsumerWidget {
  const _TradersTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return RefreshIndicator(
      onRefresh: () => ref.refresh(copyRankingsProvider.future),
      child: AsyncBody<List<RankedTrader>>(
        value: ref.watch(copyRankingsProvider),
        onRetry: () => ref.invalidate(copyRankingsProvider),
        isEmpty: (List<RankedTrader> rows) => rows.isEmpty,
        emptyText: l10n.noTraders,
        builder: (List<RankedTrader> rows) => ListView.builder(
          padding: const EdgeInsets.all(12),
          itemCount: rows.length,
          itemBuilder: (BuildContext context, int i) {
            final RankedTrader t = rows[i];
            return Card(
              child: ListTile(
                leading: CircleAvatar(child: Text('${t.rank > 0 ? t.rank : i + 1}')),
                title: Row(children: <Widget>[
                  Flexible(child: Text(t.displayName, overflow: TextOverflow.ellipsis)),
                  if (t.isVerified) const Padding(padding: EdgeInsets.only(left: 4), child: Icon(Icons.verified, size: 16)),
                ],),
                subtitle: Text(
                  '${l10n.followersLabel}: ${t.followerCount} · ${l10n.pnlLabel}: ${t.realizedPnl ?? '—'} · ${l10n.drawdownLabel}: ${t.maxDrawdown ?? '—'}',
                ),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => showModalBottomSheet<void>(
                  context: context,
                  isScrollControlled: true,
                  builder: (BuildContext context) => _TraderSheet(trader: t),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}

class _TraderSheet extends ConsumerWidget {
  const _TraderSheet({required this.trader});

  final RankedTrader trader;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Text(trader.displayName, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 4),
            Text('${l10n.pnlLabel}: ${trader.realizedPnl ?? '—'} · ${l10n.winRateLabel}: ${trader.winRate ?? '—'}'),
            const SizedBox(height: 4),
            Text(l10n.pastPerformanceNotice, style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 16),
            Text(l10n.strategiesTitle, style: Theme.of(context).textTheme.titleMedium),
            SizedBox(
              height: 260,
              child: AsyncBody<List<TraderStrategySummary>>(
                value: ref.watch(traderStrategiesProvider(trader.traderId)),
                onRetry: () => ref.invalidate(traderStrategiesProvider(trader.traderId)),
                isEmpty: (List<TraderStrategySummary> rows) => rows.where((TraderStrategySummary s) => s.isCopyable).isEmpty,
                emptyText: l10n.noCopyableStrategies,
                builder: (List<TraderStrategySummary> rows) => ListView(
                  children: <Widget>[
                    for (final TraderStrategySummary s in rows.where((TraderStrategySummary s) => s.isCopyable))
                      ListTile(
                        title: Text(s.name),
                        subtitle: s.description == null ? null : Text(s.description!, maxLines: 2, overflow: TextOverflow.ellipsis),
                        trailing: FilledButton(
                          onPressed: () async {
                            final bool? done = await showModalBottomSheet<bool>(
                              context: context,
                              isScrollControlled: true,
                              builder: (BuildContext context) => SubscribeSheet(trader: trader, strategy: s),
                            );
                            if (done == true && context.mounted) {
                              ref.invalidate(mySubscriptionsProvider);
                              Navigator.of(context).pop();
                            }
                          },
                          child: Text(l10n.copyAction),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Subscribe form: sizing mode, amount (decimal string), the follower's own
/// exchange account. A fresh idempotency key per form instance makes a
/// double tap or a retried request create one subscription, not two.
class SubscribeSheet extends ConsumerStatefulWidget {
  const SubscribeSheet({super.key, required this.trader, required this.strategy});

  final RankedTrader trader;
  final TraderStrategySummary strategy;

  @override
  ConsumerState<SubscribeSheet> createState() => _SubscribeSheetState();
}

class _SubscribeSheetState extends ConsumerState<SubscribeSheet> {
  final TextEditingController _amount = TextEditingController();
  final TextEditingController _max = TextEditingController();
  final String _idempotencyKey = const Uuid().v4();
  String _mode = CopySizingModes.all.first;
  String? _accountId;
  bool _acknowledged = false;
  bool _submitting = false;
  String? _problem;

  @override
  void dispose() {
    _amount.dispose();
    _max.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final SubscribeRequest request = SubscribeRequest(
      traderId: widget.trader.traderId,
      strategyId: widget.strategy.id,
      allocationMode: _mode,
      allocationAmount: _amount.text.trim(),
      maxAllocation: _max.text.trim(),
      followerAccountId: _accountId ?? '',
      idempotencyKey: _idempotencyKey,
    );
    final String? problem = request.validate();
    setState(() => _problem = problem);
    if (problem != null) {
      return;
    }
    setState(() => _submitting = true);
    final bool ok = await runAction(context, () => ref.read(copyTradingRepositoryProvider).subscribe(request), success: l10n.subscribed);
    if (!mounted) {
      return;
    }
    setState(() => _submitting = false);
    if (ok) {
      Navigator.of(context).pop(true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<List<ExchangeAccountSummary>> accounts = ref.watch(exchangeAccountsProvider);
    return Padding(
      padding: EdgeInsets.only(left: 20, right: 20, top: 20, bottom: MediaQuery.of(context).viewInsets.bottom + 20),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Text('${l10n.copyAction}: ${widget.strategy.name}', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 16),
            DropdownButtonFormField<String>(
              initialValue: _mode,
              decoration: InputDecoration(labelText: l10n.sizingModeLabel, border: const OutlineInputBorder()),
              items: CopySizingModes.all.map((String m) => DropdownMenuItem<String>(value: m, child: Text(m))).toList(),
              onChanged: (String? v) => setState(() => _mode = v ?? _mode),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _amount,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(labelText: l10n.allocationLabel, border: const OutlineInputBorder()),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _max,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(labelText: l10n.maxAllocationLabel, border: const OutlineInputBorder()),
            ),
            const SizedBox(height: 12),
            accounts.when(
              loading: () => const LinearProgressIndicator(),
              error: (Object e, StackTrace _) => Text(describeError(e, l10n)),
              data: (List<ExchangeAccountSummary> rows) {
                final List<ExchangeAccountSummary> usable = rows.where((ExchangeAccountSummary a) => !a.isDisabled).toList();
                if (usable.isEmpty) {
                  return Text(l10n.connectExchangeFirst);
                }
                return DropdownButtonFormField<String>(
                  initialValue: _accountId,
                  decoration: InputDecoration(labelText: l10n.copyingAccountLabel, border: const OutlineInputBorder()),
                  items: usable
                      .map((ExchangeAccountSummary a) => DropdownMenuItem<String>(value: a.id, child: Text('${a.label} · ${a.venue} · ${a.environment}')))
                      .toList(),
                  onChanged: (String? v) => setState(() => _accountId = v),
                );
              },
            ),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: _acknowledged,
              onChanged: (bool? v) => setState(() => _acknowledged = v ?? false),
              title: Text(l10n.copyRiskAcknowledgement, style: Theme.of(context).textTheme.bodySmall),
            ),
            if (_problem != null) Text(_problem!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: (!_acknowledged || _submitting) ? null : _submit,
              child: _submitting ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2)) : Text(l10n.startCopying),
            ),
          ],
        ),
      ),
    );
  }
}

class _SubscriptionsTab extends ConsumerWidget {
  const _SubscriptionsTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    Future<void> act(Future<void> Function() op, String ok) async {
      await runAction(context, op, success: ok);
      ref.invalidate(mySubscriptionsProvider);
    }

    return RefreshIndicator(
      onRefresh: () => ref.refresh(mySubscriptionsProvider.future),
      child: AsyncBody<List<CopySubscriptionSummary>>(
        value: ref.watch(mySubscriptionsProvider),
        onRetry: () => ref.invalidate(mySubscriptionsProvider),
        isEmpty: (List<CopySubscriptionSummary> rows) => rows.isEmpty,
        emptyText: l10n.noSubscriptions,
        builder: (List<CopySubscriptionSummary> rows) => ListView.builder(
          padding: const EdgeInsets.all(12),
          itemCount: rows.length,
          itemBuilder: (BuildContext context, int i) {
            final CopySubscriptionSummary s = rows[i];
            final repo = ref.read(copyTradingRepositoryProvider);
            return Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text('${s.state} · ${s.allocationMode} ${s.allocationAmount}', style: Theme.of(context).textTheme.titleSmall),
                    Text('${l10n.copiesLabel}: ${s.totalCopies} · ${l10n.failedLabel}: ${s.failedCopies}'),
                    Text('${l10n.startedLabel}: ${formatTimestamp(s.startedAt)}'),
                    Wrap(spacing: 8, children: <Widget>[
                      if (s.canPause) OutlinedButton(onPressed: () => act(() => repo.pause(s.id), l10n.paused), child: Text(l10n.pause)),
                      if (s.canResume) OutlinedButton(onPressed: () => act(() => repo.resume(s.id), l10n.resumed), child: Text(l10n.resume)),
                      if (s.canStop)
                        TextButton(
                          onPressed: () async {
                            if (await confirm(context, title: l10n.stopCopyingTitle, message: l10n.stopCopyingMessage)) {
                              await act(() => repo.stop(s.id), l10n.stopped);
                            }
                          },
                          child: Text(l10n.stop),
                        ),
                    ],),
                  ],
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}

class _ExecutionsTab extends ConsumerWidget {
  const _ExecutionsTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return RefreshIndicator(
      onRefresh: () => ref.refresh(copyExecutionsProvider.future),
      child: AsyncBody<List<CopyExecutionSummary>>(
        value: ref.watch(copyExecutionsProvider),
        onRetry: () => ref.invalidate(copyExecutionsProvider),
        isEmpty: (List<CopyExecutionSummary> rows) => rows.isEmpty,
        emptyText: l10n.noCopyActivity,
        builder: (List<CopyExecutionSummary> rows) => ListView.separated(
          itemCount: rows.length,
          separatorBuilder: (_, __) => const Divider(height: 1),
          itemBuilder: (BuildContext context, int i) {
            final CopyExecutionSummary e = rows[i];
            return ListTile(
              leading: Icon(e.isFailure ? Icons.error_outline : Icons.swap_horiz, color: e.isFailure ? Theme.of(context).colorScheme.error : null),
              title: Text('${e.side ?? ''} ${e.symbol ?? ''} ${e.followerQuantity ?? e.leaderQuantity}'.trim()),
              subtitle: Text('${e.status} · ${formatTimestamp(e.createdAt)}${e.failureReason == null ? '' : '\n${e.failureReason}'}'),
              isThreeLine: e.failureReason != null,
            );
          },
        ),
      ),
    );
  }
}

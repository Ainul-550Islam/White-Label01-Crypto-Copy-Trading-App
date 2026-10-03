import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/feature_providers.dart';
import '../../../core/widgets/async_body.dart';
import '../../../l10n/app_localizations.dart';
import '../domain/funding_models.dart';

/// Funding: the customer's accounts with "request deposit", and the history of
/// deposit and withdrawal requests. No withdraw action on mobile, by design.
class FundingScreen extends ConsumerWidget {
  const FundingScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: Text(l10n.fundingTitle),
          bottom: TabBar(tabs: <Widget>[Tab(text: l10n.accountsTab), Tab(text: l10n.transactionsTab)]),
        ),
        body: TabBarView(
          children: <Widget>[
            RefreshIndicator(
              onRefresh: () => ref.refresh(fundingAccountsProvider.future),
              child: AsyncBody<List<FundingAccountSummary>>(
                value: ref.watch(fundingAccountsProvider),
                onRetry: () => ref.invalidate(fundingAccountsProvider),
                isEmpty: (List<FundingAccountSummary> rows) => rows.isEmpty,
                emptyText: l10n.noFundingAccounts,
                builder: (List<FundingAccountSummary> rows) => ListView(
                  padding: const EdgeInsets.all(12),
                  children: <Widget>[
                    for (final FundingAccountSummary a in rows)
                      Card(
                        child: ListTile(
                          leading: const Icon(Icons.account_balance_outlined),
                          title: Text(a.label),
                          subtitle: Text(a.canDeposit ? a.state : '${a.state} · ${l10n.depositsUnavailable}'),
                          trailing: a.canDeposit
                              ? FilledButton.tonal(onPressed: () => _requestDeposit(context, ref, a), child: Text(l10n.depositLabel))
                              : null,
                        ),
                      ),
                    Padding(
                      padding: const EdgeInsets.all(12),
                      child: Text(l10n.withdrawOnWebNotice, style: Theme.of(context).textTheme.bodySmall),
                    ),
                  ],
                ),
              ),
            ),
            RefreshIndicator(
              onRefresh: () => ref.refresh(fundingHistoryProvider.future),
              child: AsyncBody<List<FundingRequestSummary>>(
                value: ref.watch(fundingHistoryProvider),
                onRetry: () => ref.invalidate(fundingHistoryProvider),
                isEmpty: (List<FundingRequestSummary> rows) => rows.isEmpty,
                emptyText: l10n.noTransactions,
                builder: (List<FundingRequestSummary> rows) => ListView.separated(
                  itemCount: rows.length + 1,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (BuildContext context, int i) {
                    if (i == 0) {
                      return Padding(
                        padding: const EdgeInsets.all(12),
                        child: Text(l10n.pendingNotCompleted, style: Theme.of(context).textTheme.bodySmall),
                      );
                    }
                    final FundingRequestSummary t = rows[i - 1];
                    final bool deposit = t.direction == FundingDirection.deposit;
                    final String confirmed = t.confirmedAmount == null ? '' : ' · ${l10n.confirmedAmountLabel} ${t.confirmedAmount} ${t.currency}';
                    return ListTile(
                      leading: Icon(deposit ? Icons.south_west : Icons.north_east),
                      title: Text('${deposit ? l10n.depositLabel : l10n.withdrawalLabel} · ${t.requestedAmount} ${t.currency}'),
                      subtitle: Text(
                        '${t.state.replaceAll('_', ' ')}$confirmed · ${formatTimestamp(t.requestedAt)}'
                        '${t.failureReason == null ? '' : '\n${t.failureReason}'}',
                      ),
                      isThreeLine: t.failureReason != null,
                      trailing: t.isConfirmed
                          ? const Icon(Icons.check_circle_outline)
                          : t.isOpen
                              ? const Icon(Icons.hourglass_empty)
                              : const Icon(Icons.block_outlined),
                    );
                  },
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _requestDeposit(BuildContext context, WidgetRef ref, FundingAccountSummary account) async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final _DepositDraft? draft = await showDialog<_DepositDraft>(
      context: context,
      builder: (BuildContext context) => _DepositDialog(account: account),
    );
    if (draft == null || !context.mounted) {
      return;
    }
    final bool ok = await runAction(
      context,
      () async {
        await ref.read(fundingRepositoryProvider).requestDeposit(
              account: account,
              amount: draft.amount,
              currency: draft.currency,
              externalReference: draft.reference,
            );
      },
      success: l10n.depositRequested,
    );
    if (ok) {
      ref.invalidate(fundingHistoryProvider);
    }
  }
}

class _DepositDraft {
  const _DepositDraft({required this.amount, required this.currency, required this.reference});

  final String amount;
  final String currency;
  final String reference;
}

class _DepositDialog extends StatefulWidget {
  const _DepositDialog({required this.account});

  final FundingAccountSummary account;

  @override
  State<_DepositDialog> createState() => _DepositDialogState();
}

class _DepositDialogState extends State<_DepositDialog> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _amount = TextEditingController();
  final TextEditingController _currency = TextEditingController(text: 'USDT');
  final TextEditingController _reference = TextEditingController();

  @override
  void dispose() {
    _amount.dispose();
    _currency.dispose();
    _reference.dispose();
    super.dispose();
  }

  void _submit() {
    if (_formKey.currentState?.validate() ?? false) {
      Navigator.of(context).pop(
        _DepositDraft(amount: _amount.text.trim(), currency: _currency.text.trim().toUpperCase(), reference: _reference.text.trim()),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return AlertDialog(
      title: Text('${l10n.requestDeposit} · ${widget.account.label}'),
      content: Form(
        key: _formKey,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              TextFormField(
                controller: _amount,
                decoration: InputDecoration(labelText: l10n.amountLabel),
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                validator: (String? v) => FundingInput.isPositiveAmount((v ?? '').trim()) ? null : l10n.invalidAmount,
              ),
              TextFormField(
                controller: _currency,
                decoration: InputDecoration(labelText: l10n.currencyLabel),
                textCapitalization: TextCapitalization.characters,
                validator: (String? v) => FundingInput.isCurrencyCode((v ?? '').trim().toUpperCase()) ? null : l10n.invalidCurrency,
              ),
              TextFormField(
                controller: _reference,
                decoration: InputDecoration(labelText: l10n.transferReferenceLabel),
                maxLength: 120,
              ),
              const SizedBox(height: 8),
              Text(l10n.depositRequestNotice, style: Theme.of(context).textTheme.bodySmall),
            ],
          ),
        ),
      ),
      actions: <Widget>[
        TextButton(onPressed: () => Navigator.of(context).pop(), child: Text(l10n.cancel)),
        FilledButton(onPressed: _submit, child: Text(l10n.requestDeposit)),
      ],
    );
  }
}

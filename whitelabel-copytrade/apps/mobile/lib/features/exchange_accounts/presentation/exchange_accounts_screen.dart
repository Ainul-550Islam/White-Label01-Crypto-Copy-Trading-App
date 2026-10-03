import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/feature_providers.dart';
import '../../../core/widgets/async_body.dart';
import '../../../l10n/app_localizations.dart';
import '../domain/exchange_account_models.dart';

/// Exchange accounts: status, health check, disable, and connecting a new
/// account with API keys (sent once, never stored on the device).
class ExchangeAccountsScreen extends ConsumerWidget {
  const ExchangeAccountsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<List<ExchangeAccountSummary>> accounts = ref.watch(exchangeAccountsProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.exchangeAccountsTitle)),
      floatingActionButton: FloatingActionButton.extended(
        icon: const Icon(Icons.add_link),
        label: Text(l10n.connectExchange),
        onPressed: () async {
          final bool? connected = await showModalBottomSheet<bool>(
            context: context,
            isScrollControlled: true,
            builder: (BuildContext context) => const ConnectExchangeSheet(),
          );
          if (connected == true) {
            ref.invalidate(exchangeAccountsProvider);
          }
        },
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(exchangeAccountsProvider.future),
        child: AsyncBody<List<ExchangeAccountSummary>>(
          value: accounts,
          onRetry: () => ref.invalidate(exchangeAccountsProvider),
          isEmpty: (List<ExchangeAccountSummary> rows) => rows.isEmpty,
          emptyText: l10n.noExchangeAccounts,
          builder: (List<ExchangeAccountSummary> rows) => ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
            itemCount: rows.length,
            separatorBuilder: (_, __) => const SizedBox(height: 12),
            itemBuilder: (BuildContext context, int index) => _AccountCard(account: rows[index]),
          ),
        ),
      ),
    );
  }
}

class _AccountCard extends ConsumerWidget {
  const _AccountCard({required this.account});

  final ExchangeAccountSummary account;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ColorScheme colors = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    account.label.isEmpty ? account.venue : '${account.label} · ${account.venue}',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                Chip(
                  label: Text(account.environment),
                  backgroundColor: account.isLive ? colors.errorContainer : colors.secondaryContainer,
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text('${l10n.apiKeyLabel}: ${account.maskedApiKey}'),
            Text('${l10n.statusLabel}: ${account.status}${account.healthState == null ? '' : ' · ${account.healthState}'}'),
            if (account.lastErrorCode != null)
              Text('${l10n.lastErrorLabel}: ${account.lastErrorCode}', style: TextStyle(color: colors.error)),
            Text('${l10n.lastVerifiedLabel}: ${formatTimestamp(account.lastVerifiedAt)}'),
            if (account.isLive && !account.liveTradingEnabled)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(l10n.liveTradingOffNotice, style: Theme.of(context).textTheme.bodySmall),
              ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: <Widget>[
                OutlinedButton.icon(
                  icon: const Icon(Icons.monitor_heart_outlined),
                  label: Text(l10n.checkHealth),
                  onPressed: () async {
                    await runAction(context, () => ref.read(exchangeAccountRepositoryProvider).runHealthCheck(account.id), success: l10n.healthCheckDone);
                    ref.invalidate(exchangeAccountsProvider);
                  },
                ),
                if (!account.isDisabled)
                  TextButton.icon(
                    icon: const Icon(Icons.block),
                    label: Text(l10n.disable),
                    onPressed: () async {
                      if (!await confirm(context, title: l10n.disableAccountTitle, message: l10n.disableAccountMessage)) {
                        return;
                      }
                      if (!context.mounted) {
                        return;
                      }
                      await runAction(context, () => ref.read(exchangeAccountRepositoryProvider).disableAccount(account.id), success: l10n.accountDisabled);
                      ref.invalidate(exchangeAccountsProvider);
                    },
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// The connect form. Secret controllers are cleared in [dispose]; nothing is
/// persisted and fields are obscured with autocorrect/suggestions off.
class ConnectExchangeSheet extends ConsumerStatefulWidget {
  const ConnectExchangeSheet({super.key});

  @override
  ConsumerState<ConnectExchangeSheet> createState() => _ConnectExchangeSheetState();
}

class _ConnectExchangeSheetState extends ConsumerState<ConnectExchangeSheet> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _label = TextEditingController();
  final TextEditingController _apiKey = TextEditingController();
  final TextEditingController _apiSecret = TextEditingController();
  final TextEditingController _passphrase = TextEditingController();
  String _venue = ExchangeVenues.all.first;
  String _environment = ExchangeEnvironments.all.first;
  bool _submitting = false;

  @override
  void dispose() {
    for (final TextEditingController c in <TextEditingController>[_apiKey, _apiSecret, _passphrase]) {
      c.clear();
    }
    _label.dispose();
    _apiKey.dispose();
    _apiSecret.dispose();
    _passphrase.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }
    final AppLocalizations l10n = AppLocalizations.of(context);
    setState(() => _submitting = true);
    final bool ok = await runAction(
      context,
      () => ref.read(exchangeAccountRepositoryProvider).connect(
            ConnectExchangeRequest(
              venue: _venue,
              environment: _environment,
              label: _label.text.trim(),
              apiKey: _apiKey.text.trim(),
              apiSecret: _apiSecret.text.trim(),
              passphrase: ExchangeVenues.needsPassphrase(_venue) ? _passphrase.text.trim() : null,
            ),
          ),
      success: l10n.exchangeConnected,
    );
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
    String? required(String? v) => (v == null || v.trim().isEmpty) ? l10n.fieldRequired : null;
    InputDecoration deco(String label) => InputDecoration(labelText: label, border: const OutlineInputBorder());

    return Padding(
      padding: EdgeInsets.only(left: 20, right: 20, top: 20, bottom: MediaQuery.of(context).viewInsets.bottom + 20),
      child: Form(
        key: _formKey,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Text(l10n.connectExchange, style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 16),
              DropdownButtonFormField<String>(
                initialValue: _venue,
                decoration: deco(l10n.venueLabel),
                items: ExchangeVenues.all.map((String v) => DropdownMenuItem<String>(value: v, child: Text(v))).toList(),
                onChanged: (String? v) => setState(() => _venue = v ?? _venue),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: _environment,
                decoration: deco(l10n.environmentLabel),
                items: ExchangeEnvironments.all.map((String v) => DropdownMenuItem<String>(value: v, child: Text(v))).toList(),
                onChanged: (String? v) => setState(() => _environment = v ?? _environment),
              ),
              if (_environment == 'LIVE')
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(l10n.liveKeyWarning, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                ),
              const SizedBox(height: 12),
              TextFormField(controller: _label, decoration: deco(l10n.accountLabel), validator: required, maxLength: 80),
              TextFormField(
                controller: _apiKey,
                decoration: deco(l10n.apiKeyLabel),
                validator: required,
                autocorrect: false,
                enableSuggestions: false,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _apiSecret,
                decoration: deco(l10n.apiSecretLabel),
                validator: required,
                obscureText: true,
                autocorrect: false,
                enableSuggestions: false,
              ),
              if (ExchangeVenues.needsPassphrase(_venue)) ...<Widget>[
                const SizedBox(height: 12),
                TextFormField(
                  controller: _passphrase,
                  decoration: deco(l10n.passphraseLabel),
                  validator: required,
                  obscureText: true,
                  autocorrect: false,
                  enableSuggestions: false,
                ),
              ],
              const SizedBox(height: 8),
              Text(l10n.tradeOnlyKeysNotice, style: Theme.of(context).textTheme.bodySmall),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: _submitting ? null : _submit,
                child: _submitting ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2)) : Text(l10n.connect),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

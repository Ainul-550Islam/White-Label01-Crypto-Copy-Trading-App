import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/providers.dart';
import '../../../l10n/app_localizations.dart';
import '../data/copy_budget_repository.dart';
import '../domain/copy_budget.dart';

/// Separate from risk-policy controls: only the caller's copy budget may be
/// reduced here. Halts, account risk policies and widening remain elsewhere.
class CopyBudgetCard extends ConsumerStatefulWidget {
  const CopyBudgetCard({super.key});

  @override
  ConsumerState<CopyBudgetCard> createState() => _CopyBudgetCardState();
}

class _CopyBudgetCardState extends ConsumerState<CopyBudgetCard> {
  final GlobalKey<FormState> _form = GlobalKey<FormState>();
  final TextEditingController _maximum = TextEditingController();
  CopyBudgetRepository? _repository;
  int _epoch = 0;
  CopyBudget? _budget;
  bool _loading = true;
  bool _saving = false;
  bool _failed = false;
  bool _saved = false;

  @override
  void initState() {
    super.initState();
    _repository = _newRepository();
    _load();
  }

  CopyBudgetRepository? _newRepository() {
    final state = ref.read(authControllerProvider);
    final user = state.isAuthenticated ? state.user : null;
    if (user == null || user.tenantId.isEmpty || user.id.isEmpty) return null;
    return CopyBudgetRepository(
      ref.read(apiClientProvider),
      tenantId: user.tenantId,
      userId: user.id,
      storage: ref.read(secureStorageProvider),
    );
  }

  @override
  void dispose() {
    _maximum.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final int epoch = ++_epoch;
    setState(() {
      _loading = true;
      _failed = false;
      _saved = false;
      _budget = null;
    });
    try {
      final CopyBudgetRepository? repository = _repository;
      if (repository == null) {
        throw const FormatException('Missing budget owner');
      }
      final CopyBudget budget = await repository.fetch();
      if (!mounted || epoch != _epoch) return;
      setState(() {
        _budget = budget;
        _loading = false;
      });
    } catch (_) {
      if (!mounted || epoch != _epoch) return;
      setState(() {
        _loading = false;
        _failed = true;
      });
    }
  }

  String? _validate(String? raw, AppLocalizations l10n) {
    final String value = normaliseBudgetInput(raw ?? '');
    if (!isValidBudgetReduction(value)) return l10n.copyBudgetInvalid;
    final String? current = _budget?.effectiveCap;
    if (current != null && compareBudgetDecimals(value, current) > 0) {
      return l10n.copyBudgetTooHigh;
    }
    return null;
  }

  Future<void> _reduce() async {
    final CopyBudget? before = _budget;
    if (before == null ||
        before.currency == null ||
        _saving ||
        !(_form.currentState?.validate() ?? false)) {
      return;
    }
    final String value = normaliseBudgetInput(_maximum.text);
    final int epoch = _epoch;
    setState(() {
      _saving = true;
      _failed = false;
      _saved = false;
    });
    try {
      final CopyBudgetRepository? repository = _repository;
      if (repository == null) {
        throw const FormatException('Missing budget owner');
      }
      final CopyBudget updated =
          await repository.reduce(maximum: value, currency: before.currency!);
      if (!mounted || epoch != _epoch) return;
      setState(() {
        _budget = updated;
        _saving = false;
        _saved = true;
        _maximum.clear();
      });
    } catch (_) {
      if (!mounted || epoch != _epoch) return;
      setState(() {
        _saving = false;
        _failed = true;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    // Discard both cached values and retry keys when the signed-in identity
    // changes, and ignore responses belonging to the old identity.
    ref.listen<String?>(
      authControllerProvider.select(
        (state) => state.isAuthenticated
            ? '${state.user!.tenantId}:${state.user!.id}'
            : null,
      ),
      (String? previous, String? next) {
        if (previous == next) return;
        _epoch++;
        _repository = _newRepository();
        _maximum.clear();
        setState(() {
          _budget = null;
          _loading = false;
          _saving = false;
          _failed = false;
          _saved = false;
        });
        if (next != null) _load();
      },
    );
    final AppLocalizations l10n = AppLocalizations.of(context);
    final CopyBudget? budget = _budget;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              l10n.copyBudgetTitle,
              style: Theme.of(context).textTheme.titleSmall,
            ),
            const SizedBox(height: 8),
            Text(l10n.copyBudgetAbout),
            if (_loading) ...<Widget>[
              const SizedBox(height: 12),
              const Center(child: CircularProgressIndicator()),
            ] else if (budget == null) ...<Widget>[
              const SizedBox(height: 8),
              Semantics(
                liveRegion: true,
                child: Text(l10n.copyBudgetUnavailable),
              ),
              TextButton(onPressed: _load, child: Text(l10n.retry)),
            ] else ...<Widget>[
              const SizedBox(height: 12),
              Text(
                '${l10n.copyBudgetEffective}: ${budget.effectiveCap == null ? l10n.copyBudgetUnlimited : '${budget.effectiveCap} ${budget.currency}'}',
              ),
              Text(
                '${l10n.copyBudgetCommitted}: ${budget.committed ?? l10n.copyBudgetMetricUnavailable}',
              ),
              Text(l10n.copyBudgetEstimateWarning),
              if (budget.effectiveCap != null)
                Semantics(
                  liveRegion: true,
                  child: Text(l10n.copyBudgetEnforcementUnavailable),
                ),
              if (budget.currency == null)
                Text(l10n.copyBudgetCurrencyUnavailable),
              const SizedBox(height: 12),
              Form(
                key: _form,
                child: TextFormField(
                  controller: _maximum,
                  enabled: !_saving && budget.currency != null,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  decoration: InputDecoration(
                    labelText: budget.currency == null
                        ? l10n.copyBudgetNewLimit
                        : '${l10n.copyBudgetNewLimit} (${budget.currency})',
                    helperText: l10n.copyBudgetHelp,
                    helperMaxLines: 3,
                    errorMaxLines: 3,
                  ),
                  validator: (String? value) => _validate(value, l10n),
                  onChanged: (_) {
                    if (_saved || _failed) {
                      setState(() {
                        _saved = false;
                        _failed = false;
                      });
                    }
                  },
                ),
              ),
              const SizedBox(height: 8),
              FilledButton(
                onPressed: _saving || budget.currency == null ? null : _reduce,
                child: Text(
                  _saving ? l10n.copyBudgetSaving : l10n.copyBudgetReduce,
                ),
              ),
              if (_failed) ...<Widget>[
                const SizedBox(height: 8),
                Semantics(
                  liveRegion: true,
                  child: Text(
                    l10n.copyBudgetFailed,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ),
                TextButton(
                  onPressed: _saving ? null : _load,
                  child: Text(l10n.retry),
                ),
              ],
              if (_saved) ...<Widget>[
                const SizedBox(height: 8),
                Semantics(liveRegion: true, child: Text(l10n.copyBudgetSaved)),
              ],
            ],
          ],
        ),
      ),
    );
  }
}

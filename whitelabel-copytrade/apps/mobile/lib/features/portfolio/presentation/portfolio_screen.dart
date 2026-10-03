import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/feature_providers.dart';
import '../../../core/widgets/async_body.dart';
import '../../../l10n/app_localizations.dart';
import '../domain/portfolio_models.dart';

/// Read-only portfolio: holdings, NAV and PnL from the accounting ledger.
class PortfolioScreen extends ConsumerStatefulWidget {
  const PortfolioScreen({super.key});

  @override
  ConsumerState<PortfolioScreen> createState() => _PortfolioScreenState();
}

class _PortfolioScreenState extends ConsumerState<PortfolioScreen> {
  PortfolioProfile? _selected;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.portfolioTitle)),
      body: AsyncBody<List<PortfolioProfile>>(
        value: ref.watch(portfolioProfilesProvider),
        onRetry: () => ref.invalidate(portfolioProfilesProvider),
        isEmpty: (List<PortfolioProfile> rows) => rows.isEmpty,
        emptyText: l10n.noPortfolio,
        builder: (List<PortfolioProfile> profiles) {
          final PortfolioProfile profile = profiles.contains(_selected) ? _selected! : profiles.first;
          return Column(
            children: <Widget>[
              if (profiles.length > 1)
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                  child: DropdownButtonFormField<PortfolioProfile>(
                    initialValue: profile,
                    decoration: InputDecoration(labelText: l10n.portfolioLabel, border: const OutlineInputBorder()),
                    items: profiles
                        .map((PortfolioProfile p) => DropdownMenuItem<PortfolioProfile>(value: p, child: Text('${p.scope} · ${p.baseCurrency}')))
                        .toList(),
                    onChanged: (PortfolioProfile? p) => setState(() => _selected = p),
                  ),
                ),
              Expanded(
                child: RefreshIndicator(
                  onRefresh: () => ref.refresh(portfolioOverviewProvider(profile).future),
                  child: AsyncBody<PortfolioOverview>(
                    value: ref.watch(portfolioOverviewProvider(profile)),
                    onRetry: () => ref.invalidate(portfolioOverviewProvider(profile)),
                    builder: (PortfolioOverview o) => ListView(
                      padding: const EdgeInsets.all(16),
                      children: <Widget>[
                        if (o.degraded.isNotEmpty)
                          Card(
                            color: Theme.of(context).colorScheme.errorContainer,
                            child: Padding(padding: const EdgeInsets.all(12), child: Text('${l10n.partialDataNotice}: ${o.degraded.join(', ')}')),
                          ),
                        _FactsCard(title: l10n.navLabel, facts: o.nav),
                        _FactsCard(title: l10n.pnlLabel, facts: o.pnl),
                        Card(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: <Widget>[
                              Padding(padding: const EdgeInsets.all(12), child: Text(l10n.holdingsLabel, style: Theme.of(context).textTheme.titleMedium)),
                              if (o.holdings.isEmpty) Padding(padding: const EdgeInsets.all(12), child: Text(l10n.nothingHereYet)),
                              for (final Holding h in o.holdings)
                                ListTile(
                                  dense: true,
                                  title: Text(h.asset),
                                  subtitle: h.classification == null ? null : Text(h.classification!),
                                  trailing: Text('${h.quantity}${h.costBasis == null ? '' : '\n${l10n.costBasisLabel}: ${h.costBasis}'}', textAlign: TextAlign.end),
                                ),
                            ],
                          ),
                        ),
                        Text('${l10n.baseCurrencyLabel}: ${o.profile.baseCurrency}', style: Theme.of(context).textTheme.bodySmall),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _FactsCard extends StatelessWidget {
  const _FactsCard({required this.title, required this.facts});

  final String title;
  final PortfolioFacts facts;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(title, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 6),
            if (facts.isEmpty) const Text('—'),
            for (final MapEntry<String, String> e in facts.entries)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Row(children: <Widget>[Expanded(child: Text(e.key)), Text(e.value)]),
              ),
          ],
        ),
      ),
    );
  }
}

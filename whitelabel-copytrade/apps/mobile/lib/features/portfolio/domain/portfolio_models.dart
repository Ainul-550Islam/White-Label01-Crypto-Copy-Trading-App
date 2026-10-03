import 'package:equatable/equatable.dart';

import '../../../core/network/json_read.dart';

class PortfolioProfile extends Equatable {
  const PortfolioProfile({required this.id, required this.scope, required this.baseCurrency, this.portfolioType});

  factory PortfolioProfile.fromJson(Map<String, Object?> json) => PortfolioProfile(
        id: JsonRead.strOr(json, 'id', ''),
        scope: JsonRead.strOr(json, 'scope', 'UNKNOWN'),
        baseCurrency: JsonRead.strOr(json, 'baseCurrency', 'USD'),
        portfolioType: JsonRead.str(json, 'portfolioType'),
      );

  final String id;
  final String scope;
  final String baseCurrency;
  final String? portfolioType;

  @override
  List<Object?> get props => <Object?>[id, scope, baseCurrency, portfolioType];
}

class Holding extends Equatable {
  const Holding({required this.asset, required this.quantity, this.costBasis, this.classification});

  factory Holding.fromJson(Map<String, Object?> json) => Holding(
        asset: JsonRead.strOr(json, 'asset', '—'),
        quantity: JsonRead.strOr(json, 'quantity', '0'),
        costBasis: JsonRead.str(json, 'costBasis'),
        classification: JsonRead.str(json, 'classification'),
      );

  final String asset;
  final String quantity;
  final String? costBasis;
  final String? classification;

  @override
  List<Object?> get props => <Object?>[asset, quantity, costBasis, classification];
}

/// NAV / PnL answers are shown as the scalar facts the API returned, labelled
/// by their field names. Nothing is recomputed on the device (the ledger is
/// authoritative) and nested structures are not flattened into guesses.
class PortfolioFacts extends Equatable {
  const PortfolioFacts(this.entries);

  factory PortfolioFacts.fromJson(Object? data) {
    final Map<String, Object?> json = JsonRead.map(data);
    final List<MapEntry<String, String>> entries = <MapEntry<String, String>>[];
    json.forEach((String key, Object? value) {
      if (value == null || value is Map || value is List) {
        return;
      }
      if (key == 'tenantId' || key == 'profileId' || key.endsWith('Id')) {
        return;
      }
      entries.add(MapEntry<String, String>(key, value.toString()));
    });
    return PortfolioFacts(List<MapEntry<String, String>>.unmodifiable(entries));
  }

  final List<MapEntry<String, String>> entries;

  bool get isEmpty => entries.isEmpty;

  @override
  List<Object?> get props => <Object?>[entries.map((MapEntry<String, String> e) => '${e.key}=${e.value}').join('|')];
}

class PortfolioOverview extends Equatable {
  const PortfolioOverview({required this.profile, required this.holdings, required this.nav, required this.pnl, this.degraded = const <String>[]});

  final PortfolioProfile profile;
  final List<Holding> holdings;
  final PortfolioFacts nav;
  final PortfolioFacts pnl;

  /// Panels that failed while others loaded.
  final List<String> degraded;

  @override
  List<Object?> get props => <Object?>[profile, holdings, nav, pnl, degraded];
}

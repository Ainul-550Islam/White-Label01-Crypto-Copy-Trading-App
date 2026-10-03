import '../../../core/error/app_exception.dart';
import '../../../core/logging/app_logger.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_endpoints.dart';
import '../../../core/network/json_read.dart';
import '../domain/portfolio_models.dart';

/// Read-only portfolio accounting: profiles, holdings, NAV, PnL. GETs only.
class PortfolioRepository {
  PortfolioRepository({required ApiClient apiClient, required AppLogger logger})
      : _apiClient = apiClient,
        _logger = logger;

  final ApiClient _apiClient;
  final AppLogger _logger;

  Future<List<PortfolioProfile>> fetchProfiles() {
    return _apiClient.get<List<PortfolioProfile>>(
      ApiEndpoints.portfolioProfiles,
      parser: (Object? data) => JsonRead.rows(data).map(PortfolioProfile.fromJson).toList(growable: false),
    );
  }

  Future<PortfolioOverview> fetchOverview(PortfolioProfile profile) async {
    final Map<String, Object?> query = <String, Object?>{'profileId': profile.id};
    final List<String> degraded = <String>[];

    Future<T> attempt<T>(String panel, Future<T> Function() op, T fallback) async {
      try {
        return await op();
      } on AppException catch (error) {
        degraded.add(panel);
        _logger.warning('portfolio.panel_failed', context: <String, Object?>{'panel': panel, 'code': error.code.name});
        return fallback;
      }
    }

    final List<Object?> results = await Future.wait<Object?>(<Future<Object?>>[
      attempt<List<Holding>>(
        'holdings',
        () => _apiClient.get<List<Holding>>(
          ApiEndpoints.portfolioHoldings,
          queryParameters: query,
          parser: (Object? data) {
            final Object? holdings = data is Map ? (data['holdings'] ?? data) : data;
            return JsonRead.rows(holdings).map(Holding.fromJson).toList(growable: false);
          },
        ),
        const <Holding>[],
      ),
      attempt<PortfolioFacts>('nav', () => _apiClient.get<PortfolioFacts>(ApiEndpoints.portfolioNav, queryParameters: query, parser: PortfolioFacts.fromJson), const PortfolioFacts(<MapEntry<String, String>>[])),
      attempt<PortfolioFacts>('pnl', () => _apiClient.get<PortfolioFacts>(ApiEndpoints.portfolioPnl, queryParameters: query, parser: PortfolioFacts.fromJson), const PortfolioFacts(<MapEntry<String, String>>[])),
    ]);

    if (degraded.length == 3) {
      throw const AppException(code: AppErrorCode.server, message: 'Portfolio data is unavailable right now.');
    }

    return PortfolioOverview(
      profile: profile,
      holdings: results[0]! as List<Holding>,
      nav: results[1]! as PortfolioFacts,
      pnl: results[2]! as PortfolioFacts,
      degraded: List<String>.unmodifiable(degraded),
    );
  }
}

import 'package:flutter_test/flutter_test.dart';
import 'package:wlct_mobile/features/strategies/data/strategy_repository.dart';
import 'package:wlct_mobile/features/strategies/domain/strategy_models.dart';
import 'package:wlct_mobile/features/strategies/presentation/strategy_controller.dart';
import 'package:wlct_mobile/features/strategies/presentation/strategy_state.dart';
import '../support/http_harness.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
      'controller loads strategy summaries and simulator panels from real repository',
      () async {
    final HttpHarness h = HttpHarness((options) {
      if (options.path.endsWith('/metrics')) {
        return FixtureResponse.ok(<String, Object?>{
          'instances': <String, Object?>{'total': 1},
          'configuration': <String, Object?>{'tradingMode': 'PAPER'},
        });
      }
      if (options.path.endsWith('/instances')) {
        return FixtureResponse.ok(<String, Object?>{
          'items': <Object?>[
            <String, Object?>{
              'id': 's1',
              'name': 'Alpha',
              'status': 'RUNNING',
              'health': 'DEGRADED',
              'symbols': <String>['BTC-USDT'],
            }
          ],
        });
      }
      return FixtureResponse.ok(<String, Object?>{'items': <Object?>[]});
    });
    final StrategyController controller = StrategyController(
      repository: StrategyRepository(apiClient: h.api, logger: h.logger),
      logger: h.logger,
    );
    await controller.load();
    expect(controller.state.status, StrategyViewStatus.ready);
    expect(controller.state.instances.single.name, 'Alpha');
    expect(
      controller.state.instances.single.status,
      StrategyInstanceStatus.running,
    );
    expect(controller.state.attentionInstances.single.id, 's1');
    expect(controller.state.overview?.tradingMode, 'PAPER');
    expect(h.transport.requests, hasLength(4));
    expect(h.transport.requests.every((r) => r.method == 'GET'), isTrue);
    controller.dispose();
  });

  test('one failed panel is degraded; all failures are page failure', () async {
    bool failAll = false;
    final HttpHarness h = HttpHarness(
      (options) => failAll || options.path.endsWith('/backtests')
          ? FixtureResponse.error(503, 'SERVICE_UNAVAILABLE', 'Unavailable')
          : FixtureResponse.ok(
              options.path.endsWith('/metrics')
                  ? <String, Object?>{}
                  : <String, Object?>{'items': <Object?>[]},
            ),
    );
    final StrategyController controller = StrategyController(
      repository: StrategyRepository(apiClient: h.api, logger: h.logger),
      logger: h.logger,
    );
    await controller.load();
    expect(controller.state.status, StrategyViewStatus.ready);
    expect(controller.state.degradedPanels, contains('backtests'));
    failAll = true;
    await controller.refresh();
    expect(controller.state.status, StrategyViewStatus.failed);
    expect(controller.state.error?.statusCode, 503);
    controller.dispose();
  });
}

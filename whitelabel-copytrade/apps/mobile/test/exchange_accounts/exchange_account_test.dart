import 'package:flutter_test/flutter_test.dart';
import 'package:wlct_mobile/core/error/app_exception.dart';
import 'package:wlct_mobile/features/exchange_accounts/data/exchange_account_repository.dart';
import 'package:wlct_mobile/features/exchange_accounts/domain/exchange_account_models.dart';
import '../support/http_harness.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
      'connect returns only the masked server account, then disable and health check use correct routes',
      () async {
    final HttpHarness h = HttpHarness(
      (options) => FixtureResponse.ok(<String, Object?>{
        'accountId': 'acct',
        'venue': 'OKX',
        'environment': 'TESTNET',
        'maskedApiKey': '****ABCD',
        'status': 'ACTIVE',
      }),
    );
    final ExchangeAccountRepository repo =
        ExchangeAccountRepository(apiClient: h.api, logger: h.logger);
    const ConnectExchangeRequest request = ConnectExchangeRequest(
      venue: 'OKX',
      environment: 'TESTNET',
      label: 'Main',
      apiKey: 'key',
      apiSecret: 'secret',
      passphrase: 'pass',
    );
    final ExchangeAccountSummary account = await repo.connect(request);
    await repo.runHealthCheck(account.id);
    await repo.disableAccount(account.id, reason: 'Requested');
    expect(account.maskedApiKey, '****ABCD');
    expect(request.toString(), isNot(contains('secret')));
    expect(h.transport.requests.map((r) => r.uri.path).toList(), <String>[
      '/api/v1/exchanges/accounts',
      '/api/v1/exchanges/health/acct/check',
      '/api/v1/exchanges/accounts/acct/disable',
    ]);
    expect((h.transport.requests.last.data as Map)['reason'], 'Requested');
  });

  test('permission denial propagates as an actionable domain error', () async {
    final HttpHarness h = HttpHarness(
      (options) => FixtureResponse.error(
        403,
        'FORBIDDEN',
        'You do not have permission to do that.',
      ),
    );
    final ExchangeAccountRepository repo =
        ExchangeAccountRepository(apiClient: h.api, logger: h.logger);
    await expectLater(
      repo.runHealthCheck('acct'),
      throwsA(
        isA<AppException>()
            .having((e) => e.code, 'code', AppErrorCode.forbidden)
            .having((e) => e.message, 'message', contains('permission')),
      ),
    );
  });
}

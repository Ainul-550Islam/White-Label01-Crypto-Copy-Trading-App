import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:wlct_mobile/core/network/json_read.dart';
import 'package:wlct_mobile/features/copy_trading/domain/copy_models.dart';
import 'package:wlct_mobile/features/exchange_accounts/domain/exchange_account_models.dart';
import 'package:wlct_mobile/features/funding/domain/funding_models.dart';
import 'package:wlct_mobile/features/notifications/domain/notification_models.dart';
import 'package:wlct_mobile/features/portfolio/domain/portfolio_models.dart';

/// Phase 3 mobile parity: exchange accounts, copy trading, funding,
/// portfolio and notifications. Parsing is tolerant (no crash on a shape
/// difference, no invented values) and the safety properties of each
/// repository are asserted from source, the way strategy_view_test does.
void main() {
  group('JsonRead', () {
    test('reads rows from a bare list, {data} and {items}', () {
      final List<Object?> list = <Object?>[<String, Object?>{'id': 'a'}];
      expect(JsonRead.rows(list), hasLength(1));
      expect(JsonRead.rows(<String, Object?>{'data': list}), hasLength(1));
      expect(JsonRead.rows(<String, Object?>{'items': list}), hasLength(1));
      expect(JsonRead.rows('nonsense'), isEmpty);
    });

    test('absent stays absent', () {
      expect(JsonRead.str(<String, Object?>{}, 'x'), isNull);
      expect(JsonRead.str(<String, Object?>{'x': ''}, 'x'), isNull);
      expect(JsonRead.integer(<String, Object?>{'x': '7'}, 'x'), 7);
    });
  });

  group('exchange accounts', () {
    test('parses the safe reference and flags LIVE', () {
      final ExchangeAccountSummary a = ExchangeAccountSummary.fromJson(const <String, Object?>{
        'accountId': 'acc-1',
        'venue': 'BINANCE',
        'environment': 'LIVE',
        'label': 'Main',
        'maskedApiKey': '****ABCD',
        'status': 'ACTIVE',
        'healthState': 'HEALTHY',
        'isSandbox': false,
        'liveTradingEnabled': false,
      });
      expect(a.id, 'acc-1');
      expect(a.isLive, isTrue);
      expect(a.isHealthy, isTrue);
      expect(a.isDisabled, isFalse);
    });

    test('the connect request never prints its secrets', () {
      const ConnectExchangeRequest r = ConnectExchangeRequest(
        venue: 'OKX',
        environment: 'TESTNET',
        label: 'x',
        apiKey: 'KEY-SHOULD-NOT-PRINT',
        apiSecret: 'SECRET-SHOULD-NOT-PRINT',
        passphrase: 'PASS',
      );
      expect(r.toString(), isNot(contains('SHOULD-NOT-PRINT')));
      expect(r.toJson()['passphrase'], 'PASS');
      expect(r.toJson()['credentialSource'], 'ENVELOPE_DB');
      expect(ExchangeVenues.needsPassphrase('OKX'), isTrue);
      expect(ExchangeVenues.needsPassphrase('BINANCE'), isFalse);
    });

    test('the repository has no live-enable, rotate or revoke path', () {
      final String source = File('lib/features/exchange_accounts/data/exchange_account_repository.dart').readAsStringSync();
      for (final String forbidden in <String>['/enable', '/rotate', '/revoke', 'liveTradingEnabled']) {
        expect(source.contains(forbidden), isFalse, reason: forbidden);
      }
      expect(source.contains('_logger.debug(\'exchange.account_connected\', context: <String, Object?>{\'venue\''), isTrue);
      expect(source.contains('apiSecret'), isFalse, reason: 'the secret must not be referenced (e.g. logged) in the repository');
    });
  });

  group('copy trading', () {
    test('parses rankings with performance as strings, unmeasured as null', () {
      final RankedTrader t = RankedTrader.fromJson(const <String, Object?>{
        'traderId': 't1',
        'displayName': 'Alice',
        'verificationState': 'VERIFIED',
        'followerCount': 12,
        'score': 81.5,
        'rank': 1,
        'performance': <String, Object?>{'realizedPnl': '1234.50'},
      });
      expect(t.isVerified, isTrue);
      expect(t.realizedPnl, '1234.50');
      expect(t.maxDrawdown, isNull);
    });

    test('subscribe validation mirrors the API DTO', () {
      SubscribeRequest make(String mode, String amount, String account) => SubscribeRequest(
            traderId: 't',
            strategyId: 's',
            allocationMode: mode,
            allocationAmount: amount,
            followerAccountId: account,
            idempotencyKey: 'k',
          );
      expect(make('FIXED', '100', 'acc').validate(), isNull);
      expect(make('FIXED', '1e3', 'acc').validate(), isNotNull);
      expect(make('FIXED', '0', 'acc').validate(), isNotNull);
      expect(make('PERCENTAGE_BALANCE', '150', 'acc').validate(), isNotNull);
      expect(make('FIXED', '100', '').validate(), isNotNull);
      expect(make('MARTINGALE', '100', 'acc').validate(), isNotNull);
      expect(make('FIXED', '100', 'acc').toJson()['idempotencyKey'], 'k');
    });

    test('subscription actions follow the state', () {
      final CopySubscriptionSummary active = CopySubscriptionSummary.fromJson(const <String, Object?>{'id': 's', 'state': 'ACTIVE'});
      final CopySubscriptionSummary paused = CopySubscriptionSummary.fromJson(const <String, Object?>{'id': 's', 'state': 'PAUSED'});
      final CopySubscriptionSummary stopped = CopySubscriptionSummary.fromJson(const <String, Object?>{'id': 's', 'state': 'STOPPED'});
      expect(active.canPause && !active.canResume && active.canStop, isTrue);
      expect(!paused.canPause && paused.canResume && paused.canStop, isTrue);
      expect(stopped.canPause || stopped.canResume || stopped.canStop, isFalse);
    });

    test('the repository never submits orders or leader events', () {
      final String source = File('lib/features/copy_trading/data/copy_trading_repository.dart').readAsStringSync();
      expect(source.contains('leader-event'), isFalse);
      expect(source.contains('/orders'), isFalse);
    });
  });

  group('funding', () {
    test('only an active account with deposits enabled can take a deposit request', () {
      expect(FundingAccountSummary.fromJson(const <String, Object?>{'id': 'a', 'state': 'ACTIVE', 'isFundingEnabled': true}).canDeposit, isTrue);
      expect(FundingAccountSummary.fromJson(const <String, Object?>{'id': 'a', 'state': 'SUSPENDED', 'isFundingEnabled': true}).canDeposit, isFalse);
      expect(FundingAccountSummary.fromJson(const <String, Object?>{'id': 'a', 'state': 'ACTIVE'}).canDeposit, isFalse);
      expect(FundingAccountSummary.fromJson(const <String, Object?>{'id': '12345678-ffff', 'accountType': 'INDIVIDUAL_TRADING', 'state': 'ACTIVE'}).label, 'individual trading 12345678');
    });

    test('confirmation comes only from the backend state', () {
      final FundingRequestSummary open = FundingRequestSummary.fromJson(const <String, Object?>{'id': 'x', 'state': 'UNDER_REVIEW', 'requestedAmount': '50', 'currency': 'USDT'}, FundingDirection.deposit);
      expect(open.isOpen, isTrue);
      expect(open.isConfirmed, isFalse);
      final FundingRequestSummary done = FundingRequestSummary.fromJson(const <String, Object?>{'id': 'y', 'state': 'CONFIRMED', 'requestedAmount': '50', 'confirmedAmount': '49.5', 'currency': 'USDT'}, FundingDirection.deposit);
      expect(done.isConfirmed, isTrue);
      expect(done.confirmedAmount, '49.5');
    });

    test('amount and currency pre-checks match the API contract', () {
      for (final String ok in <String>['1', '0.5', '100.25']) {
        expect(FundingInput.isPositiveAmount(ok), isTrue, reason: ok);
      }
      for (final String bad in <String>['', '0', '0.00', '-1', '1e3', '1,000', 'abc']) {
        expect(FundingInput.isPositiveAmount(bad), isFalse, reason: bad);
      }
      expect(FundingInput.isCurrencyCode('USDT'), isTrue);
      expect(FundingInput.isCurrencyCode('usdt'), isFalse);
    });

    test('history interleaves deposits and withdrawals newest first', () {
      FundingRequestSummary row(String id, String at, FundingDirection d) =>
          FundingRequestSummary.fromJson(<String, Object?>{'id': id, 'state': 'REQUESTED', 'requestedAmount': '1', 'currency': 'USD', 'requestedAt': at}, d);
      final List<FundingRequestSummary> merged = mergeFundingHistory(
        <FundingRequestSummary>[row('d1', '2026-09-01T00:00:00Z', FundingDirection.deposit), row('d2', '2026-09-03T00:00:00Z', FundingDirection.deposit)],
        <FundingRequestSummary>[row('w1', '2026-09-02T00:00:00Z', FundingDirection.withdrawal)],
        limit: 2,
      );
      expect(merged.map((FundingRequestSummary r) => r.id), <String>['d2', 'w1']);
    });

    test('customer funding never calls custody and never creates withdrawals', () {
      final String source = File('lib/features/funding/data/funding_repository.dart').readAsStringSync();
      expect(source.toLowerCase().contains('withdrawals/submit'), isFalse);
      expect(source.contains('ApiEndpoints.custody'), isFalse);
      expect(source.contains('sha256'), isFalse);
      expect(source.contains('ApiEndpoints.fundingRequests'), isTrue);
      expect(RegExp(r'post<[^>]*>\(\s*ApiEndpoints\.withdrawalRequests').hasMatch(source), isFalse);
      final String endpoints = File('lib/core/network/api_endpoints.dart').readAsStringSync();
      expect(endpoints.contains("'/custody/"), isFalse);
    });
  });

  group('portfolio', () {
    test('facts keep scalars only and drop ids', () {
      final PortfolioFacts f = PortfolioFacts.fromJson(const <String, Object?>{
        'tenantId': 't',
        'profileId': 'p',
        'nav': '1000.00',
        'currency': 'USD',
        'breakdown': <String, Object?>{'a': 1},
      });
      expect(f.entries.map((MapEntry<String, String> e) => e.key), <String>['nav', 'currency']);
    });

    test('the repository is read-only', () {
      final String source = File('lib/features/portfolio/data/portfolio_repository.dart').readAsStringSync();
      expect(source.contains('_apiClient.post'), isFalse);
      expect(source.contains('_apiClient.patch'), isFalse);
      expect(source.contains('_apiClient.delete'), isFalse);
    });
  });

  group('notifications', () {
    test('parses and marks read', () {
      final AppNotification n = AppNotification.fromJson(const <String, Object?>{'id': 'n1', 'title': 'Hi', 'body': 'B', 'type': 'x', 'readAt': null});
      expect(n.isRead, isFalse);
      expect(n.markedRead(DateTime(2026)).isRead, isTrue);
      final NotificationPreference p = NotificationPreference.fromJson(const <String, Object?>{'category': 'billing', 'channel': 'EMAIL', 'enabled': true});
      expect(p.withEnabled(false).toJson(), <String, Object?>{'category': 'billing', 'channel': 'EMAIL', 'enabled': false});
    });
  });
}

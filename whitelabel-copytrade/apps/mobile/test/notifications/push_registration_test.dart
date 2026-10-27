import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wlct_mobile/features/notifications/data/push_registration.dart';
import 'package:wlct_mobile/core/storage/token_storage.dart';
import '../support/http_harness.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const MethodChannel channel = MethodChannel('com.whitelabel.mobile/notification_permission');
  String permission = 'authorized';
  const String token = 'provider-token-never-logged';
  setUp(() {
    permission = 'authorized';
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, (MethodCall call) async {
      if (call.method == 'status') return permission;
      if (call.method == 'pushToken') return token;
      return null;
    });
  });
  tearDown(() {
    debugDefaultTargetPlatformOverride = null;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, null);
  });
  test('registers the current device over the authenticated API without claiming delivery', () async {
    final HttpHarness h = HttpHarness((_) => FixtureResponse.ok(<String, Object?>{'registered': true}));
    expect(await PushRegistration(h.api).sync(), PushRegistrationStatus.registered);
    final CapturedRequest request = h.transport.requests.single;
    expect(request.uri.path, '/api/v1/notifications/push-devices');
    expect(request.method, 'POST');
    expect(request.data, <String, Object?>{'platform': 'FCM', 'token': token});
    expect(request.headers['Idempotency-Key'], startsWith('push-register-'));
  });
  test('retains an idempotency key after an uncertain network failure', () async {
    int calls = 0;
    final HttpHarness h = HttpHarness((_) => ++calls == 1 ? FixtureResponse.error(503, 'UNAVAILABLE', 'retry') : FixtureResponse.ok(<String, Object?>{'registered': true}));
    final PushRegistration registration = PushRegistration(h.api);
    expect(await registration.sync(), PushRegistrationStatus.failed);
    expect(await registration.sync(), PushRegistrationStatus.registered);
    expect(h.transport.requests[0].headers['Idempotency-Key'], h.transport.requests[1].headers['Idempotency-Key']);
  });
  test('a malformed success response is not treated as registration', () async {
    final HttpHarness h = HttpHarness((_) => FixtureResponse.ok(<String, Object?>{'registered': false}));
    expect(await PushRegistration(h.api).sync(), PushRegistrationStatus.failed);
  });
  test('denied permission unregisters the session and never sends a token', () async {
    permission = 'denied';
    final HttpHarness h = HttpHarness((_) => FixtureResponse.ok(<String, Object?>{'unregistered': true}));
    expect(await PushRegistration(h.api).sync(), PushRegistrationStatus.notRequested);
    expect(h.transport.requests.single.method, 'DELETE');
    expect(h.transport.requests.single.data, isNull);
  });
  test('undetermined permission does not prompt or register', () async {
    permission = 'undetermined';
    final HttpHarness h = HttpHarness((_) => FixtureResponse.ok(null));
    expect(await PushRegistration(h.api).sync(), PushRegistrationStatus.notRequested);
    expect(h.transport.requests, isEmpty);
  });
  test('account switch while obtaining the token cancels stale work and syncs the new session', () async {
    final Completer<void> tokenRequested = Completer<void>();
    final Completer<String> firstToken = Completer<String>();
    int tokenCalls = 0;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, (MethodCall call) async {
      if (call.method == 'status') return permission;
      if (call.method == 'pushToken') {
        if (++tokenCalls == 1) {
          tokenRequested.complete();
          return firstToken.future;
        }
        return token;
      }
      return null;
    });
    final HttpHarness h = HttpHarness((_) => FixtureResponse.ok(<String, Object?>{'registered': true}));
    final PushRegistration registration = PushRegistration(h.api);
    final Future<PushRegistrationStatus> oldSync = registration.sync();
    await tokenRequested.future;
    registration.reset();
    final Future<PushRegistrationStatus> newSync = registration.sync();
    firstToken.complete(token);
    expect(await oldSync, PushRegistrationStatus.notRequested);
    expect(await newSync, PushRegistrationStatus.registered);
    expect(h.transport.requests, hasLength(1));
    expect(tokenCalls, 2);
  });
  test('account switch during an HTTP request waits then registers with fresh credentials and intent', () async {
    final Completer<void> firstStarted = Completer<void>();
    final Completer<FixtureResponse> firstResponse = Completer<FixtureResponse>();
    int requests = 0;
    final HttpHarness h = HttpHarness((_) {
      if (++requests == 1) {
        firstStarted.complete();
        return firstResponse.future;
      }
      return FixtureResponse.ok(<String, Object?>{'registered': true});
    });
    AuthTokens tokens(String access) => AuthTokens(accessToken: access, refreshToken: 'refresh', accessExpiresAt: DateTime.now().toUtc().add(const Duration(hours: 1)), refreshExpiresAt: DateTime.now().toUtc().add(const Duration(hours: 2)));
    await h.tokens.write(tokens('old-session'));
    final PushRegistration registration = PushRegistration(h.api);
    final Future<PushRegistrationStatus> oldSync = registration.sync();
    await firstStarted.future;
    await h.tokens.write(tokens('new-session'));
    registration.reset();
    final Future<PushRegistrationStatus> newSync = registration.sync();
    expect(requests, 1);
    firstResponse.complete(FixtureResponse.ok(<String, Object?>{'registered': true}));
    expect(await oldSync, PushRegistrationStatus.notRequested);
    expect(await newSync, PushRegistrationStatus.registered);
    expect(h.transport.requests, hasLength(2));
    expect(h.transport.requests[0].headers['authorization'], 'Bearer old-session');
    expect(h.transport.requests[1].headers['authorization'], 'Bearer new-session');
    expect(h.transport.requests[0].headers['Idempotency-Key'], isNot(h.transport.requests[1].headers['Idempotency-Key']));
  });
}

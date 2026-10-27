import 'package:flutter_test/flutter_test.dart';
import 'package:wlct_mobile/core/error/app_exception.dart';
import 'package:wlct_mobile/features/auth/data/auth_repository.dart';
import 'package:wlct_mobile/features/auth/presentation/auth_controller.dart';
import 'package:wlct_mobile/features/auth/presentation/auth_state.dart';
import '../support/http_harness.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  AuthController controllerFor(HttpHarness h) => AuthController(
        repository: AuthRepository(
          apiClient: h.api,
          tokenStorage: h.tokens,
          deviceIdentity: h.device,
          logger: h.logger,
        ),
        logger: h.logger,
      );

  test('login uses real repository, normalizes email and persists tokens',
      () async {
    final HttpHarness h =
        HttpHarness((options) => FixtureResponse.ok(session()));
    final AuthController controller = controllerFor(h);
    await controller.signIn(email: ' User@Example.Test ', password: 'password');
    expect(controller.state.status, AuthStatus.authenticated);
    expect(controller.state.user?.email, 'user@example.test');
    expect((await h.tokens.read())?.accessToken, 'access-1');
    expect(h.transport.requests.single.uri.path, '/api/v1/auth/login');
    expect(
      (h.transport.requests.single.data as Map)['email'],
      'user@example.test',
    );
    expect(h.transport.requests.single.headers['authorization'], isNull);
    controller.dispose();
  });

  test('login failure maps the API error and never creates a session',
      () async {
    final HttpHarness h = HttpHarness(
      (options) =>
          FixtureResponse.error(401, 'UNAUTHORIZED', 'Invalid credentials'),
    );
    final AuthController controller = controllerFor(h);
    await controller.restore();
    await controller.signIn(email: 'user@example.test', password: 'wrong');
    expect(controller.state.status, AuthStatus.unauthenticated);
    expect(controller.state.error?.code, AppErrorCode.unauthorized);
    expect(await h.tokens.read(), isNull);
    expect(h.transport.requests, hasLength(1));
    controller.dispose();
  });

  test('two-factor challenge stays transient until verified', () async {
    final HttpHarness h = HttpHarness(
      (options) => options.path == '/auth/login'
          ? FixtureResponse.ok(<String, Object?>{
              'twoFactorRequired': true,
              'challengeToken': 'challenge',
              'methods': <String>['TOTP'],
            })
          : FixtureResponse.ok(session()),
    );
    final AuthController controller = controllerFor(h);
    await controller.signIn(email: 'user@example.test', password: 'password');
    expect(controller.state.status, AuthStatus.awaitingTwoFactor);
    expect(controller.state.challengeToken, 'challenge');
    expect(await h.tokens.read(), isNull);
    await controller.submitTwoFactor(code: ' 123456 ');
    expect(controller.state.status, AuthStatus.authenticated);
    expect(controller.state.challengeToken, isNull);
    expect((h.transport.requests.last.data as Map)['code'], '123456');
    expect((await h.tokens.read())?.refreshToken, 'refresh-1');
    controller.dispose();
  });

  test('logout wipes secure token storage even when the server is unavailable',
      () async {
    final HttpHarness h = HttpHarness(
      (options) => options.path == '/auth/login'
          ? FixtureResponse.ok(session())
          : FixtureResponse.error(503, 'SERVICE_UNAVAILABLE', 'Unavailable'),
    );
    final AuthController controller = controllerFor(h);
    await controller.signIn(email: 'user@example.test', password: 'password');
    await controller.signOut(allDevices: true);
    expect(controller.state.status, AuthStatus.unauthenticated);
    expect(await h.tokens.read(), isNull);
    expect(await h.secure.read('wlct.auth.tokens'), isNull);
    expect((h.transport.requests.last.data as Map)['allDevices'], isTrue);
    controller.dispose();
  });
}

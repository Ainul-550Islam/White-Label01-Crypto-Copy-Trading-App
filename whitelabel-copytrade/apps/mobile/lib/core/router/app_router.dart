import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/presentation/auth_state.dart';
import '../../features/auth/presentation/login_screen.dart';
import '../../features/auth/presentation/two_factor_screen.dart';
import '../../features/home/home_screen.dart';
import '../../features/settings/security_screen.dart';
import '../../features/settings/settings_screen.dart';
import '../../features/splash/splash_screen.dart';
import '../../features/risk/presentation/risk_screen.dart';
import '../../features/strategies/presentation/strategies_screen.dart';
import '../di/providers.dart';
import 'route_paths.dart';

/// Bridges a Riverpod provider to go_router's [Listenable] refresh mechanism.
class _AuthRefreshNotifier extends ChangeNotifier {
  _AuthRefreshNotifier(this._ref) {
    _subscription = _ref.listen<AuthState>(
      authControllerProvider,
      (AuthState? previous, AuthState next) {
        if (previous?.status != next.status) {
          notifyListeners();
        }
      },
    );
  }

  final Ref _ref;
  late final ProviderSubscription<AuthState> _subscription;

  @override
  void dispose() {
    _subscription.close();
    super.dispose();
  }
}

/// The application router.
///
/// Redirection is centralised here rather than scattered across screens: a
/// single rule set means there is no window where an unauthenticated user can
/// see an authenticated screen, however they arrived at the route.
final Provider<GoRouter> routerProvider = Provider<GoRouter>((Ref ref) {
  final _AuthRefreshNotifier refresh = _AuthRefreshNotifier(ref);
  ref.onDispose(refresh.dispose);

  return GoRouter(
    initialLocation: RoutePaths.splash,
    refreshListenable: refresh,
    redirect: (BuildContext context, GoRouterState state) {
      final AuthState auth = ref.read(authControllerProvider);
      final String location = state.matchedLocation;

      if (auth.status == AuthStatus.initialising) {
        return location == RoutePaths.splash ? null : RoutePaths.splash;
      }

      final bool onAuthRoute =
          location == RoutePaths.login || location == RoutePaths.twoFactor;

      if (auth.status == AuthStatus.awaitingTwoFactor) {
        return location == RoutePaths.twoFactor ? null : RoutePaths.twoFactor;
      }

      if (auth.status == AuthStatus.unauthenticated) {
        return onAuthRoute ? null : RoutePaths.login;
      }

      // Authenticated: keep the user out of the sign-in flow and off the splash.
      if (onAuthRoute || location == RoutePaths.splash) {
        return RoutePaths.home;
      }

      return null;
    },
    routes: <RouteBase>[
      GoRoute(
        path: RoutePaths.splash,
        name: RouteNames.splash,
        builder: (BuildContext context, GoRouterState state) => const SplashScreen(),
      ),
      GoRoute(
        path: RoutePaths.login,
        name: RouteNames.login,
        builder: (BuildContext context, GoRouterState state) => const LoginScreen(),
      ),
      GoRoute(
        path: RoutePaths.twoFactor,
        name: RouteNames.twoFactor,
        builder: (BuildContext context, GoRouterState state) => const TwoFactorScreen(),
      ),
      GoRoute(
        path: RoutePaths.home,
        name: RouteNames.home,
        builder: (BuildContext context, GoRouterState state) => const HomeScreen(),
      ),
      GoRoute(
        path: RoutePaths.strategies,
        name: RouteNames.strategies,
        builder: (BuildContext context, GoRouterState state) => const StrategiesScreen(),
      ),
      GoRoute(
        path: RoutePaths.risk,
        name: RouteNames.risk,
        builder: (BuildContext context, GoRouterState state) => const RiskScreen(),
      ),
      GoRoute(
        path: RoutePaths.settings,
        name: RouteNames.settings,
        builder: (BuildContext context, GoRouterState state) => const SettingsScreen(),
        routes: <RouteBase>[
          GoRoute(
            path: 'security',
            name: RouteNames.security,
            builder: (BuildContext context, GoRouterState state) => const SecurityScreen(),
          ),
        ],
      ),
    ],
    errorBuilder: (BuildContext context, GoRouterState state) => const _RouteNotFoundScreen(),
  );
});

class _RouteNotFoundScreen extends StatelessWidget {
  const _RouteNotFoundScreen();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Text('This screen is not available.'),
    );
  }
}

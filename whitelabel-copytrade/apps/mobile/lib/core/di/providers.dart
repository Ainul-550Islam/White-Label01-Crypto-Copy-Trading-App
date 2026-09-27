import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/auth/data/auth_repository.dart';
import '../../features/auth/presentation/auth_controller.dart';
import '../../features/auth/presentation/auth_state.dart';
import '../../features/risk/data/risk_repository.dart';
import '../../features/risk/presentation/risk_controller.dart';
import '../../features/risk/presentation/risk_state.dart';
import '../../features/strategies/data/strategy_repository.dart';
import '../../features/strategies/presentation/strategy_controller.dart';
import '../../features/strategies/presentation/strategy_state.dart';
import '../config/app_config.dart';
import '../logging/app_logger.dart';
import '../network/api_client.dart';
import '../network/auth_interceptor.dart';
import '../storage/device_identity.dart';
import '../storage/secure_storage.dart';
import '../storage/token_storage.dart';

/// Composition root.
///
/// Riverpod is used for dependency injection as well as state so there is one
/// object graph, one override point for tests, and no service locator holding
/// global mutable state.

final Provider<AppConfig> appConfigProvider = Provider<AppConfig>((Ref ref) {
  return AppConfig.fromEnvironment();
});

final Provider<AppLogger> appLoggerProvider = Provider<AppLogger>((Ref ref) {
  return AppLogger(ref.watch(appConfigProvider).environment);
});

final Provider<SecureStorage> secureStorageProvider = Provider<SecureStorage>((Ref ref) {
  return SecureStorage();
});

final Provider<TokenStorage> tokenStorageProvider = Provider<TokenStorage>((Ref ref) {
  return TokenStorage(ref.watch(secureStorageProvider));
});

final Provider<DeviceIdentity> deviceIdentityProvider = Provider<DeviceIdentity>((Ref ref) {
  return DeviceIdentity(ref.watch(secureStorageProvider));
});

final Provider<AuthInterceptor> authInterceptorProvider = Provider<AuthInterceptor>((Ref ref) {
  return AuthInterceptor(
    config: ref.watch(appConfigProvider),
    tokenStorage: ref.watch(tokenStorageProvider),
    deviceIdentity: ref.watch(deviceIdentityProvider),
    logger: ref.watch(appLoggerProvider),
    onSessionExpired: () async {
      // `read`, not `watch`: this callback fires from the network layer and
      // must not create a dependency cycle with the controller.
      ref.read(authControllerProvider.notifier).onSessionExpired();
    },
  );
});

final Provider<ApiClient> apiClientProvider = Provider<ApiClient>((Ref ref) {
  return ApiClient(
    config: ref.watch(appConfigProvider),
    authInterceptor: ref.watch(authInterceptorProvider),
    logger: ref.watch(appLoggerProvider),
  );
});

final Provider<AuthRepository> authRepositoryProvider = Provider<AuthRepository>((Ref ref) {
  return AuthRepository(
    apiClient: ref.watch(apiClientProvider),
    tokenStorage: ref.watch(tokenStorageProvider),
    deviceIdentity: ref.watch(deviceIdentityProvider),
    logger: ref.watch(appLoggerProvider),
  );
});

final StateNotifierProvider<AuthController, AuthState> authControllerProvider =
    StateNotifierProvider<AuthController, AuthState>((Ref ref) {
  return AuthController(
    repository: ref.watch(authRepositoryProvider),
    logger: ref.watch(appLoggerProvider),
  );
});

/// Read-only strategy repository.
///
/// Registered alongside the auth graph so the screen has a single override
/// point in tests. It holds no credentials and performs no writes.
final Provider<StrategyRepository> strategyRepositoryProvider =
    Provider<StrategyRepository>((Ref ref) {
  return StrategyRepository(
    apiClient: ref.watch(apiClientProvider),
    logger: ref.watch(appLoggerProvider),
  );
});

final StateNotifierProvider<StrategyController, StrategyViewState> strategyControllerProvider =
    StateNotifierProvider<StrategyController, StrategyViewState>((Ref ref) {
  return StrategyController(
    repository: ref.watch(strategyRepositoryProvider),
    logger: ref.watch(appLoggerProvider),
  );
});

/// Read-only risk repository (Part 8).
///
/// Same registration shape as the strategy graph: GETs only, no
/// credentials, one override point in tests. The risk layer is the one
/// screen a trader role can legitimately want on a phone - "am I halted and
/// is the engine seeing fresh state" - and answering it needs no write.
final Provider<RiskRepository> riskRepositoryProvider =
    Provider<RiskRepository>((Ref ref) {
  return RiskRepository(
    apiClient: ref.watch(apiClientProvider),
    logger: ref.watch(appLoggerProvider),
  );
});

final StateNotifierProvider<RiskController, RiskViewState> riskControllerProvider =
    StateNotifierProvider<RiskController, RiskViewState>((Ref ref) {
  return RiskController(
    repository: ref.watch(riskRepositoryProvider),
    logger: ref.watch(appLoggerProvider),
  );
});

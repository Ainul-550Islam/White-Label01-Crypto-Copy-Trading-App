import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../di/providers.dart';
import '../error/app_exception.dart';
import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import 'brand_tokens.dart';

/// Loads tenant branding.
///
/// Unauthenticated on purpose: the sign-in screen must already look like the
/// tenant's product. A failure is not fatal - the app keeps the fallback theme
/// rather than blocking startup on a cosmetic request.
class BrandingController extends StateNotifier<BrandTokens> {
  BrandingController(this._apiClient) : super(BrandTokens.fallback);

  final ApiClient _apiClient;

  Future<void> load() async {
    try {
      final Map<String, Object?> payload = await _apiClient.get<Map<String, Object?>>(
        ApiEndpoints.tenantPublicConfig,
        authenticated: false,
        parser: (Object? data) =>
            data is Map ? Map<String, Object?>.from(data) : <String, Object?>{},
      );

      if (payload.isNotEmpty) {
        state = BrandTokens.fromJson(payload);
      }
    } on AppException {
      // Keep the fallback theme; branding is not worth failing startup over.
      state = BrandTokens.fallback;
    }
  }
}

final StateNotifierProvider<BrandingController, BrandTokens> brandingProvider =
    StateNotifierProvider<BrandingController, BrandTokens>((Ref ref) {
  return BrandingController(ref.watch(apiClientProvider));
});

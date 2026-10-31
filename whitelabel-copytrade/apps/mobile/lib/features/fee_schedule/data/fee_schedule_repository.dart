// # Responsibility: reads the effective public fee schedule for the customer's tenant, keeping every rate as the decimal string the API sent so nothing on the phone can re-round a published fee.
import '../../../core/network/api_client.dart';
import '../../../core/network/api_endpoints.dart';
import '../../../core/network/json_read.dart';
import '../domain/fee_schedule_models.dart';

/// The fee schedule from the phone: read-only, unauthenticated endpoint.
///
/// `GET /v1/public/fee-schedule` is `@Public()` on purpose — pricing has to be
/// visible before signup — and resolves the tenant from the request host or the
/// `x-tenant-slug` header the ApiClient already sends. So this repository sends no
/// tenant id and asks for no permission: the schedule it gets back is already the
/// one that applies to this build's tenant.
///
/// Publishing a version is not here. It carries `FEE_SCHEDULE_PUBLISH` step-up and
/// `platform:manage`, and it belongs in the admin console.
class FeeScheduleRepository {
  FeeScheduleRepository({required ApiClient apiClient}) : _apiClient = apiClient;

  final ApiClient _apiClient;

  Future<FeeSchedule> fetchEffectiveSchedule() {
    return _apiClient.get<FeeSchedule>(
      ApiEndpoints.publicFeeSchedule,
      authenticated: false,
      parser: (Object? data) => FeeSchedule.fromJson(JsonRead.map(data)),
    );
  }
}

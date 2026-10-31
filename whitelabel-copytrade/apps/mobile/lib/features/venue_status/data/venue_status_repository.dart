// # Responsibility: reads the customer-facing venue status list through the shared ApiClient, scoping the request to the venues this tenant trades on so the phone never discloses the platform's coverage.
import '../../../core/network/api_client.dart';
import '../../../core/network/api_endpoints.dart';
import '../../../core/network/json_read.dart';
import '../domain/venue_status_models.dart';

/// Venue status from the phone: read-only.
///
/// `GET /v1/venues/status` answers `{ venues: VenueStatusView[] }` (the controller
/// returns `{ venues: [...] }`, not a `data` array), so the parser unwraps the
/// `venues` key and then falls back to the shared row envelope readers. A shape the
/// phone does not recognise degrades to an empty list; it never invents a venue.
///
/// There is no write here. Overriding a venue's state is an operator action behind
/// `VENUE_STATUS_OVERRIDE` step-up, and it is deliberately absent from this client.
class VenueStatusRepository {
  VenueStatusRepository({required ApiClient apiClient}) : _apiClient = apiClient;

  final ApiClient _apiClient;

  Future<List<VenueStatus>> fetchStatuses() {
    return _apiClient.get<List<VenueStatus>>(
      ApiEndpoints.venueStatus,
      parser: (Object? data) {
        final Map<String, Object?> map = JsonRead.map(data);
        final Object? venues = map['venues'];
        final List<Map<String, Object?>> rows =
            venues == null ? JsonRead.rows(data) : JsonRead.rows(venues);
        return rows.map(VenueStatus.fromJson).toList(growable: false);
      },
    );
  }
}

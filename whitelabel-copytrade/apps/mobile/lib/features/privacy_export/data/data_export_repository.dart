// # Responsibility: creates an export request and reads its status on the caller's own privacy routes, minting the one-time download token only for a request the API is ready to serve.
import '../../../core/network/api_client.dart';
import '../../../core/network/api_endpoints.dart';
import '../../../core/network/json_read.dart';
import '../domain/data_export_models.dart';

/// Data export from the phone: create, poll, and mint a download token.
///
/// The routes are `privacy/requests` on the API's self-service controller, which
/// scopes every one of them to `actor.tenantId` + `actor.userId` and answers 404 for
/// another user's request id. This repository therefore never sends or needs a user
/// id: the identity is the access token.
///
/// Deliberately absent:
///
///  * `POST privacy/requests/deletion` — it carries `DATA_DELETION_REQUEST` step-up,
///    and a deletion requested from a phone by accident is not recoverable;
///  * generating an export for a request — `POST :requestId/export` runs the
///    export job, and the phone only needs to observe the result.
///
/// `idempotencyKey` is required on create because the API's DTO validates it (16-255
/// characters) and because a retried tap must not create a second request.
class DataExportRepository {
  DataExportRepository({required ApiClient apiClient}) : _apiClient = apiClient;

  final ApiClient _apiClient;

  Future<List<DataExportRequest>> fetchRequests() {
    return _apiClient.get<List<DataExportRequest>>(
      ApiEndpoints.privacyRequests,
      parser: (Object? data) => JsonRead.rows(data).map(DataExportRequest.fromJson).toList(growable: false),
    );
  }

  Future<DataExportRequest> getRequest(String requestId) {
    return _apiClient.get<DataExportRequest>(
      ApiEndpoints.privacyRequest(requestId),
      parser: (Object? data) => DataExportRequest.fromJson(JsonRead.map(data)),
    );
  }

  /// Requests an export. `EXPORT` is the type the phone is allowed to create; the
  /// API refuses `DELETION` here and points at the step-up route.
  Future<DataExportRequest> createExportRequest({
    required String jurisdiction,
    required String idempotencyKey,
    required String correlationId,
    String? reason,
  }) {
    return _apiClient.post<DataExportRequest>(
      ApiEndpoints.privacyRequests,
      body: <String, Object?>{
        'requestType': 'EXPORT',
        'jurisdiction': jurisdiction,
        'idempotencyKey': idempotencyKey,
        'correlationId': correlationId,
        if (reason != null && reason.isNotEmpty) 'reason': reason,
      },
      idempotencyKey: idempotencyKey,
      parser: (Object? data) => DataExportRequest.fromJson(JsonRead.map(data)),
    );
  }

  /// Mints a single-use download token for a ready export.
  Future<DataExportDownload> issueDownloadToken(String requestId) {
    return _apiClient.post<DataExportDownload>(
      ApiEndpoints.privacyRequestDownloadToken(requestId),
      parser: (Object? data) => DataExportDownload.fromJson(JsonRead.map(data)),
    );
  }
}

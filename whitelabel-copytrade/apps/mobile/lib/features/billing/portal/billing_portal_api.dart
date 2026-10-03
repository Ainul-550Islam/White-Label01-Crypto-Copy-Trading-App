/// Billing Portal API client for mobile - consumes canonical APIs, no hardcoded pricing.
///
/// Paths are relative to the versioned API base (ApiClient already targets
/// `/api/v1`), and every response is unwrapped from the `{success, data}`
/// envelope by ApiClient before [_asMap] sees it.
library;

import '../../../core/network/api_client.dart';

class BillingPortalApi {
  final ApiClient _client;

  BillingPortalApi(this._client);

  /// A non-object payload is a contract violation: surface it as an error
  /// rather than rendering an empty billing state as if it were real.
  static Map<String, dynamic> _asMap(Object? data) {
    if (data is Map<String, dynamic>) return data;
    if (data is Map) return Map<String, dynamic>.from(data);
    throw const FormatException('Billing portal returned a non-object payload');
  }

  Future<Map<String, dynamic>> getBillingOverview() async {
    return _client.get<Map<String, dynamic>>('/billing/portal/overview', parser: _asMap);
  }

  Future<Map<String, dynamic>> getCurrentSubscription() async {
    return _client.get<Map<String, dynamic>>('/billing/portal/subscription', parser: _asMap);
  }

  Future<Map<String, dynamic>> getAvailablePlans() async {
    return _client.get<Map<String, dynamic>>('/billing/portal/plans', parser: _asMap);
  }

  Future<Map<String, dynamic>> getPlanComparison() async {
    return _client.get<Map<String, dynamic>>('/billing/portal/plans/comparison', parser: _asMap);
  }

  Future<Map<String, dynamic>> getUsageSummary() async {
    return _client.get<Map<String, dynamic>>('/billing/portal/usage', parser: _asMap);
  }

  Future<Map<String, dynamic>> listInvoices({String? status, int? limit}) async {
    final Map<String, Object?> query = <String, Object?>{};
    if (status != null) query['status'] = status;
    if (limit != null) query['limit'] = limit;
    return _client.get<Map<String, dynamic>>('/billing/portal/invoices', queryParameters: query, parser: _asMap);
  }

  Future<Map<String, dynamic>> getInvoiceDetail(String id) async {
    return _client.get<Map<String, dynamic>>('/billing/portal/invoices/$id', parser: _asMap);
  }

  Future<Map<String, dynamic>> listPayments({String? status, String? provider, int? limit}) async {
    final Map<String, Object?> query = <String, Object?>{};
    if (status != null) query['status'] = status;
    if (provider != null) query['provider'] = provider;
    if (limit != null) query['limit'] = limit;
    return _client.get<Map<String, dynamic>>('/billing/portal/payments', queryParameters: query, parser: _asMap);
  }

  Future<Map<String, dynamic>> getPaymentStatus(String id) async {
    return _client.get<Map<String, dynamic>>('/billing/portal/payments/$id/status', parser: _asMap);
  }

  Future<Map<String, dynamic>> createCheckoutSession({
    required String planId,
    String? billingInterval,
    String? currency,
    String? provider,
    String? successUrl,
    String? cancelUrl,
    String? idempotencyKey,
  }) async {
    return _client.post<Map<String, dynamic>>('/billing/portal/checkout', body: <String, Object?>{
      'planId': planId,
      if (billingInterval != null) 'billingInterval': billingInterval,
      if (currency != null) 'currency': currency,
      if (provider != null) 'provider': provider,
      if (successUrl != null) 'successUrl': successUrl,
      if (cancelUrl != null) 'cancelUrl': cancelUrl,
      if (idempotencyKey != null) 'idempotencyKey': idempotencyKey,
    }, parser: _asMap,);
  }

  Future<Map<String, dynamic>> getCheckoutStatus(String id) async {
    return _client.get<Map<String, dynamic>>('/billing/portal/checkout/$id/status', parser: _asMap);
  }

  Future<Map<String, dynamic>> cancelSubscription({String? reason, bool? atPeriodEnd}) async {
    return _client.post<Map<String, dynamic>>('/billing/portal/subscription/cancel', body: <String, Object?>{
      if (reason != null) 'reason': reason,
      if (atPeriodEnd != null) 'atPeriodEnd': atPeriodEnd,
    }, parser: _asMap,);
  }

  Future<Map<String, dynamic>> resumeSubscription() async {
    return _client.post<Map<String, dynamic>>('/billing/portal/subscription/resume', parser: _asMap);
  }

  Future<Map<String, dynamic>> changePlan({required String planId, bool? atPeriodEnd}) async {
    return _client.post<Map<String, dynamic>>('/billing/portal/subscription/change-plan', body: <String, Object?>{
      'planId': planId,
      if (atPeriodEnd != null) 'atPeriodEnd': atPeriodEnd,
    }, parser: _asMap,);
  }

  Future<Map<String, dynamic>> changeInterval({required String newInterval, bool? atPeriodEnd}) async {
    return _client.post<Map<String, dynamic>>('/billing/portal/subscription/change-interval', body: <String, Object?>{
      'newInterval': newInterval,
      if (atPeriodEnd != null) 'atPeriodEnd': atPeriodEnd,
    }, parser: _asMap,);
  }
}

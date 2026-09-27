/// Billing Portal API client for mobile - consumes canonical APIs, no hardcoded pricing.

import '../../../core/network/api_client.dart';

class BillingPortalApi {
  final ApiClient _client;

  BillingPortalApi(this._client);

  Future<Map<String, dynamic>> getBillingOverview() async {
    final res = await _client.get('/v1/billing/portal/overview');
    return res.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> getCurrentSubscription() async {
    final res = await _client.get('/v1/billing/portal/subscription');
    return res.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> getAvailablePlans() async {
    final res = await _client.get('/v1/billing/portal/plans');
    return res.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> getPlanComparison() async {
    final res = await _client.get('/v1/billing/portal/plans/comparison');
    return res.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> getUsageSummary() async {
    final res = await _client.get('/v1/billing/portal/usage');
    return res.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> listInvoices({String? status, int? limit}) async {
    final query = <String, dynamic>{};
    if (status != null) query['status'] = status;
    if (limit != null) query['limit'] = limit;
    final res = await _client.get('/v1/billing/portal/invoices', queryParameters: query);
    return res.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> getInvoiceDetail(String id) async {
    final res = await _client.get('/v1/billing/portal/invoices/$id');
    return res.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> listPayments({String? status, String? provider, int? limit}) async {
    final query = <String, dynamic>{};
    if (status != null) query['status'] = status;
    if (provider != null) query['provider'] = provider;
    if (limit != null) query['limit'] = limit;
    final res = await _client.get('/v1/billing/portal/payments', queryParameters: query);
    return res.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> getPaymentStatus(String id) async {
    final res = await _client.get('/v1/billing/portal/payments/$id/status');
    return res.data as Map<String, dynamic>;
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
    final res = await _client.post('/v1/billing/portal/checkout', data: {
      'planId': planId,
      if (billingInterval != null) 'billingInterval': billingInterval,
      if (currency != null) 'currency': currency,
      if (provider != null) 'provider': provider,
      if (successUrl != null) 'successUrl': successUrl,
      if (cancelUrl != null) 'cancelUrl': cancelUrl,
      if (idempotencyKey != null) 'idempotencyKey': idempotencyKey,
    });
    return res.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> getCheckoutStatus(String id) async {
    final res = await _client.get('/v1/billing/portal/checkout/$id/status');
    return res.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> cancelSubscription({String? reason, bool? atPeriodEnd}) async {
    final res = await _client.post('/v1/billing/portal/subscription/cancel', data: {
      if (reason != null) 'reason': reason,
      if (atPeriodEnd != null) 'atPeriodEnd': atPeriodEnd,
    });
    return res.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> resumeSubscription() async {
    final res = await _client.post('/v1/billing/portal/subscription/resume');
    return res.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> changePlan({required String planId, bool? atPeriodEnd}) async {
    final res = await _client.post('/v1/billing/portal/subscription/change-plan', data: {
      'planId': planId,
      if (atPeriodEnd != null) 'atPeriodEnd': atPeriodEnd,
    });
    return res.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> changeInterval({required String newInterval, bool? atPeriodEnd}) async {
    final res = await _client.post('/v1/billing/portal/subscription/change-interval', data: {
      'newInterval': newInterval,
      if (atPeriodEnd != null) 'atPeriodEnd': atPeriodEnd,
    });
    return res.data as Map<String, dynamic>;
  }
}

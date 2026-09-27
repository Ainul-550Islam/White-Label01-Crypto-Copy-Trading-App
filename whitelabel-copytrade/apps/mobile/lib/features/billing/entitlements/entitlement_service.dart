/// Entitlement Service
/// 
/// Service for managing billing entitlements in the mobile application.

import 'dart:convert';
import 'package:http/http.dart' as http;
import 'entitlement.dart';

class EntitlementService {
  final String baseUrl;
  final String? authToken;

  EntitlementService({
    required this.baseUrl,
    this.authToken,
  });

  Map<String, String> get _headers => {
    'Content-Type': 'application/json',
    if (authToken != null) 'Authorization': 'Bearer $authToken',
  };

  /// Get the current user's entitlement
  Future<Entitlement?> getCurrentEntitlement() async {
    final uri = Uri.parse('$baseUrl/api/billing/entitlements/current');
    final response = await http.get(uri, headers: _headers);
    if (response.statusCode == 200) {
      return Entitlement.fromJson(json.decode(response.body));
    }
    if (response.statusCode == 404) return null;
    throw Exception('Failed to fetch entitlement: ${response.statusCode}');
  }

  /// Get a specific entitlement by ID
  Future<Entitlement?> getEntitlement(String entitlementId) async {
    final uri = Uri.parse('$baseUrl/api/billing/entitlements/$entitlementId');
    final response = await http.get(uri, headers: _headers);
    if (response.statusCode == 200) {
      return Entitlement.fromJson(json.decode(response.body));
    }
    if (response.statusCode == 404) return null;
    throw Exception('Failed to fetch entitlement: ${response.statusCode}');
  }

  /// Check if user has access to a specific feature
  Future<bool> hasFeatureAccess(String featureKey) async {
    final uri = Uri.parse('$baseUrl/api/billing/entitlements/check/$featureKey');
    final response = await http.get(uri, headers: _headers);
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      return data['allowed'] as bool;
    }
    return false;
  }

  /// Check if user can perform an action (limit check)
  Future<bool> canPerformAction(String limitKey) async {
    final uri = Uri.parse('$baseUrl/api/billing/entitlements/limits/$limitKey/check');
    final response = await http.get(uri, headers: _headers);
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      return data['allowed'] as bool;
    }
    return false;
  }

  /// Record usage for a feature
  Future<void> recordUsage(String featureKey, {int amount = 1}) async {
    final uri = Uri.parse('$baseUrl/api/billing/entitlements/usage');
    final response = await http.post(
      uri,
      headers: _headers,
      body: json.encode({
        'featureKey': featureKey,
        'amount': amount,
      }),
    );
    if (response.statusCode != 200) {
      throw Exception('Failed to record usage: ${response.statusCode}');
    }
  }

  /// Get usage history for a feature
  Future<List<Map<String, dynamic>>> getUsageHistory(
    String featureKey, {
    int limit = 100,
  }) async {
    final uri = Uri.parse('$baseUrl/api/billing/entitlements/usage/$featureKey')
        .replace(queryParameters: {'limit': limit.toString()});
    final response = await http.get(uri, headers: _headers);
    if (response.statusCode == 200) {
      final List<dynamic> data = json.decode(response.body);
      return data.cast<Map<String, dynamic>>();
    }
    throw Exception('Failed to fetch usage history: ${response.statusCode}');
  }

  /// Get features that are near their usage limits
  Future<List<EntitlementLimit>> getNearLimitFeatures() async {
    final entitlement = await getCurrentEntitlement();
    if (entitlement == null) return [];
    return entitlement.limits.where((l) => l.isNearLimit).toList();
  }

  /// Get features that have exceeded their limits
  Future<List<EntitlementLimit>> getExceededFeatures() async {
    final entitlement = await getCurrentEntitlement();
    if (entitlement == null) return [];
    return entitlement.limits.where((l) => l.isOverLimit).toList();
  }

  /// Upgrade to a new plan
  Future<Entitlement> upgradePlan(String newPlanId) async {
    final uri = Uri.parse('$baseUrl/api/billing/entitlements/upgrade');
    final response = await http.post(
      uri,
      headers: _headers,
      body: json.encode({'planId': newPlanId}),
    );
    if (response.statusCode == 200) {
      return Entitlement.fromJson(json.decode(response.body));
    }
    throw Exception('Failed to upgrade plan: ${response.statusCode}');
  }

  /// Cancel current entitlement
  Future<void> cancelEntitlement(String reason) async {
    final uri = Uri.parse('$baseUrl/api/billing/entitlements/cancel');
    final response = await http.post(
      uri,
      headers: _headers,
      body: json.encode({'reason': reason}),
    );
    if (response.statusCode != 200) {
      throw Exception('Failed to cancel entitlement: ${response.statusCode}');
    }
  }

  /// Get entitlement summary for display
  Future<Map<String, dynamic>> getEntitlementSummary() async {
    final entitlement = await getCurrentEntitlement();
    if (entitlement == null) {
      return {
        'hasEntitlement': false,
        'planName': 'No Plan',
        'status': 'none',
      };
    }

    final nearLimitCount = entitlement.limits.where((l) => l.isNearLimit).length;
    final exceededCount = entitlement.limits.where((l) => l.isOverLimit).length;

    return {
      'hasEntitlement': true,
      'planName': entitlement.planName,
      'planTier': entitlement.planTier,
      'status': entitlement.status.name,
      'featureCount': entitlement.features.where((f) => f.enabled).length,
      'limitCount': entitlement.limits.length,
      'nearLimitCount': nearLimitCount,
      'exceededCount': exceededCount,
      'isExpiringSoon': entitlement.isExpiringSoon,
      'daysUntilExpiry': entitlement.daysUntilExpiry,
    };
  }
}
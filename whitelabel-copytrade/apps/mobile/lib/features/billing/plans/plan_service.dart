/// Plan Service
/// 
/// Service for managing billing plans in the mobile application.

import 'dart:convert';
import 'package:http/http.dart' as http;
import 'plan.dart';
import 'plan_catalog.dart';

class PlanService {
  final String baseUrl;
  final String? authToken;

  PlanService({
    required this.baseUrl,
    this.authToken,
  });

  Map<String, String> get _headers => {
    'Content-Type': 'application/json',
    if (authToken != null) 'Authorization': 'Bearer $authToken',
  };

  /// Get all available plans
  Future<List<Plan>> getPlans({PlanTier? tier}) async {
    final queryParams = <String, String>{};
    if (tier != null) queryParams['tier'] = tier.name;

    final uri = Uri.parse('$baseUrl/api/billing/plans').replace(
      queryParameters: queryParams.isNotEmpty ? queryParams : null,
    );

    final response = await http.get(uri, headers: _headers);
    if (response.statusCode == 200) {
      final List<dynamic> data = json.decode(response.body);
      return data.map((json) => Plan.fromJson(json)).toList();
    }
    throw Exception('Failed to fetch plans: ${response.statusCode}');
  }

  /// Get a specific plan by ID
  Future<Plan?> getPlan(String planId) async {
    final uri = Uri.parse('$baseUrl/api/billing/plans/$planId');
    final response = await http.get(uri, headers: _headers);
    if (response.statusCode == 200) {
      return Plan.fromJson(json.decode(response.body));
    }
    if (response.statusCode == 404) return null;
    throw Exception('Failed to fetch plan: ${response.statusCode}');
  }

  /// Get the current user's plan
  Future<Plan?> getCurrentPlan() async {
    final uri = Uri.parse('$baseUrl/api/billing/current-plan');
    final response = await http.get(uri, headers: _headers);
    if (response.statusCode == 200) {
      return Plan.fromJson(json.decode(response.body));
    }
    if (response.statusCode == 404) return null;
    throw Exception('Failed to fetch current plan: ${response.statusCode}');
  }

  /// Get local catalog plans (offline fallback)
  List<Plan> getCatalogPlans() {
    return PlanCatalog.allPlans;
  }

  /// Get a plan from the local catalog
  Plan? getCatalogPlan(PlanTier tier) {
    return PlanCatalog.getPlanByTier(tier);
  }

  /// Compare two plans
  Map<String, dynamic> comparePlans(Plan plan1, Plan plan2) {
    final features1 = plan1.features.map((f) => f.key).toSet();
    final features2 = plan2.features.map((f) => f.key).toSet();
    
    final onlyInPlan1 = features1.difference(features2);
    final onlyInPlan2 = features2.difference(features1);
    final common = features1.intersection(features2);

    return {
      'plan1': plan1.name,
      'plan2': plan2.name,
      'onlyInPlan1': onlyInPlan1.toList(),
      'onlyInPlan2': onlyInPlan2.toList(),
      'commonFeatures': common.toList(),
      'priceDifference': plan2.price.amount - plan1.price.amount,
    };
  }

  /// Check if a plan has a specific feature
  bool planHasFeature(Plan plan, String featureKey) {
    return plan.hasFeature(featureKey);
  }

  /// Get plan limit value
  int? getPlanLimit(Plan plan, String limitKey) {
    return plan.getLimitValue(limitKey);
  }

  /// Calculate annual savings for a plan
  double calculateAnnualSavings(Plan plan) {
    return plan.price.annualSavings;
  }

  /// Get upgrade options for a plan
  List<Plan> getUpgradeOptions(Plan currentPlan) {
    return PlanCatalog.allPlans
        .where((p) => 
            p.price.amount > currentPlan.price.amount && 
            p.status == PlanStatus.active)
        .toList();
  }

  /// Get downgrade options for a plan
  List<Plan> getDowngradeOptions(Plan currentPlan) {
    return PlanCatalog.allPlans
        .where((p) => 
            p.price.amount < currentPlan.price.amount && 
            p.status == PlanStatus.active)
        .toList();
  }

  /// Initiate plan checkout
  Future<Map<String, dynamic>> initiateCheckout(String planId) async {
    final uri = Uri.parse('$baseUrl/api/billing/checkout');
    final response = await http.post(
      uri,
      headers: _headers,
      body: json.encode({'planId': planId}),
    );
    if (response.statusCode == 200) {
      return json.decode(response.body);
    }
    throw Exception('Failed to initiate checkout: ${response.statusCode}');
  }

  /// Cancel current plan
  Future<void> cancelPlan(String reason) async {
    final uri = Uri.parse('$baseUrl/api/billing/cancel');
    final response = await http.post(
      uri,
      headers: _headers,
      body: json.encode({'reason': reason}),
    );
    if (response.statusCode != 200) {
      throw Exception('Failed to cancel plan: ${response.statusCode}');
    }
  }
}
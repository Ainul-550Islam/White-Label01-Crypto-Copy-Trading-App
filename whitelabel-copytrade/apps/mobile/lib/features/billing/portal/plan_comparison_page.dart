import 'package:flutter/material.dart';
import 'billing_portal_api.dart';
import '../../../core/network/api_client.dart';

/// Mobile dynamic plan comparison.
/// Displays available plans, pricing, currency, billing interval,
/// feature entitlements, numeric limits, current plan, upgrade/downgrade.
/// No hardcoded plan pricing - all from API.

class PlanComparisonPage extends StatefulWidget {
  const PlanComparisonPage({super.key});

  @override
  State<PlanComparisonPage> createState() => _PlanComparisonPageState();
}

class _PlanComparisonPageState extends State<PlanComparisonPage> {
  late final BillingPortalApi _api;
  Map<String, dynamic>? _comparison;
  bool _loading = true;
  String? _error;
  String? _actionLoading;
  String? _message;

  @override
  void initState() {
    super.initState();
    _api = BillingPortalApi(ApiClient());
    _fetchComparison();
  }

  Future<void> _fetchComparison() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await _api.getPlanComparison();
      setState(() {
        _comparison = data;
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _selectPlan(String planId) async {
    setState(() {
      _actionLoading = planId;
      _message = null;
    });
    try {
      final result = await _api.changePlan(planId: planId, atPeriodEnd: false);
      if (result['requiresCheckout'] == true) {
        setState(() {
          _message = 'Upgrade requires payment. Delta: ${result['priceDelta']}. Creating checkout...';
        });
        final checkout = await _api.createCheckoutSession(planId: planId);
        final url = checkout['checkoutUrl'] as String?;
        if (url != null && url.isNotEmpty && mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Redirect to: $url')));
          // In real app, use url_launcher to open provider checkout
        }
      } else {
        setState(() {
          _message = result['message'] ?? 'Plan change successful';
        });
        await _fetchComparison();
      }
    } catch (e) {
      setState(() {
        _message = 'Error: $e';
      });
    } finally {
      setState(() {
        _actionLoading = null;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return Scaffold(
        appBar: AppBar(title: const Text('Compare Plans')),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    if (_error != null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Compare Plans')),
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text('Error: $_error'),
              const SizedBox(height: 16),
              ElevatedButton(onPressed: _fetchComparison, child: const Text('Retry')),
            ],
          ),
        ),
      );
    }

    final plans = (_comparison?['plans'] as List?) ?? [];
    final featuresMatrix = (_comparison?['featuresMatrix'] as List?) ?? [];
    final limitsMatrix = (_comparison?['limitsMatrix'] as List?) ?? [];

    if (plans.isEmpty) {
      return Scaffold(
        appBar: AppBar(title: const Text('Compare Plans')),
        body: const Center(child: Text('No plans available')),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Compare Plans'),
        actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _fetchComparison)],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Choose the plan that fits your needs', style: TextStyle(fontSize: 16, color: Colors.grey)),
            const SizedBox(height: 8),
            const Text('All pricing from canonical billing catalog - never hardcoded', style: TextStyle(fontSize: 11, color: Colors.grey)),
            const SizedBox(height: 16),

            if (_message != null)
              Container(
                padding: const EdgeInsets.all(12),
                margin: const EdgeInsets.only(bottom: 16),
                decoration: BoxDecoration(color: Colors.blue[50], borderRadius: BorderRadius.circular(8), border: Border.all(color: Colors.blue[200]!)),
                child: Text(_message!, style: const TextStyle(fontSize: 13)),
              ),

            // Plan Cards - horizontal scroll
            SizedBox(
              height: 380,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: plans.length,
                separatorBuilder: (_, __) => const SizedBox(width: 12),
                itemBuilder: (context, index) {
                  final plan = plans[index] as Map<String, dynamic>;
                  final isCurrent = plan['isCurrent'] == true;
                  return Container(
                    width: 260,
                    decoration: BoxDecoration(
                      border: Border.all(color: isCurrent ? Colors.blue : Colors.grey[300]!, width: isCurrent ? 2 : 1),
                      borderRadius: BorderRadius.circular(12),
                      color: Colors.white,
                    ),
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (isCurrent)
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                            decoration: BoxDecoration(color: Colors.blue[100], borderRadius: BorderRadius.circular(4)),
                            child: const Text('Current Plan', style: TextStyle(fontSize: 10, color: Colors.blue)),
                          ),
                        const SizedBox(height: 8),
                        Text(plan['name'] ?? 'Plan', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                        Text(plan['description'] ?? '', style: const TextStyle(fontSize: 12, color: Colors.grey), maxLines: 2, overflow: TextOverflow.ellipsis),
                        const SizedBox(height: 12),
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text('${plan['price']}', style: const TextStyle(fontSize: 28, fontWeight: FontWeight.bold)),
                            const SizedBox(width: 4),
                            Text(plan['currency'] ?? 'USD', style: const TextStyle(fontSize: 12, color: Colors.grey)),
                          ],
                        ),
                        Text('/ ${plan['interval']}', style: const TextStyle(fontSize: 12, color: Colors.grey)),
                        if ((plan['trialDays'] ?? 0) > 0) Text('${plan['trialDays']} day trial', style: const TextStyle(fontSize: 11, color: Colors.green)),

                        const SizedBox(height: 12),
                        const Text('Limits:', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                        const SizedBox(height: 4),
                        ...((plan['limits'] as Map<String, dynamic>?)?.entries.where((e) => e.value != null && e.value is! bool).take(3).map((e) {
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 2),
                            child: Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(e.key, style: const TextStyle(fontSize: 11, color: Colors.grey)),
                                Text(e.value.toString(), style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w500)),
                              ],
                            ),
                          );
                        }) ?? []),

                        const Spacer(),

                        SizedBox(
                          width: double.infinity,
                          child: isCurrent
                              ? const ElevatedButton(onPressed: null, child: Text('Current'))
                              : ElevatedButton(
                                  onPressed: _actionLoading == plan['id'] ? null : () => _selectPlan(plan['id']),
                                  style: ElevatedButton.styleFrom(
                                    backgroundColor: plan['upgradeEligible'] == true ? Colors.blue : Colors.grey[800],
                                  ),
                                  child: Text(_actionLoading == plan['id']
                                      ? '...'
                                      : plan['upgradeEligible'] == true
                                          ? 'Upgrade'
                                          : plan['downgradeEligible'] == true
                                              ? 'Downgrade'
                                              : 'Select'),
                                ),
                        ),
                      ],
                    ),
                  );
                },
              ),
            ),

            const SizedBox(height: 24),

            // Features Matrix
            if (featuresMatrix.isNotEmpty) ...[
              const Text('Feature Comparison', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
              const SizedBox(height: 12),
              Card(
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: DataTable(
                    columns: [
                      const DataColumn(label: Text('Feature')),
                      ...plans.map((p) => DataColumn(label: Text((p as Map)['name'], style: const TextStyle(fontSize: 12)))),
                    ],
                    rows: featuresMatrix.map<DataRow>((row) {
                      final r = row as Map<String, dynamic>;
                      final plansMap = r['plans'] as Map<String, dynamic>;
                      return DataRow(cells: [
                        DataCell(Text(r['label'] ?? r['featureKey'], style: const TextStyle(fontSize: 12))),
                        ...plans.map((p) {
                          final pid = (p as Map)['id'] as String;
                          final included = plansMap[pid] == true;
                          return DataCell(Center(child: Text(included ? '✓' : '—', style: TextStyle(color: included ? Colors.green : Colors.grey))));
                        }),
                      ]);
                    }).toList(),
                  ),
                ),
              ),
              const SizedBox(height: 16),
            ],

            // Limits Matrix
            if (limitsMatrix.isNotEmpty) ...[
              const Text('Limits Comparison', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
              const SizedBox(height: 12),
              Card(
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: DataTable(
                    columns: [
                      const DataColumn(label: Text('Limit')),
                      ...plans.map((p) => DataColumn(label: Text((p as Map)['name'], style: const TextStyle(fontSize: 12)))),
                    ],
                    rows: limitsMatrix.map<DataRow>((row) {
                      final r = row as Map<String, dynamic>;
                      final plansMap = r['plans'] as Map<String, dynamic>;
                      return DataRow(cells: [
                        DataCell(Text(r['label'] ?? r['limitKey'], style: const TextStyle(fontSize: 12))),
                        ...plans.map((p) {
                          final pid = (p as Map)['id'] as String;
                          final val = plansMap[pid];
                          return DataCell(Center(child: Text(val == null ? 'Unlimited' : val.toString(), style: const TextStyle(fontSize: 12))));
                        }),
                      ]);
                    }).toList(),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'billing_portal_api.dart';
import '../../../core/network/api_client.dart';
import '../../../core/di/providers.dart';

/// Mobile billing dashboard.
/// Displays current plan, subscription status, renewal date, trial, usage,
/// latest invoice, latest payment, available billing actions.
/// Must consume API data dynamically - no hardcoded pricing.

class BillingPortalPage extends StatefulWidget {
  const BillingPortalPage({super.key});

  @override
  State<BillingPortalPage> createState() => _BillingPortalPageState();
}

class _BillingPortalPageState extends State<BillingPortalPage> {
  late final BillingPortalApi _api;
  Map<String, dynamic>? _overview;
  List<dynamic> _invoices = [];
  List<dynamic> _payments = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _api = BillingPortalApi(ApiClient());
    _fetchData();
  }

  Future<void> _fetchData() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        _api.getBillingOverview(),
        _api.listInvoices(limit: 3),
        _api.listPayments(limit: 3),
      ]);
      setState(() {
        _overview = results[0] as Map<String, dynamic>;
        _invoices = (results[1]['invoices'] as List?) ?? [];
        _payments = (results[2]['payments'] as List?) ?? [];
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return Scaffold(
        appBar: AppBar(title: const Text('Billing')),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    if (_error != null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Billing')),
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text('Error: $_error', textAlign: TextAlign.center),
              const SizedBox(height: 16),
              ElevatedButton(onPressed: _fetchData, child: const Text('Retry')),
            ],
          ),
        ),
      );
    }

    if (_overview == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Billing')),
        body: const Center(child: Text('No billing data')),
      );
    }

    final sub = _overview!['subscription'] as Map<String, dynamic>?;
    final currentPlan = _overview!['currentPlan'] as Map<String, dynamic>?;
    final usage = _overview!['usage'] as Map<String, dynamic>?;
    final latestInvoice = _overview!['latestInvoice'] as Map<String, dynamic>?;
    final latestPayment = _overview!['latestPayment'] as Map<String, dynamic>?;
    final availableActions = (_overview!['availableActions'] as List?) ?? [];
    final isInactive = sub?['isActive'] != true;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Billing & Subscription'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _fetchData),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _fetchData,
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Current Subscription Card
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Current Subscription', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 12),
                      if (isInactive)
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(color: Colors.amber[50], borderRadius: BorderRadius.circular(8), border: Border.all(color: Colors.amber[200]!)),
                          child: const Text('No active subscription - Choose a plan to get started'),
                        )
                      else
                        Column(
                          children: [
                            _buildInfoRow('Plan', currentPlan?['name'] ?? sub?['planName'] ?? 'Unknown'),
                            _buildInfoRow('Code', sub?['planCode'] ?? '-'),
                            _buildInfoRow('Status', sub?['status'] ?? '-', isBadge: true, badgeColor: sub?['isActive'] == true ? Colors.green : Colors.grey),
                            _buildInfoRow('Interval', sub?['interval'] ?? currentPlan?['interval'] ?? '-'),
                            _buildInfoRow('Renewal', sub?['renewalDate'] != null ? DateTime.parse(sub!['renewalDate']).toLocal().toString().split(' ')[0] : 'N/A'),
                            if (sub?['willCancelAtPeriodEnd'] == true)
                              const Padding(
                                padding: EdgeInsets.only(top: 8),
                                child: Text('⚠️ Cancels at period end', style: TextStyle(color: Colors.orange, fontSize: 12)),
                              ),
                            if (sub?['trialActive'] == true)
                              const Padding(
                                padding: EdgeInsets.only(top: 4),
                                child: Text('🎉 Trial active', style: TextStyle(color: Colors.blue, fontSize: 12)),
                              ),
                          ],
                        ),
                    ],
                  ),
                ),
              ),

              const SizedBox(height: 16),

              // Usage
              if (usage != null)
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Usage & Limits', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                        const SizedBox(height: 12),
                        ...((usage['items'] as List?) ?? []).map((item) {
                          final map = item as Map<String, dynamic>;
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 12),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: [
                                    Text(map['label'] ?? map['key'], style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500)),
                                    Text(
                                      map['unlimited'] == true ? 'Unlimited' : '${map['current']}/${map['limit']}',
                                      style: const TextStyle(fontSize: 12, color: Colors.grey),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 4),
                                if (map['unlimited'] != true)
                                  LinearProgressIndicator(
                                    value: (map['percentageUsed'] ?? 0) / 100,
                                    backgroundColor: Colors.grey[200],
                                    valueColor: AlwaysStoppedAnimation<Color>((map['percentageUsed'] ?? 0) > 80 ? Colors.red : Colors.blue),
                                  ),
                                if (map['remaining'] != null && map['unlimited'] != true)
                                  Text('${map['remaining']} remaining', style: const TextStyle(fontSize: 11, color: Colors.grey)),
                              ],
                            ),
                          );
                        }),
                        if ((usage['features'] as List?)?.isNotEmpty == true) ...[
                          const SizedBox(height: 12),
                          const Text('Features', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w500)),
                          const SizedBox(height: 8),
                          Wrap(
                            spacing: 8,
                            runSpacing: 4,
                            children: ((usage['features'] as List).map((f) {
                              final fm = f as Map<String, dynamic>;
                              return Chip(
                                label: Text('${fm['label']}: ${fm['included'] == true ? '✓' : '✗'}', style: const TextStyle(fontSize: 11)),
                                backgroundColor: fm['included'] == true ? Colors.green[50] : Colors.grey[100],
                                materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                              );
                            })).toList(),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),

              const SizedBox(height: 16),

              // Invoices & Payments Row
              Row(
                children: [
                  Expanded(
                    child: Card(
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text('Latest Invoice', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                            const SizedBox(height: 8),
                            if (latestInvoice != null) ...[
                              Text('No: ${latestInvoice['invoiceNumber']}', style: const TextStyle(fontSize: 12)),
                              Text('Status: ${latestInvoice['status']}', style: const TextStyle(fontSize: 12)),
                              Text('Total: ${latestInvoice['total']} ${latestInvoice['currency']}', style: const TextStyle(fontSize: 12)),
                            ] else
                              const Text('No invoices yet', style: TextStyle(fontSize: 12, color: Colors.grey)),
                          ],
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Card(
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text('Latest Payment', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                            const SizedBox(height: 8),
                            if (latestPayment != null) ...[
                              Text('Provider: ${latestPayment['provider']}', style: const TextStyle(fontSize: 12)),
                              Text('Status: ${latestPayment['status']}', style: const TextStyle(fontSize: 12)),
                              Text('Amount: ${latestPayment['amount']} ${latestPayment['currency']}', style: const TextStyle(fontSize: 12)),
                            ] else
                              const Text('No payments yet', style: TextStyle(fontSize: 12, color: Colors.grey)),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ),

              const SizedBox(height: 16),

              // Recent Invoices
              if (_invoices.isNotEmpty)
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Recent Invoices', style: TextStyle(fontWeight: FontWeight.bold)),
                        const SizedBox(height: 8),
                        ..._invoices.map((inv) {
                          final m = inv as Map<String, dynamic>;
                          return ListTile(
                            dense: true,
                            contentPadding: EdgeInsets.zero,
                            title: Text(m['invoiceNumber'] ?? m['id'], style: const TextStyle(fontSize: 13)),
                            subtitle: Text('${m['total']} ${m['currency']}', style: const TextStyle(fontSize: 11)),
                            trailing: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                              decoration: BoxDecoration(
                                color: m['status'] == 'PAID' ? Colors.green[100] : Colors.amber[100],
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: Text(m['status'], style: TextStyle(fontSize: 10, color: m['status'] == 'PAID' ? Colors.green[800] : Colors.amber[800])),
                            ),
                          );
                        }),
                      ],
                    ),
                  ),
                ),

              const SizedBox(height: 16),

              // Recent Payments
              if (_payments.isNotEmpty)
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Recent Payments', style: TextStyle(fontWeight: FontWeight.bold)),
                        const SizedBox(height: 8),
                        ..._payments.map((pay) {
                          final m = pay as Map<String, dynamic>;
                          return ListTile(
                            dense: true,
                            contentPadding: EdgeInsets.zero,
                            title: Text('${m['amount']} ${m['currency']}', style: const TextStyle(fontSize: 13)),
                            subtitle: Text(m['provider'] ?? '', style: const TextStyle(fontSize: 11)),
                            trailing: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                              decoration: BoxDecoration(
                                color: m['status'] == 'SUCCEEDED' ? Colors.green[100] : Colors.amber[100],
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: Text(m['status'], style: TextStyle(fontSize: 10, color: m['status'] == 'SUCCEEDED' ? Colors.green[800] : Colors.amber[800])),
                            ),
                          );
                        }),
                      ],
                    ),
                  ),
                ),

              const SizedBox(height: 16),

              // Available Actions
              if (availableActions.isNotEmpty)
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Available Actions', style: TextStyle(fontWeight: FontWeight.bold)),
                        const SizedBox(height: 8),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: availableActions.map((a) {
                            return ActionChip(label: Text((a as String).replaceAll('_', ' ')), onPressed: () {});
                          }).toList(),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildInfoRow(String label, String value, {bool isBadge = false, Color? badgeColor}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(fontSize: 12, color: Colors.grey)),
          isBadge
              ? Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(color: (badgeColor ?? Colors.grey)[100], borderRadius: BorderRadius.circular(4)),
                  child: Text(value, style: TextStyle(fontSize: 11, color: (badgeColor ?? Colors.grey)[800])),
                )
              : Text(value, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500)),
        ],
      ),
    );
  }
}

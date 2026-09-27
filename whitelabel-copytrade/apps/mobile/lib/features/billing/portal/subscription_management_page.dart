import 'package:flutter/material.dart';
import 'billing_portal_api.dart';
import '../../../core/network/api_client.dart';

/// Mobile subscription management.
/// Supports current plan, change plan, change interval, cancel at period end,
/// resume, payment status, invoice access, safe error states.
/// After checkout/provider return, always refresh billing state from backend.

class SubscriptionManagementPage extends StatefulWidget {
  const SubscriptionManagementPage({super.key});

  @override
  State<SubscriptionManagementPage> createState() => _SubscriptionManagementPageState();
}

class _SubscriptionManagementPageState extends State<SubscriptionManagementPage> {
  late final BillingPortalApi _api;
  Map<String, dynamic>? _state;
  List<dynamic> _plans = [];
  bool _loading = true;
  String? _error;
  String? _actionLoading;
  String? _message;
  bool _showCancelDialog = false;
  final _cancelReasonController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _api = BillingPortalApi(ApiClient());
    _fetchData();
  }

  @override
  void dispose() {
    _cancelReasonController.dispose();
    super.dispose();
  }

  Future<void> _fetchData() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        _api.getCurrentSubscription(),
        _api.getAvailablePlans(),
      ]);
      setState(() {
        _state = results[0] as Map<String, dynamic>;
        _plans = (results[1]['plans'] as List?) ?? [];
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _handleCancel() async {
    setState(() {
      _actionLoading = 'cancel';
      _message = null;
    });
    try {
      final result = await _api.cancelSubscription(reason: _cancelReasonController.text.isNotEmpty ? _cancelReasonController.text : null, atPeriodEnd: true);
      setState(() {
        _message = 'Subscription will cancel at ${result['effectiveAt'] != null ? DateTime.parse(result['effectiveAt']).toLocal().toString().split(' ')[0] : 'period end'}';
        _showCancelDialog = false;
      });
      await _fetchData();
    } catch (e) {
      setState(() {
        _message = 'Cancel failed: $e';
      });
    } finally {
      setState(() {
        _actionLoading = null;
      });
    }
  }

  Future<void> _handleResume() async {
    setState(() {
      _actionLoading = 'resume';
      _message = null;
    });
    try {
      final result = await _api.resumeSubscription();
      setState(() {
        _message = result['message'] ?? 'Subscription resumed';
      });
      await _fetchData();
    } catch (e) {
      setState(() {
        _message = 'Resume failed: $e';
      });
    } finally {
      setState(() {
        _actionLoading = null;
      });
    }
  }

  Future<void> _handleChangePlan(String planId) async {
    setState(() {
      _actionLoading = 'plan_$planId';
      _message = null;
    });
    try {
      final result = await _api.changePlan(planId: planId, atPeriodEnd: false);
      if (result['requiresCheckout'] == true) {
        setState(() {
          _message = 'Upgrade requires checkout. Delta: ${result['priceDelta']}. Creating checkout...';
        });
        final checkout = await _api.createCheckoutSession(planId: planId);
        final url = checkout['checkoutUrl'] as String?;
        if (url != null && url.isNotEmpty && mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Checkout URL: $url')));
        }
      } else {
        setState(() {
          _message = result['message'] ?? 'Plan changed successfully';
        });
        await _fetchData();
      }
    } catch (e) {
      setState(() {
        _message = 'Plan change failed: $e';
      });
    } finally {
      setState(() {
        _actionLoading = null;
      });
    }
  }

  Future<void> _handleChangeInterval(String newInterval) async {
    setState(() {
      _actionLoading = 'interval_$newInterval';
      _message = null;
    });
    try {
      final result = await _api.changeInterval(newInterval: newInterval, atPeriodEnd: true);
      setState(() {
        _message = result['message'] ?? 'Interval change to $newInterval scheduled';
      });
      await _fetchData();
    } catch (e) {
      setState(() {
        _message = 'Interval change failed: $e';
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
        appBar: AppBar(title: const Text('Subscription Management')),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    if (_error != null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Subscription Management')),
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text('Error: $_error'),
              const SizedBox(height: 16),
              ElevatedButton(onPressed: _fetchData, child: const Text('Retry')),
            ],
          ),
        ),
      );
    }

    final sub = _state?['subscription'] as Map<String, dynamic>?;
    final canCancel = _state?['canCancel'] == true;
    final canResume = _state?['canResume'] == true;
    final effectiveActions = (_state?['effectiveActions'] as List?) ?? [];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Subscription Management'),
        actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _fetchData)],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (_message != null)
              Container(
                padding: const EdgeInsets.all(12),
                margin: const EdgeInsets.only(bottom: 16),
                decoration: BoxDecoration(color: Colors.blue[50], borderRadius: BorderRadius.circular(8), border: Border.all(color: Colors.blue[200]!)),
                child: Text(_message!, style: const TextStyle(fontSize: 13)),
              ),

            // Current Subscription
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Current Subscription', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 12),
                    if (sub != null) ...[
                      _buildRow('Plan', sub['plan']?['name'] ?? sub['planId'] ?? 'Unknown'),
                      _buildRow('Status', sub['status'] ?? 'UNKNOWN', isBadge: true),
                      _buildRow('Period End', sub['currentPeriodEnd'] != null ? DateTime.parse(sub['currentPeriodEnd']).toLocal().toString().split(' ')[0] : 'N/A'),
                      _buildRow('Interval', sub['plan']?['interval'] ?? 'N/A'),
                      if (sub['cancelAtPeriodEnd'] == true)
                        const Padding(
                          padding: EdgeInsets.only(top: 8),
                          child: Text('⚠️ Cancels at period end', style: TextStyle(color: Colors.orange, fontSize: 12)),
                        ),
                    ] else
                      const Text('No active subscription', style: TextStyle(color: Colors.grey)),
                  ],
                ),
              ),
            ),

            const SizedBox(height: 16),

            // Actions
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Actions', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 12),
                    if (canCancel)
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton(
                          onPressed: () => setState(() => _showCancelDialog = true),
                          style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
                          child: const Text('Cancel at Period End'),
                        ),
                      ),
                    if (canResume)
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton(
                          onPressed: _actionLoading == 'resume' ? null : _handleResume,
                          style: ElevatedButton.styleFrom(backgroundColor: Colors.green),
                          child: Text(_actionLoading == 'resume' ? 'Resuming...' : 'Resume Subscription'),
                        ),
                      ),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      children: effectiveActions.map((a) => Chip(label: Text((a as String).replaceAll('_', ' '), style: const TextStyle(fontSize: 11)))).toList(),
                    ),

                    if (_showCancelDialog) ...[
                      const SizedBox(height: 16),
                      const Divider(),
                      const SizedBox(height: 8),
                      const Text('Confirm Cancellation', style: TextStyle(fontWeight: FontWeight.bold)),
                      const SizedBox(height: 8),
                      const Text('Your subscription will remain active until the end of the current period.', style: TextStyle(fontSize: 12, color: Colors.grey)),
                      const SizedBox(height: 12),
                      TextField(
                        controller: _cancelReasonController,
                        decoration: const InputDecoration(labelText: 'Reason (optional)', border: OutlineInputBorder(), isDense: true),
                      ),
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          Expanded(
                            child: ElevatedButton(
                              onPressed: _actionLoading == 'cancel' ? null : _handleCancel,
                              style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
                              child: Text(_actionLoading == 'cancel' ? 'Cancelling...' : 'Confirm Cancel'),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: OutlinedButton(onPressed: () => setState(() => _showCancelDialog = false), child: const Text('Keep')),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            ),

            const SizedBox(height: 16),

            // Change Plan
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Change Plan', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 4),
                    const Text('From canonical catalog - no hardcoded pricing', style: TextStyle(fontSize: 11, color: Colors.grey)),
                    const SizedBox(height: 12),
                    ..._plans.map((plan) {
                      final p = plan as Map<String, dynamic>;
                      final isCurrent = sub?['planId'] == p['id'];
                      return Card(
                        margin: const EdgeInsets.only(bottom: 8),
                        color: isCurrent ? Colors.blue[50] : null,
                        child: ListTile(
                          title: Text(p['name'], style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500)),
                          subtitle: Text('${p['code']} - ${p['interval']} - ${p['price']} ${p['currency']}', style: const TextStyle(fontSize: 12)),
                          trailing: isCurrent
                              ? const Chip(label: Text('Current', style: TextStyle(fontSize: 10)))
                              : ElevatedButton(
                                  onPressed: _actionLoading == 'plan_${p['id']}' ? null : () => _handleChangePlan(p['id']),
                                  child: Text(_actionLoading == 'plan_${p['id']}' ? '...' : 'Select', style: const TextStyle(fontSize: 12)),
                                ),
                        ),
                      );
                    }),
                  ],
                ),
              ),
            ),

            const SizedBox(height: 16),

            // Change Interval
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Change Billing Interval', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 12),
                    Row(
                      children: ['MONTHLY', 'QUARTERLY', 'YEARLY'].map((interval) {
                        final isCurrentInterval = sub?['plan']?['interval'] == interval;
                        return Expanded(
                          child: Padding(
                            padding: const EdgeInsets.only(right: 8),
                            child: ElevatedButton(
                              onPressed: isCurrentInterval || _actionLoading == 'interval_$interval' ? null : () => _handleChangeInterval(interval),
                              style: ElevatedButton.styleFrom(
                                backgroundColor: isCurrentInterval ? Colors.grey[300] : Colors.white,
                                foregroundColor: isCurrentInterval ? Colors.grey : Colors.black,
                                side: BorderSide(color: Colors.grey[300]!),
                              ),
                              child: Text(_actionLoading == 'interval_$interval' ? '...' : interval, style: const TextStyle(fontSize: 11)),
                            ),
                          ),
                        );
                      }).toList(),
                    ),
                    const SizedBox(height: 8),
                    const Text('Interval changes take effect at period end', style: TextStyle(fontSize: 11, color: Colors.grey)),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildRow(String label, String value, {bool isBadge = false}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(fontSize: 12, color: Colors.grey)),
          isBadge
              ? Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(color: Colors.green[100], borderRadius: BorderRadius.circular(4)),
                  child: Text(value, style: TextStyle(fontSize: 11, color: Colors.green[800])),
                )
              : Text(value, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500)),
        ],
      ),
    );
  }
}

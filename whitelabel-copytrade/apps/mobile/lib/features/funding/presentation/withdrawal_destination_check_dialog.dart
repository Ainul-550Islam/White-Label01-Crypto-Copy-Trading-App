import 'package:flutter/material.dart';

import '../../../l10n/app_localizations.dart';
import '../data/funding_repository.dart';
import '../domain/withdrawal_destination_check.dart';

/// A read-only check. This dialog deliberately has no withdrawal action.
class WithdrawalDestinationCheckDialog extends StatefulWidget {
  const WithdrawalDestinationCheckDialog({required this.repository, super.key});

  final FundingRepository repository;

  @override
  State<WithdrawalDestinationCheckDialog> createState() =>
      _WithdrawalDestinationCheckDialogState();
}

class _WithdrawalDestinationCheckDialogState
    extends State<WithdrawalDestinationCheckDialog> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _address = TextEditingController();
  String _network = withdrawalNetworks.first;
  DestinationCheckStatus? _status;
  bool _busy = false;
  bool _error = false;

  @override
  void dispose() {
    _address.dispose();
    super.dispose();
  }

  void _clearResult() {
    if (_status != null || _error) {
      setState(() {
        _status = null;
        _error = false;
      });
    }
  }

  Future<void> _check() async {
    if (_busy || !(_formKey.currentState?.validate() ?? false)) return;
    setState(() {
      _busy = true;
      _status = null;
      _error = false;
    });
    try {
      final WithdrawalDestinationCheck result =
          await widget.repository.checkWithdrawalDestination(
        network: _network,
        address: _address.text,
      );
      if (!mounted) return;
      setState(() => _status = result.status);
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String? result = _error
        ? l10n.destinationCheckError
        : switch (_status) {
            DestinationCheckStatus.allowlisted => l10n.destinationCheckAllowed,
            DestinationCheckStatus.pending => l10n.destinationCheckPending,
            DestinationCheckStatus.denied => l10n.destinationCheckDenied,
            null => null,
          };
    return AlertDialog(
      title: Text(l10n.destinationCheckTitle),
      content: Form(
        key: _formKey,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(l10n.destinationCheckNotice),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: _network,
                decoration: InputDecoration(labelText: l10n.destinationNetwork),
                items: withdrawalNetworks
                    .map((String network) => DropdownMenuItem<String>(
                        value: network, child: Text(network),),)
                    .toList(),
                onChanged: _busy
                    ? null
                    : (String? value) {
                        if (value == null) return;
                        setState(() => _network = value);
                        _clearResult();
                      },
              ),
              TextFormField(
                controller: _address,
                enabled: !_busy,
                decoration: InputDecoration(labelText: l10n.destinationAddress),
                maxLength: 128,
                autocorrect: false,
                enableSuggestions: false,
                onChanged: (_) => _clearResult(),
                validator: (String? value) {
                  final int length = (value ?? '').trim().length;
                  return length >= 16 && length <= 128
                      ? null
                      : l10n.destinationAddressInvalid;
                },
              ),
              if (_busy) const Center(child: CircularProgressIndicator()),
              if (result != null) ...<Widget>[
                const SizedBox(height: 8),
                Semantics(liveRegion: true, child: Text(result)),
              ],
            ],
          ),
        ),
      ),
      actions: <Widget>[
        TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: Text(l10n.cancel),),
        FilledButton(
            onPressed: _busy ? null : _check,
            child: Text(l10n.destinationCheckAction),),
      ],
    );
  }
}

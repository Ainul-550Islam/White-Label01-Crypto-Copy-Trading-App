import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/error/app_exception.dart';
import '../data/deposit_address_repository.dart';
import '../domain/funding_models.dart';
import 'deposit_address_strings.dart';

class DepositAddressScreen extends StatefulWidget {
  const DepositAddressScreen(
      {super.key, required this.request, required this.repository,});
  final FundingRequestSummary request;
  final DepositAddressRepository repository;

  @override
  State<DepositAddressScreen> createState() => _DepositAddressScreenState();
}

class _DepositAddressScreenState extends State<DepositAddressScreen> {
  List<DepositAssetOption>? _options;
  DepositAssetOption? _choice;
  CustomerDepositAddress? _address;
  bool _loading = true,
      _addressLoading = false,
      _unavailable = false,
      _notIssued = false;
  bool _verifying = false, _busy = false, _failed = false;
  DepositVerificationMethod _method = DepositVerificationMethod.password;
  final TextEditingController _credential = TextEditingController();
  String? _copyStatus;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _credential.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _unavailable = false;
    });
    try {
      final List<DepositAssetOption> options =
          await widget.repository.listAssets(widget.request.id);
      if (!mounted) return;
      setState(() {
        _options = options
            .where((a) => a.currency == widget.request.currency)
            .toList(growable: false);
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          _options = null;
          _unavailable = true;
        });
      }
    } finally {
      if (mounted) {
        setState(() {
          _loading = false;
        });
      }
    }
  }

  Future<void> _select(DepositAssetOption? choice) async {
    setState(() {
      _choice = choice;
      _address = null;
      _notIssued = false;
      _unavailable = false;
      _addressLoading = choice != null;
      _verifying = false;
      _failed = false;
      _credential.clear();
      _copyStatus = null;
    });
    if (choice == null) return;
    try {
      final CustomerDepositAddress address = await widget.repository
          .getAddress(widget.request.id, widget.request.accountId, choice);
      if (mounted && identical(_choice, choice)) {
        setState(() {
          _address = address;
        });
      }
    } on AppException catch (error) {
      if (mounted && identical(_choice, choice)) {
        setState(() {
          if (error.statusCode == 404) {
            _notIssued = true;
          } else {
            _unavailable = true;
          }
        });
      }
    } catch (_) {
      if (mounted && identical(_choice, choice)) {
        setState(() {
          _unavailable = true;
        });
      }
    } finally {
      if (mounted && identical(_choice, choice)) {
        setState(() {
          _addressLoading = false;
        });
      }
    }
  }

  bool get _valid {
    final String text = _method == DepositVerificationMethod.password
        ? _credential.text
        : _credential.text.trim();
    return switch (_method) {
      DepositVerificationMethod.password =>
        text.length >= 8 && text.length <= 256,
      DepositVerificationMethod.totp => RegExp(r'^\d{6}$').hasMatch(text),
      DepositVerificationMethod.recoveryCode =>
        text.length >= 8 && text.length <= 64,
    };
  }

  Future<void> _issue() async {
    final DepositAssetOption? choice = _choice;
    if (choice == null || !_valid || _busy) return;
    setState(() {
      _busy = true;
      _failed = false;
    });
    try {
      final CustomerDepositAddress address = await widget.repository
          .verifyAndIssue(widget.request.id, widget.request.accountId, choice,
              _method, _credential.text,);
      if (mounted) {
        setState(() {
          _address = address;
          _notIssued = false;
          _verifying = false;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _failed = true;
        });
      }
    } finally {
      if (mounted) {
        _credential.clear();
        setState(() {
          _busy = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final DepositAddressStrings t = DepositAddressStrings.of(context);
    final DepositAssetOption? choice = _choice;
    final CustomerDepositAddress? address = _address;
    return Scaffold(
      appBar: AppBar(title: Text(t['title'])),
      body: ListView(padding: const EdgeInsets.all(16), children: <Widget>[
        Semantics(
            liveRegion: true,
            child: Card(
                color: Theme.of(context).colorScheme.errorContainer,
                child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Text(t['warning']),),),),
        const SizedBox(height: 8),
        Text(t['pending']),
        const SizedBox(height: 16),
        if (_loading)
          Semantics(liveRegion: true, child: Text(t['loading']))
        else if (_options == null) ...<Widget>[
          Semantics(liveRegion: true, child: Text(t['unavailable'])),
          TextButton(onPressed: _load, child: Text(t['retry'])),
        ] else if (_options!.isEmpty)
          Text(t['empty'])
        else ...<Widget>[
          DropdownButtonFormField<DepositAssetOption>(
            initialValue: choice,
            decoration: InputDecoration(labelText: t['asset']),
            items: _options!
                .map((a) => DropdownMenuItem<DepositAssetOption>(
                    value: a,
                    child: Text(
                        '${a.currency} · ${a.networkName} · ${a.assetId}',),),)
                .toList(growable: false),
            onChanged: _busy ? null : _select,
          ),
          if (choice != null) ...<Widget>[
            const SizedBox(height: 10),
            Text(choice.contractAddress == null
                ? t['native']
                : '${t['contract']}: ${choice.contractAddress}',),
            if (_addressLoading)
              Semantics(liveRegion: true, child: Text(t['loading']))
            else if (_unavailable) ...<Widget>[
              Semantics(liveRegion: true, child: Text(t['unavailable'])),
              TextButton(
                  onPressed: () => _select(choice), child: Text(t['retry']),),
            ] else if (address != null) ...<Widget>[
              const SizedBox(height: 12),
              Text(t['verified'],
                  style: Theme.of(context).textTheme.titleSmall,),
              SelectableText(address.address, textDirection: TextDirection.ltr),
              Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: OutlinedButton(
                      onPressed: () async {
                        try {
                          await Clipboard.setData(
                              ClipboardData(text: address.address),);
                          if (mounted) {
                            setState(() {
                              _copyStatus = 'copied';
                            });
                          }
                        } catch (_) {
                          if (mounted) {
                            setState(() {
                              _copyStatus = 'copyFailed';
                            });
                          }
                        }
                      },
                      child: Text(t['copy']),),),
              if (_copyStatus != null)
                Semantics(liveRegion: true, child: Text(t[_copyStatus!])),
            ] else if (_notIssued && !_verifying) ...<Widget>[
              const SizedBox(height: 12),
              Text(t['noAddress']),
              Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: FilledButton(
                      onPressed: () => setState(() {
                            _verifying = true;
                          }),
                      child: Text(t['issue']),),),
            ],
            if (_verifying) ...<Widget>[
              const SizedBox(height: 16),
              Text(t['verifyTitle'],
                  style: Theme.of(context).textTheme.titleMedium,),
              Text(t['verifyHelp']),
              DropdownButtonFormField<DepositVerificationMethod>(
                  initialValue: _method,
                  decoration: InputDecoration(labelText: t['method']),
                  items: <DropdownMenuItem<DepositVerificationMethod>>[
                    DropdownMenuItem(
                        value: DepositVerificationMethod.password,
                        child: Text(t['password']),),
                    DropdownMenuItem(
                        value: DepositVerificationMethod.totp,
                        child: Text(t['totp']),),
                    DropdownMenuItem(
                        value: DepositVerificationMethod.recoveryCode,
                        child: Text(t['recovery']),),
                  ],
                  onChanged: _busy
                      ? null
                      : (value) => setState(() {
                            if (value != null) _method = value;
                            _credential.clear();
                            _failed = false;
                          }),),
              TextField(
                  controller: _credential,
                  obscureText: true,
                  enabled: !_busy,
                  decoration: InputDecoration(
                      labelText: t[switch (_method) {
                    DepositVerificationMethod.password => 'password',
                    DepositVerificationMethod.totp => 'totp',
                    DepositVerificationMethod.recoveryCode => 'recovery'
                  }],),
                  keyboardType: _method == DepositVerificationMethod.totp
                      ? TextInputType.number
                      : TextInputType.text,
                  onChanged: (_) => setState(() {}),),
              if (_failed)
                Semantics(
                    liveRegion: true,
                    child: Text(t['failed'],
                        style: TextStyle(
                            color: Theme.of(context).colorScheme.error,),),),
              Wrap(spacing: 8, children: <Widget>[
                FilledButton(
                    onPressed: _busy || !_valid ? null : _issue,
                    child: Text(_busy ? t['working'] : t['submit']),),
                TextButton(
                    onPressed: _busy
                        ? null
                        : () => setState(() {
                              _verifying = false;
                              _credential.clear();
                              _failed = false;
                            }),
                    child: Text(t['cancel']),),
              ],),
            ],
          ],
        ],
      ],),
    );
  }
}

// # Responsibility: lets the customer request a copy of their data, follows the request's state, and mints a short-lived download token only for an export the API says is ready.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/feature_providers.dart';
import '../../../core/error/app_exception.dart';
import '../../../core/widgets/async_body.dart';
import '../../../l10n/app_localizations.dart';
import '../domain/data_export_models.dart';

/// Data export.
///
/// What the customer can do here is deliberately narrow:
///
///  * request an EXPORT (one tap, idempotent);
///  * watch its state, including the two BLOCKED states that mean the platform is
///    required to keep the data;
///  * mint a single-use download token for a READY export and read the manifest.
///
/// What is absent: deleting data. `POST privacy/requests/deletion` is behind
/// `DATA_DELETION_REQUEST` step-up and an accidental tap on a phone is not
/// recoverable, so it stays in the web app.
class DataExportScreen extends ConsumerStatefulWidget {
  const DataExportScreen({super.key});

  @override
  ConsumerState<DataExportScreen> createState() => _DataExportScreenState();
}

class _DataExportScreenState extends ConsumerState<DataExportScreen> {
  /// ISO 3166-1 alpha-2. A default is offered rather than invented: the request is
  /// invalid without one and the customer can change it.
  String _jurisdiction = 'BD';
  bool _busy = false;
  String? _message;
  String? _error;

  Future<void> _requestExport(AppLocalizations l10n) async {
    setState(() {
      _busy = true;
      _error = null;
      _message = null;
    });
    try {
      final ExportRequestIdentifiers ids = ExportRequestIdentifiers.generate(DateTime.now());
      final DataExportRequest created = await ref
          .read(dataExportRepositoryProvider)
          .createExportRequest(
            jurisdiction: _jurisdiction,
            idempotencyKey: ids.idempotencyKey,
            correlationId: ids.correlationId,
          );
      setState(() => _message = '${l10n.dataExportRequestedSent} ${created.id}');
      ref.invalidate(dataExportRequestsProvider);
    } on AppException catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _download(AppLocalizations l10n, DataExportRequest request) async {
    setState(() {
      _busy = true;
      _error = null;
      _message = null;
    });
    try {
      final DataExportDownload download = await ref
          .read(dataExportRepositoryProvider)
          .issueDownloadToken(request.id);
      setState(() {
        _message = download.expiresAt == null
            // A token with no readable expiry is not a promise the screen can keep;
            // say so instead of showing a link that may already be dead.
            ? l10n.dataExportTokenNoExpiry
            : '${l10n.dataExportTokenIssued} ${_formatDate(download.expiresAt!)}';
      });
    } on AppException catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ThemeData theme = Theme.of(context);
    final AsyncValue<List<DataExportRequest>> requests = ref.watch(dataExportRequestsProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.dataExportTitle)),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(dataExportRequestsProvider.future),
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            Text(l10n.dataExportAbout, style: theme.textTheme.bodyMedium),
            const SizedBox(height: 16),
            DropdownButtonFormField<String>(
              initialValue: _jurisdiction,
              decoration: InputDecoration(labelText: l10n.dataExportJurisdiction),
              items: _jurisdictions
                  .map((String code) => DropdownMenuItem<String>(value: code, child: Text(code)))
                  .toList(growable: false),
              onChanged: _busy ? null : (String? value) => setState(() => _jurisdiction = value ?? _jurisdiction),
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: _busy ? null : () => _requestExport(l10n),
              icon: const Icon(Icons.download_outlined),
              label: Text(_busy ? l10n.dataExportWorking : l10n.dataExportRequest),
            ),
            if (_message != null) Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(_message!, style: theme.textTheme.bodyMedium),
            ),
            if (_error != null) Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(_error!, style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.error)),
            ),
            const SizedBox(height: 24),
            Text(l10n.dataExportRequests, style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            AsyncBody<List<DataExportRequest>>(
              value: requests,
              onRetry: () => ref.invalidate(dataExportRequestsProvider),
              isEmpty: (List<DataExportRequest> rows) => rows.isEmpty,
              emptyText: l10n.dataExportNone,
              builder: (List<DataExportRequest> rows) => Column(
                children: rows
                    .map((DataExportRequest request) => _RequestCard(
                          request: request,
                          busy: _busy,
                          onDownload: () => _download(l10n, request),
                        ))
                    .toList(growable: false),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// The jurisdictions this build offers on the phone. A request needs ONE; the API
  /// validates the length and does not enumerate them, so the list lives here rather
  /// than being guessed from a server field that does not exist.
  static const List<String> _jurisdictions = <String>['BD', 'US', 'GB', 'DE', 'AE', 'SG', 'TR', 'IN'];
}

class _RequestCard extends StatelessWidget {
  const _RequestCard({required this.request, required this.busy, required this.onDownload});

  final DataExportRequest request;
  final bool busy;
  final VoidCallback onDownload;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ThemeData theme = Theme.of(context);

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text('${request.requestType} · ${request.state}', style: theme.textTheme.titleSmall),
            if (request.requestedAt != null)
              Text('${l10n.dataExportRequestedAtLabel}: ${_formatDate(request.requestedAt!)}'),
            if (request.needsCustomerAction) Text(l10n.dataExportNeedsYou),
            if (request.retentionBlock || request.legalHoldBlock)
              Text(
                request.legalHoldBlock ? l10n.dataExportLegalHold : l10n.dataExportRetention,
                style: theme.textTheme.bodySmall,
              ),
            if (request.blockedReason != null) Text(request.blockedReason!, style: theme.textTheme.bodySmall),
            if (request.canDownload)
              Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  onPressed: busy ? null : onDownload,
                  icon: const Icon(Icons.link),
                  label: Text(l10n.dataExportGetLink),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

String _formatDate(DateTime value) {
  String two(int part) => part.toString().padLeft(2, '0');
  return '${value.year}-${two(value.month)}-${two(value.day)} ${two(value.hour)}:${two(value.minute)}';
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../error/app_exception.dart';
import '../../l10n/app_localizations.dart';

/// Loading / error / empty / data rendering shared by the Phase 3 screens.
/// An error is shown as the API's own message with a retry, never replaced
/// by placeholder data.
class AsyncBody<T> extends StatelessWidget {
  const AsyncBody({
    super.key,
    required this.value,
    required this.onRetry,
    required this.builder,
    this.isEmpty,
    this.emptyText,
  });

  final AsyncValue<T> value;
  final VoidCallback onRetry;
  final Widget Function(T data) builder;
  final bool Function(T data)? isEmpty;
  final String? emptyText;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return value.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (Object error, StackTrace _) => ErrorPanel(message: describeError(error, l10n), onRetry: onRetry),
      data: (T data) {
        if (isEmpty != null && isEmpty!(data)) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Text(emptyText ?? l10n.nothingHereYet, textAlign: TextAlign.center),
            ),
          );
        }
        return builder(data);
      },
    );
  }
}

String describeError(Object error, AppLocalizations l10n) {
  if (error is AppException) {
    return error.message;
  }
  if (error is ArgumentError) {
    return error.message.toString();
  }
  return l10n.genericError;
}

class ErrorPanel extends StatelessWidget {
  const ErrorPanel({super.key, required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(Icons.error_outline, color: Theme.of(context).colorScheme.error),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            OutlinedButton(onPressed: onRetry, child: Text(l10n.retry)),
          ],
        ),
      ),
    );
  }
}

/// Runs a write, shows the outcome in a snackbar, returns whether it worked.
Future<bool> runAction(BuildContext context, Future<void> Function() action, {required String success}) async {
  final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
  final AppLocalizations l10n = AppLocalizations.of(context);
  try {
    await action();
    messenger.showSnackBar(SnackBar(content: Text(success)));
    return true;
  } catch (error) {
    messenger.showSnackBar(SnackBar(content: Text(describeError(error, l10n))));
    return false;
  }
}

Future<bool> confirm(BuildContext context, {required String title, required String message}) async {
  final AppLocalizations l10n = AppLocalizations.of(context);
  final bool? ok = await showDialog<bool>(
    context: context,
    builder: (BuildContext context) => AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: <Widget>[
        TextButton(onPressed: () => Navigator.of(context).pop(false), child: Text(l10n.cancel)),
        FilledButton(onPressed: () => Navigator.of(context).pop(true), child: Text(l10n.confirm)),
      ],
    ),
  );
  return ok ?? false;
}

String formatTimestamp(DateTime? at) {
  if (at == null) {
    return '—';
  }
  String two(int v) => v.toString().padLeft(2, '0');
  return '${at.year}-${two(at.month)}-${two(at.day)} ${two(at.hour)}:${two(at.minute)}';
}

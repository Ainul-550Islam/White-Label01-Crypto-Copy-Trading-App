import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../../core/di/providers.dart';
import '../../l10n/app_localizations.dart';
import 'data/user_preferences_repository.dart';

/// Edits exactly the values supported by the user-scoped preferences API.
class PreferencesForm extends ConsumerStatefulWidget {
  const PreferencesForm({required this.initial, super.key});
  final UserPreferences initial;

  @override
  ConsumerState<PreferencesForm> createState() => _PreferencesFormState();
}

class _PreferencesFormState extends ConsumerState<PreferencesForm> {
  final GlobalKey<FormState> _form = GlobalKey<FormState>();
  late String _locale, _currency, _format;
  late final TextEditingController _timezone;
  bool _busy = false;
  String? _error;
  String? _intentFingerprint, _intentKey;

  @override
  void initState() {
    super.initState();
    _locale = widget.initial.locale;
    _currency = widget.initial.displayCurrency;
    _format = widget.initial.dateFormat;
    _timezone = TextEditingController(text: widget.initial.timezone);
  }

  @override
  void dispose() {
    _timezone.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_busy || !(_form.currentState?.validate() ?? false)) return;
    final UserPreferences value = UserPreferences(
      locale: _locale,
      displayCurrency: _currency,
      timezone: _timezone.text.trim(),
      dateFormat: _format,
    );
    final String fingerprint = value.toJson().toString();
    if (_intentFingerprint != fingerprint) {
      _intentFingerprint = fingerprint;
      _intentKey = const Uuid().v4();
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(userPreferencesRepositoryProvider)
          .save(value, idempotencyKey: _intentKey!);
      _intentFingerprint = null;
      _intentKey = null;
      ref.invalidate(userPreferencesProvider);
    } catch (_) {
      if (mounted) {
        setState(() => _error = AppLocalizations.of(context).genericError);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Form(
        key: _form,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Text(
              l10n.displayPreferences,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(
              // ignore: deprecated_member_use
              value: _locale,
              decoration: InputDecoration(labelText: l10n.languageLabel),
              items: const <DropdownMenuItem<String>>[
                DropdownMenuItem<String>(value: 'en', child: Text('English')),
                DropdownMenuItem<String>(value: 'bn', child: Text('বাংলা')),
                DropdownMenuItem<String>(value: 'ar', child: Text('العربية')),
                DropdownMenuItem<String>(value: 'es', child: Text('Español')),
                DropdownMenuItem<String>(value: 'tr', child: Text('Türkçe')),
              ],
              onChanged: _busy
                  ? null
                  : (value) => setState(() => _locale = value ?? _locale),
            ),
            DropdownButtonFormField<String>(
              // ignore: deprecated_member_use
              value: _currency,
              decoration: InputDecoration(
                labelText: l10n.displayCurrencyLabel,
              ),
              items: UserPreferences.currencies
                  .map(
                    (value) => DropdownMenuItem<String>(
                      value: value,
                      child: Text(value),
                    ),
                  )
                  .toList(),
              onChanged: _busy
                  ? null
                  : (value) => setState(() => _currency = value ?? _currency),
            ),
            TextFormField(
              controller: _timezone,
              enabled: !_busy,
              maxLength: 64,
              decoration: InputDecoration(
                labelText: l10n.timeZoneLabel,
                hintText: 'Asia/Dhaka',
              ),
              validator: (value) => value == null || value.trim().isEmpty
                  ? l10n.timeZoneRequired
                  : null,
            ),
            DropdownButtonFormField<String>(
              // ignore: deprecated_member_use
              value: _format,
              decoration: InputDecoration(
                labelText: l10n.dateFormatLabel,
              ),
              items: UserPreferences.dateFormats
                  .map(
                    (value) => DropdownMenuItem<String>(
                      value: value,
                      child: Text(value),
                    ),
                  )
                  .toList(),
              onChanged: _busy
                  ? null
                  : (value) => setState(() => _format = value ?? _format),
            ),
            const SizedBox(height: 8),
            Text(
              l10n.preferencesSupportNotice,
            ),
            if (_error != null)
              Semantics(
                liveRegion: true,
                child: Text(
                  _error!,
                  style: TextStyle(
                    color: Theme.of(context).colorScheme.error,
                  ),
                ),
              ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: _busy ? null : _save,
              child: Text(
                _busy
                    ? l10n.loading
                    : l10n.savePreferences,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

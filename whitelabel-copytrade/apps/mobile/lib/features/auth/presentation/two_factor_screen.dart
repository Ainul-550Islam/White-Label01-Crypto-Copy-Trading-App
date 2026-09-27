import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/providers.dart';
import '../../../l10n/app_localizations.dart';
import 'auth_state.dart';

/// Second-factor challenge.
///
/// The challenge token lives only in [AuthState] for the lifetime of this
/// screen - it is never written to storage. Cancelling drops it and returns the
/// user to a clean sign-in.
class TwoFactorScreen extends ConsumerStatefulWidget {
  const TwoFactorScreen({super.key});

  @override
  ConsumerState<TwoFactorScreen> createState() => _TwoFactorScreenState();
}

class _TwoFactorScreenState extends ConsumerState<TwoFactorScreen> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _codeController = TextEditingController();

  bool _useRecoveryCode = false;

  @override
  void dispose() {
    _codeController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final FormState? form = _formKey.currentState;

    if (form == null || !form.validate()) {
      return;
    }

    FocusScope.of(context).unfocus();

    await ref.read(authControllerProvider.notifier).submitTwoFactor(
          code: _codeController.text,
          method: _useRecoveryCode ? 'RECOVERY_CODE' : 'TOTP',
        );

    if (!mounted) {
      return;
    }

    _codeController.clear();
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AuthState state = ref.watch(authControllerProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.twoFactorTitle),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => ref.read(authControllerProvider.notifier).cancelTwoFactor(),
        ),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Form(
              key: _formKey,
              autovalidateMode: AutovalidateMode.onUserInteraction,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Text(l10n.twoFactorSubtitle, style: Theme.of(context).textTheme.bodyMedium),
                  const SizedBox(height: 24),
                  TextFormField(
                    controller: _codeController,
                    keyboardType:
                        _useRecoveryCode ? TextInputType.text : TextInputType.number,
                    inputFormatters: _useRecoveryCode
                        ? const <TextInputFormatter>[]
                        : <TextInputFormatter>[
                            FilteringTextInputFormatter.digitsOnly,
                            LengthLimitingTextInputFormatter(6),
                          ],
                    autofillHints: const <String>[AutofillHints.oneTimeCode],
                    decoration: InputDecoration(
                      labelText: _useRecoveryCode
                          ? l10n.recoveryCodeLabel
                          : l10n.twoFactorCodeLabel,
                    ),
                    validator: (String? value) =>
                        (value == null || value.trim().length < 6) ? l10n.codeRequired : null,
                    onFieldSubmitted: (_) => _submit(),
                  ),
                  if (state.error != null) ...<Widget>[
                    const SizedBox(height: 16),
                    Text(
                      state.error!.message,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                        fontSize: 13,
                      ),
                    ),
                  ],
                  const SizedBox(height: 24),
                  FilledButton(
                    onPressed: state.isSubmitting ? null : _submit,
                    child: state.isSubmitting
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Text(l10n.verify),
                  ),
                  const SizedBox(height: 12),
                  TextButton(
                    onPressed: () {
                      setState(() {
                        _useRecoveryCode = !_useRecoveryCode;
                        _codeController.clear();
                      });
                      ref.read(authControllerProvider.notifier).clearError();
                    },
                    child: Text(
                      _useRecoveryCode ? l10n.useAuthenticator : l10n.useRecoveryCode,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

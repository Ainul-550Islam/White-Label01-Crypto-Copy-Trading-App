import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/providers.dart';
import '../../auth/presentation/auth_state.dart';
import '../data/push_registration.dart';

/// Keeps the latest provider token registered after sign-in and on foreground.
/// It never asks for OS permission on its own.
class PushRegistrationObserver extends ConsumerStatefulWidget {
  const PushRegistrationObserver({super.key, required this.child});
  final Widget child;
  @override
  ConsumerState<PushRegistrationObserver> createState() => _PushRegistrationObserverState();
}

class _PushRegistrationObserverState extends ConsumerState<PushRegistrationObserver> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) => _sync());
  }

  void _sync() {
    if (mounted && ref.read(authControllerProvider).isAuthenticated) {
      ref.read(pushRegistrationProvider).sync();
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _sync();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<AuthState>(authControllerProvider, (AuthState? previous, AuthState next) {
      if (previous?.user != next.user) ref.read(pushRegistrationProvider).reset();
      if (next.isAuthenticated && (previous?.isAuthenticated != true || previous?.user != next.user)) _sync();
    });
    return widget.child;
  }
}

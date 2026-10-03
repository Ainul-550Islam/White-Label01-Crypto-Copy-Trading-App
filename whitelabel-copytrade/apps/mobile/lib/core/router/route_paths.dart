/// Every navigable location in the app.
///
/// Declared as constants so a typo is a compile error rather than a blank
/// screen at runtime.
class RoutePaths {
  const RoutePaths._();

  static const String splash = '/';
  static const String login = '/login';
  static const String twoFactor = '/login/two-factor';
  static const String home = '/home';
  static const String strategies = '/strategies';
  static const String risk = '/risk';
  static const String settings = '/settings';
  static const String security = '/settings/security';
  static const String exchangeAccounts = '/exchange-accounts';
  static const String copyTrading = '/copy-trading';
  static const String funding = '/funding';
  static const String portfolio = '/portfolio';
  static const String notifications = '/notifications';
}

class RouteNames {
  const RouteNames._();

  static const String splash = 'splash';
  static const String login = 'login';
  static const String twoFactor = 'twoFactor';
  static const String home = 'home';
  static const String strategies = 'strategies';
  static const String risk = 'risk';
  static const String settings = 'settings';
  static const String security = 'security';
  static const String exchangeAccounts = 'exchangeAccounts';
  static const String copyTrading = 'copyTrading';
  static const String funding = 'funding';
  static const String portfolio = 'portfolio';
  static const String notifications = 'notifications';
}

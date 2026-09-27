/// Endpoint paths, relative to the versioned API base.
///
/// Centralised so a route rename is a one-line change and so no string literal
/// URL is scattered through the feature layer.
class ApiEndpoints {
  const ApiEndpoints._();

  static const String login = '/auth/login';
  static const String register = '/auth/register';
  static const String verifyTwoFactor = '/auth/two-factor/verify';
  static const String refresh = '/auth/refresh';
  static const String logout = '/auth/logout';
  static const String changePassword = '/auth/change-password';
  static const String me = '/auth/me';

  static const String sessions = '/auth/sessions';
  static String session(String id) => '/auth/sessions/$id';

  static const String twoFactorSetup = '/auth/two-factor/setup';
  static const String twoFactorEnable = '/auth/two-factor/enable';
  static const String twoFactorDisable = '/auth/two-factor/disable';

  static const String currentUser = '/users/me';
  static const String tenantPublicConfig = '/tenants/public-config';
  static const String featureFlags = '/feature-flags/resolved';

  /// Strategy layer. Read-only from mobile: the client is granted no
  /// permission that would let it enable an instance or start a session, and
  /// no write path is declared here.
  static const String strategyMetrics = '/strategies/metrics';
  static const String strategyInstances = '/strategies/instances';
  static const String strategyIncidents = '/strategies/incidents';
  static const String backtests = '/strategies/backtests';
  static const String paperSessions = '/strategies/paper-sessions';

  /// Part 8 risk surface - reads only. Deliberately only three paths: the
  /// status panel, the switch table and the event feed. There is no engage,
  /// no clear, no config route here to "wire up later", because the mobile
  /// brief is viewer-only and the absence is the API of this client.
  static const String riskStatus = '/risk/status';
  static const String riskKillSwitches = '/risk/kill-switches';
  static const String riskEvents = '/risk/events';

  static const String notifications = '/notifications';
  static const String notificationUnreadCount = '/notifications/unread-count';
  static const String notificationPreferences = '/notifications/preferences';
  static String markNotificationRead(String id) => '/notifications/$id/read';
}

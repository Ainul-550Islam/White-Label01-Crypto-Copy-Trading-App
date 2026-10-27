import '../../../core/network/api_client.dart';
import '../../../core/network/api_endpoints.dart';
import '../../../core/network/json_read.dart';

/// Values accepted by the authenticated user's preferences endpoint.
class UserPreferences {
  const UserPreferences({
    required this.locale,
    required this.displayCurrency,
    required this.timezone,
    required this.dateFormat,
  });

  static const Set<String> locales = <String>{'en', 'bn', 'ar', 'es', 'tr'};
  static const Set<String> currencies = <String>{
    'BDT',
    'USD',
    'EUR',
    'GBP',
    'JPY',
    'BTC',
    'ETH',
  };
  static const Set<String> dateFormats = <String>{'ISO', 'DMY', 'MDY'};

  factory UserPreferences.fromJson(Object? value) {
    final Map<String, Object?> json = JsonRead.map(value);
    final Object? locale = json['locale'];
    final Object? currency = json['displayCurrency'];
    final Object? timezone = json['timezone'];
    final Object? format = json['dateFormat'];
    if (locale is! String ||
        !locales.contains(locale) ||
        currency is! String ||
        !currencies.contains(currency) ||
        timezone is! String ||
        timezone.isEmpty ||
        timezone.length > 64 ||
        format is! String ||
        !dateFormats.contains(format)) {
      throw const FormatException('Unexpected preferences response');
    }
    return UserPreferences(
      locale: locale,
      displayCurrency: currency,
      timezone: timezone,
      dateFormat: format,
    );
  }

  final String locale;
  final String displayCurrency;
  final String timezone;
  final String dateFormat;

  Map<String, String> toJson() => <String, String>{
        'locale': locale,
        'displayCurrency': displayCurrency,
        'timezone': timezone,
        'dateFormat': dateFormat,
      };
}

/// Persists preferences in the real tenant/user-scoped backend, never in a
/// device-wide value that could bleed into another signed-in account.
class UserPreferencesRepository {
  UserPreferencesRepository(this._api);
  final ApiClient _api;

  Future<UserPreferences> fetch() => _api.get<UserPreferences>(
        ApiEndpoints.userPreferences,
        parser: UserPreferences.fromJson,
      );

  Future<UserPreferences> save(
    UserPreferences value, {
    required String idempotencyKey,
  }) =>
      _api.put<UserPreferences>(
        ApiEndpoints.userPreferences,
        body: value.toJson(),
        idempotencyKey: idempotencyKey,
        parser: UserPreferences.fromJson,
      );
}

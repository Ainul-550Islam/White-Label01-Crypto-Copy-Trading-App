// # Responsibility: the fee-schedule model with every rate kept as the decimal string the API sent — no double anywhere, so a published 0.0025 is displayed as 0.0025 and never as a float approximation of it.
import 'package:equatable/equatable.dart';

import '../../../core/network/json_read.dart';

/// One published fee-schedule version.
///
/// `managementFeeRate` and `profitShareRate` are `String`, not `double`, and are
/// never parsed. The API stores them as exact decimals and the whole point of the
/// schedule is that the number billed is the number published: `0.0025` through a
/// IEEE-754 double is `0.0024999999999999999467…`, and a screen that rounds it for
/// display is one refactor away from sending it back.
class FeeScheduleVersion extends Equatable {
  const FeeScheduleVersion({
    required this.version,
    required this.managementFeeRate,
    required this.profitShareRate,
    required this.currency,
    this.effectiveFrom,
    this.effectiveUntil,
  });

  factory FeeScheduleVersion.fromJson(Map<String, Object?> json) {
    return FeeScheduleVersion(
      version: JsonRead.integer(json, 'version'),
      managementFeeRate: JsonRead.strOr(json, 'managementFeeRate', ''),
      profitShareRate: JsonRead.strOr(json, 'profitShareRate', ''),
      currency: JsonRead.strOr(json, 'currency', ''),
      effectiveFrom: JsonRead.date(json, 'effectiveFrom'),
      effectiveUntil: JsonRead.date(json, 'effectiveUntil'),
    );
  }

  final int version;

  /// Decimal string exactly as published.
  final String managementFeeRate;

  /// Decimal string exactly as published.
  final String profitShareRate;
  final String currency;
  final DateTime? effectiveFrom;
  final DateTime? effectiveUntil;

  @override
  List<Object?> get props => <Object?>[version, managementFeeRate, profitShareRate, currency, effectiveFrom, effectiveUntil];
}

/// What `GET /v1/public/fee-schedule` returns: the version in force plus the ten
/// behind it, and which scope it came from.
class FeeSchedule extends Equatable {
  const FeeSchedule({
    required this.version,
    required this.managementFeeRate,
    required this.profitShareRate,
    required this.currency,
    required this.source,
    this.effectiveFrom,
    this.effectiveUntil,
    this.versions = const <FeeScheduleVersion>[],
  });

  factory FeeSchedule.fromJson(Map<String, Object?> json) {
    final Object? rawVersions = json['versions'];
    final List<FeeScheduleVersion> versions = rawVersions is List
        ? JsonRead.rows(rawVersions).map(FeeScheduleVersion.fromJson).toList(growable: false)
        : const <FeeScheduleVersion>[];
    return FeeSchedule(
      version: JsonRead.integer(json, 'version'),
      managementFeeRate: JsonRead.strOr(json, 'managementFeeRate', ''),
      profitShareRate: JsonRead.strOr(json, 'profitShareRate', ''),
      currency: JsonRead.strOr(json, 'currency', ''),
      source: JsonRead.strOr(json, 'source', 'platform_default'),
      effectiveFrom: JsonRead.date(json, 'effectiveFrom'),
      effectiveUntil: JsonRead.date(json, 'effectiveUntil'),
      versions: versions,
    );
  }

  final int version;
  final String managementFeeRate;
  final String profitShareRate;
  final String currency;

  /// `platform_default` or `tenant_override`. The customer is shown which one they
  /// are looking at, because an override is the operator's decision and not the
  /// platform's published default.
  final String source;
  final DateTime? effectiveFrom;
  final DateTime? effectiveUntil;
  final List<FeeScheduleVersion> versions;

  bool get isTenantOverride => source == 'tenant_override';

  @override
  List<Object?> get props => <Object?>[version, managementFeeRate, profitShareRate, currency, source, effectiveFrom, effectiveUntil, versions];
}

/// Formats a rate string as a percentage by shifting its digits two places.
///
/// No `double`, no `parseFloat`, no `NumberFormat`: `0.0025` becomes `0.25 %` and
/// `0.20` and `0.2` both become `20 %`. A value that is not a plain decimal is
/// returned unchanged, so the customer sees what the API actually sent.
String formatRatePercent(String rate) {
  final RegExp decimal = RegExp(r'^(0|[1-9][0-9]*)(\.[0-9]+)?$');
  if (!decimal.hasMatch(rate)) {
    return rate;
  }
  final int dot = rate.indexOf('.');
  final String whole = dot < 0 ? rate : rate.substring(0, dot);
  final String fraction = dot < 0 ? '' : rate.substring(dot + 1);
  final String digits = '$whole$fraction';
  final int pointAt = whole.length + 2;
  final String shifted = digits.padRight(pointAt + 1, '0');
  final String percentWhole = shifted.substring(0, pointAt).replaceFirst(RegExp(r'^0+(?=\d)'), '');
  final String percentFraction =
      shifted.substring(pointAt).replaceFirst(RegExp(r'0+$'), '');
  return percentFraction.isEmpty ? '$percentWhole %' : '$percentWhole.$percentFraction %';
}

/// A customer's own copy budget, not an account-wide risk policy or a balance.
class CopyBudget {
  const CopyBudget({
    required this.tenantId,
    required this.userId,
    required this.currency,
    required this.personalCap,
    required this.effectiveCap,
    required this.committed,
    required this.exposureStatus,
    required this.remaining,
  });

  final String tenantId;
  final String userId;
  final String? currency;
  final String? personalCap;
  final String? effectiveCap;
  final String? committed;
  final String exposureStatus;
  final String? remaining;

  factory CopyBudget.fromJson(Object? value) {
    if (value is! Map) throw const FormatException('Invalid budget response');
    final Object? tenantId = value['tenantId'];
    final Object? userId = value['userId'];
    final Object? currency = value['currency'];
    final Object? personal = value['maxActiveExposure'];
    final Object? effective = value['effectiveCap'];
    final Object? ceiling = value['tenantCeiling'];
    final Object? committed = value['committed'];
    final Object? exposureStatus = value['exposureStatus'];
    final Object? remaining = value['remaining'];
    if (!<String>[
          'currency',
          'maxActiveExposure',
          'effectiveCap',
          'tenantCeiling',
          'committed',
          'exposureStatus',
          'remaining',
        ].every(value.containsKey) ||
        tenantId is! String ||
        tenantId.isEmpty ||
        userId is! String ||
        userId.isEmpty ||
        !(currency == null ||
            (currency is String &&
                RegExp(r'^[A-Z0-9]{2,12}$').hasMatch(currency))) ||
        !(exposureStatus == 'ALLOCATION_ESTIMATE' ||
            exposureStatus == 'UNAVAILABLE') ||
        !_nullableDecimal(personal) ||
        !_nullableDecimal(effective) ||
        !_nullableDecimal(ceiling) ||
        !_nullableDecimal(committed) ||
        !_nullableDecimal(remaining) ||
        ((personal != null || ceiling != null) && effective == null) ||
        (exposureStatus == 'ALLOCATION_ESTIMATE' && committed == null) ||
        (exposureStatus == 'UNAVAILABLE' &&
            (committed != null || remaining != null)) ||
        (effective != null && currency == null) ||
        (effective != null &&
            exposureStatus == 'ALLOCATION_ESTIMATE' &&
            remaining == null) ||
        (effective == null && remaining != null) ||
        (effective != null && personal == null && ceiling == null)) {
      throw const FormatException('Invalid budget response');
    }
    if (effective is String) {
      final List<String> caps = <String>[
        if (personal is String) personal,
        if (ceiling is String) ceiling,
      ];
      final String tightest = caps.reduce(
        (String a, String b) => compareBudgetDecimals(a, b) <= 0 ? a : b,
      );
      if (compareBudgetDecimals(effective, tightest) != 0) {
        throw const FormatException('Invalid budget response');
      }
    }
    return CopyBudget(
      tenantId: tenantId,
      userId: userId,
      currency: currency as String?,
      personalCap: personal as String?,
      effectiveCap: effective as String?,
      committed: committed as String?,
      exposureStatus: exposureStatus as String,
      remaining: remaining as String?,
    );
  }
}

bool _decimal(Object? value) =>
    value is String && RegExp(r'^\d{1,64}(?:\.\d{1,18})?$').hasMatch(value);
bool _nullableDecimal(Object? value) => value == null || _decimal(value);

/// Accept local digit shapes but use the API's decimal point, never grouping.
String normaliseBudgetInput(String input) {
  final StringBuffer out = StringBuffer();
  for (final int rune in input.trim().runes) {
    if (rune >= 0x0660 && rune <= 0x0669) {
      out.writeCharCode(0x30 + rune - 0x0660);
    } else if (rune >= 0x06f0 && rune <= 0x06f9) {
      out.writeCharCode(0x30 + rune - 0x06f0);
    } else if (rune >= 0x09e6 && rune <= 0x09ef) {
      out.writeCharCode(0x30 + rune - 0x09e6);
    } else if (rune == 0x066b) {
      out.write('.');
    } else {
      out.writeCharCode(rune);
    }
  }
  return out.toString();
}

/// The server persists DECIMAL(28,12); values outside this domain would round.
bool isValidBudgetReduction(String input) =>
    RegExp(r'^\d{1,16}(?:\.\d{1,12})?$').hasMatch(input);

/// Exact, non-negative decimal comparison without converting money to doubles.
int compareBudgetDecimals(String left, String right) {
  if (!_decimal(left) || !_decimal(right)) {
    throw const FormatException('Invalid decimal');
  }
  final List<String> a = left.split('.');
  final List<String> b = right.split('.');
  final String aw = a[0].replaceFirst(RegExp(r'^0+(?=\d)'), '');
  final String bw = b[0].replaceFirst(RegExp(r'^0+(?=\d)'), '');
  if (aw.length != bw.length) return aw.length.compareTo(bw.length);
  if (aw != bw) return aw.compareTo(bw);
  final String af = a.length > 1 ? a[1] : '';
  final String bf = b.length > 1 ? b[1] : '';
  final int width = af.length > bf.length ? af.length : bf.length;
  return af.padRight(width, '0').compareTo(bf.padRight(width, '0'));
}

/// Tolerant JSON readers shared by the Phase 3 feature repositories.
///
/// The API answers list routes in three shapes (a bare array, `{ data: [] }`
/// and `{ items: [] }`) depending on the module. Parsing through these
/// helpers means a shape difference degrades to an empty list or a null
/// field instead of a crash, and a field is never invented: absent stays
/// absent.
class JsonRead {
  const JsonRead._();

  static Map<String, Object?> map(Object? value) {
    if (value is Map) {
      return value.map<String, Object?>(
        (Object? key, Object? item) => MapEntry<String, Object?>(key.toString(), item),
      );
    }
    return const <String, Object?>{};
  }

  /// Rows of a list response, whatever envelope the module uses.
  static List<Map<String, Object?>> rows(Object? value) {
    Object? list = value;
    if (value is Map) {
      list = value['data'] ?? value['items'] ?? value['results'];
    }
    if (list is! List) {
      return const <Map<String, Object?>>[];
    }
    return list
        .whereType<Map<Object?, Object?>>()
        .map<Map<String, Object?>>(map)
        .toList(growable: false);
  }

  static String? str(Map<String, Object?> json, String key) {
    final Object? value = json[key];
    if (value == null) {
      return null;
    }
    final String text = value.toString();
    return text.isEmpty ? null : text;
  }

  static String strOr(Map<String, Object?> json, String key, String fallback) =>
      str(json, key) ?? fallback;

  static bool boolean(Map<String, Object?> json, String key) => json[key] == true;

  static int integer(Map<String, Object?> json, String key) {
    final Object? value = json[key];
    if (value is int) {
      return value;
    }
    if (value is num) {
      return value.toInt();
    }
    return int.tryParse(value?.toString() ?? '') ?? 0;
  }

  static DateTime? date(Map<String, Object?> json, String key) {
    final String? text = str(json, key);
    return text == null ? null : DateTime.tryParse(text)?.toLocal();
  }

  static List<String> strings(Map<String, Object?> json, String key) {
    final Object? value = json[key];
    if (value is! List) {
      return const <String>[];
    }
    return value.map((Object? item) => item.toString()).toList(growable: false);
  }
}

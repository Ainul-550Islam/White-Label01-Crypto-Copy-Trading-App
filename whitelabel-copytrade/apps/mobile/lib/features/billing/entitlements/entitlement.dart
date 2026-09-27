/// Entitlement Model
/// 
/// Represents a user's entitlement in the mobile application.

enum EntitlementStatus {
  active,
  suspended,
  expired,
  cancelled,
  trial,
}

enum UsagePeriod {
  daily,
  weekly,
  monthly,
  yearly,
  lifetime,
}

class EntitlementFeature {
  final String key;
  final String name;
  final String description;
  final bool enabled;
  final int? limit;
  final String? unit;
  final int? usage;
  final double? usagePercentage;

  const EntitlementFeature({
    required this.key,
    required this.name,
    required this.description,
    this.enabled = true,
    this.limit,
    this.unit,
    this.usage,
    this.usagePercentage,
  });

  factory EntitlementFeature.fromJson(Map<String, dynamic> json) {
    return EntitlementFeature(
      key: json['key'] as String,
      name: json['name'] as String,
      description: json['description'] as String? ?? '',
      enabled: json['enabled'] as bool? ?? true,
      limit: json['limit'] as int?,
      unit: json['unit'] as String?,
      usage: json['usage'] as int?,
      usagePercentage: (json['usagePercentage'] as num?)?.toDouble(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'key': key,
      'name': name,
      'description': description,
      'enabled': enabled,
      if (limit != null) 'limit': limit,
      if (unit != null) 'unit': unit,
      if (usage != null) 'usage': usage,
      if (usagePercentage != null) 'usagePercentage': usagePercentage,
    };
  }

  bool get isNearLimit => usagePercentage != null && usagePercentage! > 80;
  bool get isAtLimit => usagePercentage != null && usagePercentage! >= 100;
}

class EntitlementLimit {
  final String key;
  final String name;
  final String description;
  final int value;
  final String unit;
  final int usage;
  final double usagePercentage;
  final bool hardLimit;
  final DateTime? resetAt;

  const EntitlementLimit({
    required this.key,
    required this.name,
    required this.description,
    required this.value,
    required this.unit,
    required this.usage,
    required this.usagePercentage,
    this.hardLimit = true,
    this.resetAt,
  });

  factory EntitlementLimit.fromJson(Map<String, dynamic> json) {
    return EntitlementLimit(
      key: json['key'] as String,
      name: json['name'] as String,
      description: json['description'] as String? ?? '',
      value: json['value'] as int,
      unit: json['unit'] as String,
      usage: json['usage'] as int,
      usagePercentage: (json['usagePercentage'] as num).toDouble(),
      hardLimit: json['hardLimit'] as bool? ?? true,
      resetAt: json['resetAt'] != null ? DateTime.parse(json['resetAt'] as String) : null,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'key': key,
      'name': name,
      'description': description,
      'value': value,
      'unit': unit,
      'usage': usage,
      'usagePercentage': usagePercentage,
      'hardLimit': hardLimit,
      if (resetAt != null) 'resetAt': resetAt!.toIso8601String(),
    };
  }

  bool get isUnlimited => value == -1;
  bool get isNearLimit => usagePercentage > 80;
  bool get isAtLimit => usagePercentage >= 100;
  bool get isOverLimit => usage > value && !isUnlimited;

  int get remaining => isUnlimited ? -1 : (value - usage).clamp(0, value);

  String get displayValue {
    if (isUnlimited) return 'Unlimited';
    return '$value $unit';
  }

  String get usageDisplay {
    if (isUnlimited) return '$usage used';
    return '$usage / $value $unit';
  }
}

class Entitlement {
  final String id;
  final String tenantId;
  final String userId;
  final String planId;
  final String planName;
  final String planTier;
  final EntitlementStatus status;
  final List<EntitlementFeature> features;
  final List<EntitlementLimit> limits;
  final DateTime startsAt;
  final DateTime? expiresAt;
  final DateTime? trialEndsAt;
  final DateTime? cancelledAt;
  final Map<String, String> metadata;
  final DateTime createdAt;
  final DateTime updatedAt;

  const Entitlement({
    required this.id,
    required this.tenantId,
    required this.userId,
    required this.planId,
    required this.planName,
    required this.planTier,
    required this.status,
    required this.features,
    required this.limits,
    required this.startsAt,
    this.expiresAt,
    this.trialEndsAt,
    this.cancelledAt,
    this.metadata = const {},
    required this.createdAt,
    required this.updatedAt,
  });

  factory Entitlement.fromJson(Map<String, dynamic> json) {
    return Entitlement(
      id: json['id'] as String,
      tenantId: json['tenantId'] as String,
      userId: json['userId'] as String,
      planId: json['planId'] as String,
      planName: json['planName'] as String,
      planTier: json['planTier'] as String,
      status: EntitlementStatus.values.firstWhere(
        (e) => e.name == json['status'],
        orElse: () => EntitlementStatus.active,
      ),
      features: (json['features'] as List<dynamic>?)
              ?.map((e) => EntitlementFeature.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
      limits: (json['limits'] as List<dynamic>?)
              ?.map((e) => EntitlementLimit.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
      startsAt: DateTime.parse(json['startsAt'] as String),
      expiresAt: json['expiresAt'] != null ? DateTime.parse(json['expiresAt'] as String) : null,
      trialEndsAt: json['trialEndsAt'] != null ? DateTime.parse(json['trialEndsAt'] as String) : null,
      cancelledAt: json['cancelledAt'] != null ? DateTime.parse(json['cancelledAt'] as String) : null,
      metadata: Map<String, String>.from(json['metadata'] as Map? ?? {}),
      createdAt: DateTime.parse(json['createdAt'] as String),
      updatedAt: DateTime.parse(json['updatedAt'] as String),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'tenantId': tenantId,
      'userId': userId,
      'planId': planId,
      'planName': planName,
      'planTier': planTier,
      'status': status.name,
      'features': features.map((e) => e.toJson()).toList(),
      'limits': limits.map((e) => e.toJson()).toList(),
      'startsAt': startsAt.toIso8601String(),
      if (expiresAt != null) 'expiresAt': expiresAt!.toIso8601String(),
      if (trialEndsAt != null) 'trialEndsAt': trialEndsAt!.toIso8601String(),
      if (cancelledAt != null) 'cancelledAt': cancelledAt!.toIso8601String(),
      'metadata': metadata,
      'createdAt': createdAt.toIso8601String(),
      'updatedAt': updatedAt.toIso8601String(),
    };
  }

  bool get isActive => status == EntitlementStatus.active;
  bool get isTrial => status == EntitlementStatus.trial;
  bool get isSuspended => status == EntitlementStatus.suspended;
  bool get isExpired => status == EntitlementStatus.expired;
  bool get isCancelled => status == EntitlementStatus.cancelled;

  bool get isExpiringSoon {
    if (expiresAt == null) return false;
    final daysUntilExpiry = expiresAt!.difference(DateTime.now()).inDays;
    return daysUntilExpiry <= 7 && daysUntilExpiry > 0;
  }

  int? get daysUntilExpiry {
    if (expiresAt == null) return null;
    return expiresAt!.difference(DateTime.now()).inDays;
  }

  EntitlementFeature? getFeature(String key) {
    return features.where((f) => f.key == key).firstOrNull;
  }

  bool hasFeature(String key) {
    final feature = getFeature(key);
    return feature?.enabled ?? false;
  }

  EntitlementLimit? getLimit(String key) {
    return limits.where((l) => l.key == key).firstOrNull;
  }

  bool canPerformAction(String limitKey) {
    final limit = getLimit(limitKey);
    if (limit == null) return true;
    if (limit.isUnlimited) return true;
    return !limit.isOverLimit;
  }
}
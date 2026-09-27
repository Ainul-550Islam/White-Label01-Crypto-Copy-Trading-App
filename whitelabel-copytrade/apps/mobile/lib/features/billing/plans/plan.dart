/// Plan Model
/// 
/// Represents a billing plan in the mobile application.

enum PlanTier {
  free,
  basic,
  standard,
  premium,
  enterprise,
}

enum PlanStatus {
  active,
  inactive,
  deprecated,
  archived,
}

enum BillingInterval {
  monthly,
  quarterly,
  annual,
  lifetime,
}

class PlanPrice {
  final double amount;
  final String currency;
  final BillingInterval interval;
  final int? trialDays;

  const PlanPrice({
    required this.amount,
    this.currency = 'USD',
    required this.interval,
    this.trialDays,
  });

  factory PlanPrice.fromJson(Map<String, dynamic> json) {
    return PlanPrice(
      amount: (json['amount'] as num).toDouble(),
      currency: json['currency'] as String? ?? 'USD',
      interval: BillingInterval.values.firstWhere(
        (e) => e.name == json['interval'],
        orElse: () => BillingInterval.monthly,
      ),
      trialDays: json['trialDays'] as int?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'amount': amount,
      'currency': currency,
      'interval': interval.name,
      if (trialDays != null) 'trialDays': trialDays,
    };
  }

  String get formatted {
    if (amount == 0) return 'Free';
    final formatter = '\$${amount.toStringAsFixed(2)}';
    switch (interval) {
      case BillingInterval.monthly:
        return '$formatter/mo';
      case BillingInterval.quarterly:
        return '$formatter/qtr';
      case BillingInterval.annual:
        return '$formatter/yr';
      case BillingInterval.lifetime:
        return '$formatter one-time';
    }
  }

  double get annualSavings {
    if (interval != BillingInterval.monthly) return 0;
    final annualPrice = amount * 10;
    return amount * 12 - annualPrice;
  }

  int get annualSavingsPercentage {
    if (interval != BillingInterval.monthly) return 0;
    final savings = annualSavings;
    return ((savings / (amount * 12)) * 100).round();
  }
}

class PlanFeature {
  final String key;
  final String name;
  final String description;
  final bool enabled;
  final int? limit;
  final String? unit;

  const PlanFeature({
    required this.key,
    required this.name,
    required this.description,
    this.enabled = true,
    this.limit,
    this.unit,
  });

  factory PlanFeature.fromJson(Map<String, dynamic> json) {
    return PlanFeature(
      key: json['key'] as String,
      name: json['name'] as String,
      description: json['description'] as String? ?? '',
      enabled: json['enabled'] as bool? ?? true,
      limit: json['limit'] as int?,
      unit: json['unit'] as String?,
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
    };
  }

  String get displayValue {
    if (!enabled) return 'Disabled';
    if (limit != null) {
      return '$limit ${unit ?? ''}'.trim();
    }
    return 'Enabled';
  }
}

class PlanLimit {
  final String key;
  final String name;
  final String description;
  final int value;
  final String unit;
  final bool hardLimit;

  const PlanLimit({
    required this.key,
    required this.name,
    required this.description,
    required this.value,
    required this.unit,
    this.hardLimit = true,
  });

  factory PlanLimit.fromJson(Map<String, dynamic> json) {
    return PlanLimit(
      key: json['key'] as String,
      name: json['name'] as String,
      description: json['description'] as String? ?? '',
      value: json['value'] as int,
      unit: json['unit'] as String,
      hardLimit: json['hardLimit'] as bool? ?? true,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'key': key,
      'name': name,
      'description': description,
      'value': value,
      'unit': unit,
      'hardLimit': hardLimit,
    };
  }

  bool get isUnlimited => value == -1;

  String get displayValue {
    if (isUnlimited) return 'Unlimited';
    return '$value $unit';
  }
}

class Plan {
  final String id;
  final String tenantId;
  final String name;
  final String slug;
  final String description;
  final PlanTier tier;
  final PlanStatus status;
  final PlanPrice price;
  final List<PlanFeature> features;
  final List<PlanLimit> limits;
  final Map<String, String> metadata;
  final DateTime createdAt;
  final DateTime updatedAt;

  const Plan({
    required this.id,
    required this.tenantId,
    required this.name,
    required this.slug,
    required this.description,
    required this.tier,
    required this.status,
    required this.price,
    required this.features,
    required this.limits,
    this.metadata = const {},
    required this.createdAt,
    required this.updatedAt,
  });

  factory Plan.fromJson(Map<String, dynamic> json) {
    return Plan(
      id: json['id'] as String,
      tenantId: json['tenantId'] as String,
      name: json['name'] as String,
      slug: json['slug'] as String,
      description: json['description'] as String? ?? '',
      tier: PlanTier.values.firstWhere(
        (e) => e.name == json['tier'],
        orElse: () => PlanTier.free,
      ),
      status: PlanStatus.values.firstWhere(
        (e) => e.name == json['status'],
        orElse: () => PlanStatus.active,
      ),
      price: PlanPrice.fromJson(json['price'] as Map<String, dynamic>),
      features: (json['features'] as List<dynamic>?)
              ?.map((e) => PlanFeature.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
      limits: (json['limits'] as List<dynamic>?)
              ?.map((e) => PlanLimit.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
      metadata: Map<String, String>.from(json['metadata'] as Map? ?? {}),
      createdAt: DateTime.parse(json['createdAt'] as String),
      updatedAt: DateTime.parse(json['updatedAt'] as String),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'tenantId': tenantId,
      'name': name,
      'slug': slug,
      'description': description,
      'tier': tier.name,
      'status': status.name,
      'price': price.toJson(),
      'features': features.map((e) => e.toJson()).toList(),
      'limits': limits.map((e) => e.toJson()).toList(),
      'metadata': metadata,
      'createdAt': createdAt.toIso8601String(),
      'updatedAt': updatedAt.toIso8601String(),
    };
  }

  bool get isActive => status == PlanStatus.active;
  bool get isFree => price.amount == 0;
  bool get isTrial => price.trialDays != null && price.trialDays! > 0;

  PlanFeature? getFeature(String key) {
    return features.where((f) => f.key == key).firstOrNull;
  }

  bool hasFeature(String key) {
    final feature = getFeature(key);
    return feature?.enabled ?? false;
  }

  PlanLimit? getLimit(String key) {
    return limits.where((l) => l.key == key).firstOrNull;
  }

  int? getLimitValue(String key) {
    return getLimit(key)?.value;
  }

  bool get isUnlimited => tier == PlanTier.enterprise;
}
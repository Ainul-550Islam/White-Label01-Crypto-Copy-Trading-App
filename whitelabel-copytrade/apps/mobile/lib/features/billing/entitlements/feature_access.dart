/// Feature Access
/// 
/// Utility class for checking feature access and limits.

import 'entitlement.dart';

class FeatureAccessResult {
  final bool allowed;
  final String? reason;
  final int? remaining;
  final int? limit;

  const FeatureAccessResult({
    required this.allowed,
    this.reason,
    this.remaining,
    this.limit,
  });

  factory FeatureAccessResult.allowed({int? remaining, int? limit}) {
    return FeatureAccessResult(
      allowed: true,
      remaining: remaining,
      limit: limit,
    );
  }

  factory FeatureAccessResult.denied(String reason) {
    return FeatureAccessResult(
      allowed: false,
      reason: reason,
    );
  }
}

class FeatureAccess {
  final Entitlement? _entitlement;

  FeatureAccess(this._entitlement);

  /// Check if user has access to a specific feature
  FeatureAccessResult checkFeatureAccess(String featureKey) {
    if (_entitlement == null) {
      return FeatureAccessResult.denied('No active entitlement');
    }

    if (!_entitlement!.isActive && !_entitlement!.isTrial) {
      return FeatureAccessResult.denied('Entitlement is not active');
    }

    final feature = _entitlement!.getFeature(featureKey);
    if (feature == null) {
      return FeatureAccessResult.denied('Feature not available in your plan');
    }

    if (!feature.enabled) {
      return FeatureAccessResult.denied('Feature is disabled');
    }

    return FeatureAccessResult.allowed();
  }

  /// Check if user can perform an action based on limits
  FeatureAccessResult checkLimit(String limitKey) {
    if (_entitlement == null) {
      return FeatureAccessResult.denied('No active entitlement');
    }

    if (!_entitlement!.isActive && !_entitlement!.isTrial) {
      return FeatureAccessResult.denied('Entitlement is not active');
    }

    final limit = _entitlement!.getLimit(limitKey);
    if (limit == null) {
      return FeatureAccessResult.allowed();
    }

    if (limit.isUnlimited) {
      return FeatureAccessResult.allowed(remaining: -1, limit: -1);
    }

    if (limit.isOverLimit) {
      return FeatureAccessResult.denied(
        'Usage limit exceeded: ${limit.usageDisplay}',
      );
    }

    return FeatureAccessResult.allowed(
      remaining: limit.remaining,
      limit: limit.value,
    );
  }

  /// Check if user has access to multiple features
  Map<String, FeatureAccessResult> checkMultipleFeatures(List<String> featureKeys) {
    return {
      for (final key in featureKeys) key: checkFeatureAccess(key),
    };
  }

  /// Check if user has access to any of the given features
  FeatureAccessResult checkAnyFeature(List<String> featureKeys) {
    for (final key in featureKeys) {
      final result = checkFeatureAccess(key);
      if (result.allowed) return result;
    }
    return FeatureAccessResult.denied('None of the required features are available');
  }

  /// Check if user has access to all of the given features
  FeatureAccessResult checkAllFeatures(List<String> featureKeys) {
    for (final key in featureKeys) {
      final result = checkFeatureAccess(key);
      if (!result.allowed) return result;
    }
    return FeatureAccessResult.allowed();
  }

  /// Get all available features
  List<String> getAvailableFeatures() {
    if (_entitlement == null) return [];
    return _entitlement!.features
        .where((f) => f.enabled)
        .map((f) => f.key)
        .toList();
  }

  /// Get all limits with their current usage
  Map<String, Map<String, dynamic>> getLimitStatus() {
    if (_entitlement == null) return {};
    return {
      for (final limit in _entitlement!.limits)
        limit.key: {
          'name': limit.name,
          'value': limit.value,
          'usage': limit.usage,
          'remaining': limit.remaining,
          'usagePercentage': limit.usagePercentage,
          'isUnlimited': limit.isUnlimited,
          'isNearLimit': limit.isNearLimit,
          'isAtLimit': limit.isAtLimit,
          'isOverLimit': limit.isOverLimit,
        },
    };
  }

  /// Get features that are near their limits
  List<EntitlementLimit> getNearLimitFeatures() {
    if (_entitlement == null) return [];
    return _entitlement!.limits.where((l) => l.isNearLimit).toList();
  }

  /// Get features that have exceeded their limits
  List<EntitlementLimit> getExceededFeatures() {
    if (_entitlement == null) return [];
    return _entitlement!.limits.where((l) => l.isOverLimit).toList();
  }

  /// Check if user can upgrade their plan
  bool canUpgrade() {
    if (_entitlement == null) return true;
    return _entitlement!.planTier != 'enterprise';
  }

  /// Check if user can downgrade their plan
  bool canDowngrade() {
    if (_entitlement == null) return false;
    return _entitlement!.planTier != 'free';
  }

  /// Get upgrade suggestions based on usage
  List<String> getUpgradeSuggestions() {
    if (_entitlement == null) return [];

    final suggestions = <String>[];
    final nearLimit = getNearLimitFeatures();
    final exceeded = getExceededFeatures();

    if (exceeded.isNotEmpty) {
      suggestions.add(
        'You have ${exceeded.length} limit(s) exceeded. Consider upgrading.',
      );
    }

    if (nearLimit.isNotEmpty) {
      suggestions.add(
        '${nearLimit.length} limit(s) are near their maximum.',
      );
    }

    return suggestions;
  }
}
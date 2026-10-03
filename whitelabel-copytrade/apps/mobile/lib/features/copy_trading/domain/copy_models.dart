import 'package:equatable/equatable.dart';

import '../../../core/network/json_read.dart';

/// Sizing modes the API accepts (CopySizingMode).
class CopySizingModes {
  const CopySizingModes._();

  static const List<String> all = <String>['PROPORTIONAL', 'FIXED', 'PERCENTAGE_BALANCE'];
}

/// Decimal strings only - the API refuses floats for money.
final RegExp decimalPattern = RegExp(r'^\d+(\.\d+)?$');

class RankedTrader extends Equatable {
  const RankedTrader({
    required this.traderId,
    required this.displayName,
    required this.verificationState,
    required this.followerCount,
    required this.score,
    required this.rank,
    this.realizedPnl,
    this.winRate,
    this.maxDrawdown,
    this.isFeatured = false,
  });

  factory RankedTrader.fromJson(Map<String, Object?> json) {
    final Map<String, Object?> perf = JsonRead.map(json['performance']);
    final Object? score = json['score'];
    return RankedTrader(
      traderId: JsonRead.strOr(json, 'traderId', ''),
      displayName: JsonRead.strOr(json, 'displayName', '—'),
      verificationState: JsonRead.strOr(json, 'verificationState', 'UNVERIFIED'),
      followerCount: JsonRead.integer(json, 'followerCount'),
      score: score is num ? score.toDouble() : double.tryParse(score?.toString() ?? '') ?? 0,
      rank: JsonRead.integer(json, 'rank'),
      realizedPnl: JsonRead.str(perf, 'realizedPnl'),
      winRate: JsonRead.str(perf, 'winRate'),
      maxDrawdown: JsonRead.str(perf, 'maxDrawdown'),
      isFeatured: JsonRead.boolean(json, 'isFeatured'),
    );
  }

  final String traderId;
  final String displayName;
  final String verificationState;
  final int followerCount;
  final double score;
  final int rank;

  /// Decimal strings exactly as the API computed them; null = not measured.
  final String? realizedPnl;
  final String? winRate;
  final String? maxDrawdown;
  final bool isFeatured;

  bool get isVerified => verificationState == 'VERIFIED';

  @override
  List<Object?> get props => <Object?>[traderId, displayName, verificationState, followerCount, score, rank, realizedPnl, winRate, maxDrawdown, isFeatured];
}

class TraderStrategySummary extends Equatable {
  const TraderStrategySummary({required this.id, required this.name, required this.status, this.description});

  factory TraderStrategySummary.fromJson(Map<String, Object?> json) => TraderStrategySummary(
        id: JsonRead.strOr(json, 'id', ''),
        name: JsonRead.strOr(json, 'name', '—'),
        status: JsonRead.strOr(json, 'status', 'UNKNOWN'),
        description: JsonRead.str(json, 'description'),
      );

  final String id;
  final String name;
  final String status;
  final String? description;

  bool get isCopyable => status == 'PUBLISHED';

  @override
  List<Object?> get props => <Object?>[id, name, status, description];
}

class CopySubscriptionSummary extends Equatable {
  const CopySubscriptionSummary({
    required this.id,
    required this.traderId,
    required this.strategyId,
    required this.state,
    required this.allocationMode,
    required this.allocationAmount,
    required this.totalCopies,
    required this.failedCopies,
    this.followerAccountId,
    this.startedAt,
  });

  factory CopySubscriptionSummary.fromJson(Map<String, Object?> json) => CopySubscriptionSummary(
        id: JsonRead.strOr(json, 'id', ''),
        traderId: JsonRead.strOr(json, 'traderId', ''),
        strategyId: JsonRead.strOr(json, 'strategyId', ''),
        state: JsonRead.strOr(json, 'state', 'UNKNOWN'),
        allocationMode: JsonRead.strOr(json, 'allocationMode', 'PROPORTIONAL'),
        allocationAmount: JsonRead.strOr(json, 'allocationAmount', '0'),
        totalCopies: JsonRead.integer(json, 'totalCopies'),
        failedCopies: JsonRead.integer(json, 'failedCopies'),
        followerAccountId: JsonRead.str(json, 'followerAccountId'),
        startedAt: JsonRead.date(json, 'startedAt'),
      );

  final String id;
  final String traderId;
  final String strategyId;
  final String state;
  final String allocationMode;
  final String allocationAmount;
  final int totalCopies;
  final int failedCopies;
  final String? followerAccountId;
  final DateTime? startedAt;

  bool get canPause => state == 'ACTIVE';
  bool get canResume => state == 'PAUSED';
  bool get canStop => state == 'ACTIVE' || state == 'PAUSED' || state == 'PENDING';

  @override
  List<Object?> get props => <Object?>[id, traderId, strategyId, state, allocationMode, allocationAmount, totalCopies, failedCopies, followerAccountId, startedAt];
}

class CopyExecutionSummary extends Equatable {
  const CopyExecutionSummary({
    required this.id,
    required this.status,
    required this.leaderQuantity,
    this.followerQuantity,
    this.followerPrice,
    this.failureReason,
    this.createdAt,
    this.symbol,
    this.side,
  });

  factory CopyExecutionSummary.fromJson(Map<String, Object?> json) {
    final Map<String, Object?> intent = JsonRead.map(json['executionIntent']);
    return CopyExecutionSummary(
      id: JsonRead.strOr(json, 'id', ''),
      status: JsonRead.strOr(json, 'status', 'UNKNOWN'),
      leaderQuantity: JsonRead.strOr(json, 'leaderQuantity', '0'),
      followerQuantity: JsonRead.str(json, 'followerQuantity'),
      followerPrice: JsonRead.str(json, 'followerPrice'),
      failureReason: JsonRead.str(json, 'failureReason'),
      createdAt: JsonRead.date(json, 'createdAt'),
      symbol: JsonRead.str(intent, 'symbol'),
      side: JsonRead.str(intent, 'side'),
    );
  }

  final String id;
  final String status;
  final String leaderQuantity;
  final String? followerQuantity;
  final String? followerPrice;
  final String? failureReason;
  final DateTime? createdAt;
  final String? symbol;
  final String? side;

  bool get isFailure => status == 'FAILED' || status == 'REJECTED' || status == 'BLOCKED';

  @override
  List<Object?> get props => <Object?>[id, status, leaderQuantity, followerQuantity, followerPrice, failureReason, createdAt, symbol, side];
}

/// The subscribe form. Validation mirrors the API DTO so the user sees the
/// problem before a round trip; the API validates again regardless.
class SubscribeRequest {
  const SubscribeRequest({
    required this.traderId,
    required this.strategyId,
    required this.allocationMode,
    required this.allocationAmount,
    required this.followerAccountId,
    required this.idempotencyKey,
    this.maxAllocation,
  });

  final String traderId;
  final String strategyId;
  final String allocationMode;
  final String allocationAmount;
  final String followerAccountId;
  final String idempotencyKey;
  final String? maxAllocation;

  /// Null when valid, otherwise the first problem.
  String? validate() {
    if (!CopySizingModes.all.contains(allocationMode)) {
      return 'Unsupported allocation mode';
    }
    if (!decimalPattern.hasMatch(allocationAmount) || double.parse(allocationAmount) <= 0) {
      return 'Allocation must be a positive decimal number';
    }
    if (allocationMode == 'PERCENTAGE_BALANCE' && double.parse(allocationAmount) > 100) {
      return 'A balance percentage cannot exceed 100';
    }
    if (maxAllocation != null && maxAllocation!.isNotEmpty && !decimalPattern.hasMatch(maxAllocation!)) {
      return 'Maximum allocation must be a decimal number';
    }
    if (followerAccountId.isEmpty) {
      return 'Choose the exchange account that will copy';
    }
    return null;
  }

  Map<String, Object?> toJson() => <String, Object?>{
        'traderId': traderId,
        'strategyId': strategyId,
        'allocationMode': allocationMode,
        'allocationAmount': allocationAmount,
        if (maxAllocation != null && maxAllocation!.isNotEmpty) 'maxAllocation': maxAllocation,
        'followerAccountId': followerAccountId,
        'idempotencyKey': idempotencyKey,
      };
}

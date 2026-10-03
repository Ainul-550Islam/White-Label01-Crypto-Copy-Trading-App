import 'package:equatable/equatable.dart';

import '../../../core/network/json_read.dart';

class AppNotification extends Equatable {
  const AppNotification({
    required this.id,
    required this.type,
    required this.title,
    required this.body,
    required this.channel,
    this.readAt,
    this.createdAt,
  });

  factory AppNotification.fromJson(Map<String, Object?> json) => AppNotification(
        id: JsonRead.strOr(json, 'id', ''),
        type: JsonRead.strOr(json, 'type', ''),
        title: JsonRead.strOr(json, 'title', ''),
        body: JsonRead.strOr(json, 'body', ''),
        channel: JsonRead.strOr(json, 'channel', 'IN_APP'),
        readAt: JsonRead.date(json, 'readAt'),
        createdAt: JsonRead.date(json, 'createdAt'),
      );

  final String id;
  final String type;
  final String title;
  final String body;
  final String channel;
  final DateTime? readAt;
  final DateTime? createdAt;

  bool get isRead => readAt != null;

  AppNotification markedRead(DateTime at) => AppNotification(id: id, type: type, title: title, body: body, channel: channel, readAt: at, createdAt: createdAt);

  @override
  List<Object?> get props => <Object?>[id, type, title, body, channel, readAt, createdAt];
}

class NotificationPreference extends Equatable {
  const NotificationPreference({required this.category, required this.channel, required this.enabled});

  factory NotificationPreference.fromJson(Map<String, Object?> json) => NotificationPreference(
        category: JsonRead.strOr(json, 'category', ''),
        channel: JsonRead.strOr(json, 'channel', ''),
        enabled: JsonRead.boolean(json, 'enabled'),
      );

  final String category;
  final String channel;
  final bool enabled;

  NotificationPreference withEnabled(bool value) => NotificationPreference(category: category, channel: channel, enabled: value);

  Map<String, Object?> toJson() => <String, Object?>{'category': category, 'channel': channel, 'enabled': enabled};

  @override
  List<Object?> get props => <Object?>[category, channel, enabled];
}

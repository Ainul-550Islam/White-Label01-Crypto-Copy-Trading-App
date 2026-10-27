import 'package:flutter/services.dart';

/// This is the operating-system permission, not a delivery guarantee.
enum DeviceNotificationPermission {
  undetermined,
  authorized,
  limited,
  denied,
  unavailable;

  static DeviceNotificationPermission fromPlatformValue(Object? value) {
    return switch (value) {
      'undetermined' => DeviceNotificationPermission.undetermined,
      'authorized' => DeviceNotificationPermission.authorized,
      'limited' => DeviceNotificationPermission.limited,
      'denied' => DeviceNotificationPermission.denied,
      _ => DeviceNotificationPermission.unavailable,
    };
  }
}

class DeviceNotificationPermissions {
  const DeviceNotificationPermissions();

  static const MethodChannel _channel =
      MethodChannel('com.whitelabel.mobile/notification_permission');

  Future<DeviceNotificationPermission> status() => _statusCall('status');

  Future<DeviceNotificationPermission> request() => _statusCall('request');

  Future<DeviceNotificationPermission> _statusCall(String method) async {
    try {
      return DeviceNotificationPermission.fromPlatformValue(
        await _channel.invokeMethod<Object?>(method),
      );
    } on PlatformException {
      return DeviceNotificationPermission.unavailable;
    } on MissingPluginException {
      return DeviceNotificationPermission.unavailable;
    }
  }

  /// Provider tokens stay in memory and are sent only to the authenticated API.
  Future<String?> pushToken() async {
    try {
      final String? token = await _channel
          .invokeMethod<String>('pushToken')
          .timeout(const Duration(seconds: 15));
      return token != null && token.isNotEmpty ? token : null;
    } catch (_) {
      return null;
    }
  }

  Future<bool> openSettings() async {
    try {
      return await _channel.invokeMethod<bool>('openSettings') ?? false;
    } on PlatformException {
      return false;
    } on MissingPluginException {
      return false;
    }
  }
}

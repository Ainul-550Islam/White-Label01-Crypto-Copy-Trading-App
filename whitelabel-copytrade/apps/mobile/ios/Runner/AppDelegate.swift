import Flutter
import UIKit
import UserNotifications

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private var pendingPushToken: FlutterResult?
  private var pendingPushTimeout: DispatchWorkItem?
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    let channel = FlutterMethodChannel(
      name: "com.whitelabel.mobile/notification_permission",
      binaryMessenger: engineBridge.applicationRegistrar.messenger()
    )
    channel.setMethodCallHandler { call, result in
      switch call.method {
      case "status":
        self.notificationStatus(result)
      case "request":
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { _, error in
          if error != nil {
            DispatchQueue.main.async {
              result(FlutterError(code: "permission_unavailable", message: "Permission could not be requested.", details: nil))
            }
          } else {
            self.notificationStatus(result)
          }
        }
      case "pushToken":
        UNUserNotificationCenter.current().getNotificationSettings { settings in
          DispatchQueue.main.async {
            guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional || settings.authorizationStatus == .ephemeral else {
              result(FlutterError(code: "push_unavailable", message: "Push registration is unavailable.", details: nil)); return
            }
            guard self.pendingPushToken == nil else {
              result(FlutterError(code: "request_in_progress", message: "Registration is already in progress.", details: nil)); return
            }
            self.pendingPushToken = result
            // APNs may never call either delegate method. Clear the native
            // request before Dart's timeout so a later retry is not blocked.
            let timeout = DispatchWorkItem { [weak self] in
              guard let self = self, let pending = self.pendingPushToken else { return }
              self.pendingPushToken = nil
              self.pendingPushTimeout = nil
              pending(FlutterError(code: "push_unavailable", message: "Push registration is unavailable.", details: nil))
            }
            self.pendingPushTimeout = timeout
            DispatchQueue.main.asyncAfter(deadline: .now() + 14, execute: timeout)
            UIApplication.shared.registerForRemoteNotifications()
          }
        }
      case "openSettings":
        DispatchQueue.main.async {
          guard let url = URL(string: UIApplication.openSettingsURLString), UIApplication.shared.canOpenURL(url) else {
            result(FlutterError(code: "settings_unavailable", message: "Device settings could not be opened.", details: nil))
            return
          }
          UIApplication.shared.open(url, options: [:]) { opened in
            result(opened)
          }
        }
      default:
        result(FlutterMethodNotImplemented)
      }
    }
  }

  override func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    let token = deviceToken.map { String(format: "%02x", $0) }.joined()
    pendingPushTimeout?.cancel(); pendingPushTimeout = nil
    let result = pendingPushToken; pendingPushToken = nil
    result?(token)
  }

  override func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    pendingPushTimeout?.cancel(); pendingPushTimeout = nil
    let result = pendingPushToken; pendingPushToken = nil
    result?(FlutterError(code: "push_unavailable", message: "Push registration is unavailable.", details: nil))
  }

  private func notificationStatus(_ result: @escaping FlutterResult) {
    UNUserNotificationCenter.current().getNotificationSettings { settings in
      let status: String
      switch settings.authorizationStatus {
      case .notDetermined: status = "undetermined"
      case .denied: status = "denied"
      case .authorized: status = "authorized"
      case .provisional, .ephemeral: status = "limited"
      @unknown default: status = "unavailable"
      }
      DispatchQueue.main.async { result(status) }
    }
  }
}

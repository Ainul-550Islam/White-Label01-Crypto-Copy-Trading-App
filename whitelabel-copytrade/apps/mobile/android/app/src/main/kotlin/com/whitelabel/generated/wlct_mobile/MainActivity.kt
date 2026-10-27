package com.whitelabel.generated.wlct_mobile

import android.Manifest
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

/** Separates operating-system permission from provider-token registration. */
class MainActivity : FlutterActivity() {
    private val channelName = "com.whitelabel.mobile/notification_permission"
    private val requestCode = 8137
    private var pendingResult: MethodChannel.Result? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, channelName)
            .setMethodCallHandler { call: MethodCall, result: MethodChannel.Result ->
                when (call.method) {
                    "status" -> result.success(permissionStatus())
                    "request" -> requestNotificationPermission(result)
                    "openSettings" -> openNotificationSettings(result)
                    "pushToken" -> {
                        if (permissionStatus() != "authorized" || FirebaseApp.getApps(this).isEmpty()) {
                            result.error("push_unavailable", "Push registration is unavailable.", null)
                        } else {
                            FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                                val token = if (task.isSuccessful) task.result else null
                                if (token.isNullOrBlank()) result.error("push_unavailable", "Push registration is unavailable.", null)
                                else result.success(token)
                            }
                        }
                    }
                    else -> result.notImplemented()
                }
            }
    }

    private fun permissionStatus(): String {
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
            if (granted && manager.areNotificationsEnabled()) return "authorized"
            val requested = getPreferences(MODE_PRIVATE).getBoolean("notification_permission_requested", false)
            return if (requested || granted) "denied" else "undetermined"
        }
        return if (manager.areNotificationsEnabled()) "authorized" else "denied"
    }

    private fun requestNotificationPermission(result: MethodChannel.Result) {
        if (pendingResult != null) {
            result.error("request_in_progress", "A permission request is already in progress.", null)
            return
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || permissionStatus() == "authorized") {
            result.success(permissionStatus())
            return
        }
        // Once denied, use the device settings rather than repeatedly prompting.
        if (permissionStatus() == "denied") {
            result.success("denied")
            return
        }
        getPreferences(MODE_PRIVATE).edit().putBoolean("notification_permission_requested", true).apply()
        pendingResult = result
        requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), requestCode)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == this.requestCode) {
            val result = pendingResult
            pendingResult = null
            result?.success(permissionStatus())
        }
    }

    private fun openNotificationSettings(result: MethodChannel.Result) {
        try {
            val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
            } else {
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))
            }
            startActivity(intent)
            result.success(true)
        } catch (_: Exception) {
            result.error("settings_unavailable", "Device settings could not be opened.", null)
        }
    }
}

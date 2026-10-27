package com.whitelabel.generated.wlct_mobile

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/** FCM handles background notification messages; foreground alerts are shown here. */
class PushMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val notification = message.notification ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val manager = getSystemService(NotificationManager::class.java)
        val channel = "account_activity"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(NotificationChannel(channel, "Account activity", NotificationManager.IMPORTANCE_DEFAULT))
        }
        val launch = packageManager.getLaunchIntentForPackage(packageName) ?: Intent(this, MainActivity::class.java)
        val pending = PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) android.app.Notification.Builder(this, channel) else android.app.Notification.Builder(this)
        manager.notify(System.currentTimeMillis().toInt(), builder.setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(notification.title ?: "Account activity").setContentText(notification.body ?: "Open the app to review your notification.")
            .setAutoCancel(true).setContentIntent(pending).build())
    }
    // The Flutter client asks the SDK for the latest token at the next foreground registration.
}

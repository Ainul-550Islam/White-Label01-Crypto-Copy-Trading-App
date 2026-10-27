package com.whitelabel.generated.wlct_mobile

import io.flutter.app.FlutterApplication
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions

/** Initialises FCM from public, per-brand build settings, not a server key. */
class PushApplication : FlutterApplication() {
    override fun onCreate() {
        super.onCreate()
        val appId = getString(R.string.wlct_firebase_app_id)
        val projectId = getString(R.string.wlct_firebase_project_id)
        val apiKey = getString(R.string.wlct_firebase_api_key)
        if (appId.isNotBlank() && projectId.isNotBlank() && apiKey.isNotBlank() && FirebaseApp.getApps(this).isEmpty()) {
            try {
                FirebaseApp.initializeApp(this, FirebaseOptions.Builder().setApplicationId(appId).setProjectId(projectId).setApiKey(apiKey).build())
            } catch (_: IllegalArgumentException) {
                // Registration reports unavailable; do not report a token or delivery.
            }
        }
    }
}

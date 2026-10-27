plugins {
    id("com.android.application")
    id("dev.flutter.flutter-gradle-plugin")
}

val releaseRequested = gradle.startParameter.taskNames.any {
    it.contains("release", ignoreCase = true)
}
val configuredApplicationId = providers.gradleProperty("wlctApplicationId")
    .orElse(providers.environmentVariable("WLCT_ANDROID_APPLICATION_ID")).orNull
val configuredDisplayName = providers.gradleProperty("wlctAppDisplayName")
    .orElse(providers.environmentVariable("WLCT_APP_DISPLAY_NAME")).orNull
val applicationIdPattern = Regex("^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*){1,6}$")
if (configuredApplicationId != null &&
    (!applicationIdPattern.matches(configuredApplicationId) || configuredApplicationId.length > 120)) {
    throw GradleException("WLCT_ANDROID_APPLICATION_ID is invalid")
}
if (releaseRequested && configuredApplicationId == null) {
    throw GradleException("A tenant application ID is required for release builds")
}

val keyStorePath = providers.environmentVariable("WLCT_ANDROID_KEYSTORE_PATH").orNull
val keyStorePassword = providers.environmentVariable("WLCT_ANDROID_KEYSTORE_PASSWORD").orNull
val configuredKeyAlias = providers.environmentVariable("WLCT_ANDROID_KEY_ALIAS").orNull
val configuredKeyPassword = providers.environmentVariable("WLCT_ANDROID_KEY_PASSWORD").orNull
val signingValues = listOf(keyStorePath, keyStorePassword, configuredKeyAlias, configuredKeyPassword)
if (releaseRequested && (signingValues.any { it.isNullOrBlank() } || !file(keyStorePath!!).isFile)) {
    throw GradleException("Release signing requires a configured keystore, alias and passwords")
}

android {
    namespace = "com.whitelabel.generated.wlct_mobile"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = configuredApplicationId ?: "com.whitelabel.generated.mobile"
        manifestPlaceholders["appDisplayName"] = configuredDisplayName ?: "Copy Trading"
        resValue("string", "wlct_firebase_app_id", providers.environmentVariable("WLCT_FIREBASE_APP_ID").orElse("").get())
        resValue("string", "wlct_firebase_project_id", providers.environmentVariable("WLCT_FIREBASE_PROJECT_ID").orElse("").get())
        resValue("string", "wlct_firebase_api_key", providers.environmentVariable("WLCT_FIREBASE_API_KEY").orElse("").get())
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }
    signingConfigs {
        if (signingValues.none { it.isNullOrBlank() }) {
            create("tenantRelease") {
                storeFile = file(keyStorePath!!)
                storePassword = keyStorePassword
                keyAlias = configuredKeyAlias
                keyPassword = configuredKeyPassword
            }
        }
    }
    buildTypes {
        release {
            signingConfig = signingConfigs.findByName("tenantRelease")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter { source = "../.." }

// Firebase Messaging is used by the native Android host; no credentials are
// bundled. These public project identifiers are supplied per branded build.
dependencies { implementation("com.google.firebase:firebase-messaging:24.1.2") }

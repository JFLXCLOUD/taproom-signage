plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.taproom.signage"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.taproom.signage"

        // Fire OS 5 (older sticks) is API 22.
        minSdk = 22

        // Deliberately 28, not 34. Android 10 restricts starting an activity from
        // the background, which is exactly what the boot receiver does. Targeting
        // 28 keeps auto-start working on Fire OS. This app is sideloaded, so the
        // Play Store target-API rules do not apply.
        targetSdk = 28

        versionCode = 2
        versionName = "1.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

// No dependencies on purpose: plain android.app.Activity and android.webkit.WebView.
// Nothing from AndroidX, so the build has no resolution surprises on a fresh machine.
dependencies { }

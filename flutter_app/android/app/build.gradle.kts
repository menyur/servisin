import java.util.Properties

plugins {
    id("com.android.application")
    id("com.google.gms.google-services")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Signature release dibaca dari key.properties (di-gitignore) bila ada —
// diisi CI dari GitHub Secrets (ANDROID_KEYSTORE_BASE64 + ANDROID_KEYSTORE_PASSWORD)
// atau dibuat manual untuk build release lokal. Tanpa file itu build jatuh ke
// debug signing (HATI-HATI: debug key CI bisa berubah per build → tidak bisa
// install-over-install).
val keystoreProps = Properties()
val keystorePropsFile = rootProject.file("key.properties")
if (keystorePropsFile.exists()) {
    keystoreProps.load(keystorePropsFile.inputStream())
}

android {
    // `namespace` = paket kode Kotlin/Java + kelas R/BuildConfig (internal,
    // tidak dilihat Play). `applicationId` di bawah = identitas aplikasi di
    // perangkat DAN di Play Console. Keduanya SENGAJA SAMA (`id.fixify.app`)
    // supaya repo hanya punya satu nama paket: MainActivity ada di
    // `src/main/kotlin/id/fixify/app/`.
    //
    // Latar 18 Okt 2026: identitas Play harus pindah ke `id.fixify.app` karena
    // paket `com.fixify.app` sudah dipakai developer lain (otoritas penyedia
    // konten `…androidx-startup` / `…firebaseinitprovider` bentrok, dan Paket
    // Play unik global). Namespace ikut diselaraskan pada perubahan berikutnya.
    namespace = "id.fixify.app"
    // Pin 36: plugin (share_plus, app_links via supabase_flutter, dkk.)
    // mensyaratkan compileSdk 35–36 lewat AAR metadata —
    // flutter.compileSdkVersion bawaan ternyata lebih rendah.
    compileSdk = 36
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // Identitas Play: harus SAMA dengan paket aplikasi di Play Console dan
        // dengan `package_name` di google-services.json (dijaga
        // `npm run verify:apk-signin`). Jangan kembalikan ke `com.fixify.app`:
        // paket itu sudah terpakai developer lain di Play.
        applicationId = "id.fixify.app"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (keystorePropsFile.exists()) {
            create("release") {
                storeFile = file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
                storeType = "PKCS12"
            }
        }
    }

    buildTypes {
        release {
            signingConfig = if (keystorePropsFile.exists())
                signingConfigs.getByName("release")
            else
                signingConfigs.getByName("debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

dependencies {
    // Google Sign-In native (idToken untuk Supabase signInWithIdToken)
    implementation("com.google.android.gms:play-services-auth:21.2.0")
}

flutter {
    source = "../.."
}

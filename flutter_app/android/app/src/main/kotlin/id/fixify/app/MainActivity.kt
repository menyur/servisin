package id.fixify.app

import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInAccount
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.Scope
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * Jembatan Google Sign-In native untuk Flutter.
 *
 * Dart memanggil channel 'fixify/google_signin':
 *  - isAndroid          -> true
 *  - signInWithGoogle   -> {idToken, accessToken} via Google Identity Services
 *
 * idToken dipakai supabase_flutter.auth.signInWithIdToken(provider: google).
 *
 * WAJIB di sisi konfigurasi (dikerjakan saat build release):
 *  1. default_web_client_id di strings.xml = Web Client ID dari Google Cloud Console
 *     (OAuth 2.0 Client, type "Web application") yang juga diisi di
 *     Supabase Dashboard > Authentication > Providers > Google.
 *  2. SHA-1 debug & release terdaftar di Google Cloud Console untuk
 *     applicationId id.fixify.app.
 *
 * Paket kelas ini SENGAJA sama dengan `namespace`/`applicationId` di
 * build.gradle.kts (satu nama paket untuk seluruh repo).
 */
class MainActivity : FlutterActivity() {
    private val channelName = "fixify/google_signin"
    private val notificationChannel = "fixify/notifications"
    private val requestCode = 9017
    private var pending: MethodChannel.Result? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ensureNotificationChannel()
    }

    /**
     * Kanal "fixify_default" — id yang sama dengan channelId yang dikirim server
     * (src/lib/fcm.js) dan default_notification_channel_id di AndroidManifest.
     *
     * Tanpa kanal ini Android membuang notifikasi FCM ke
     * "fcm_fallback_notification_channel" ber-importance DEFAULT: suara keluar,
     * tetapi notifikasi chat TIDAK muncul sebagai heads-up (tidak melayang di
     * atas layar) dan pengguna tidak bisa mengatur kanalnya terpisah di setelan
     * OS. Didaftarkan sekali di awal; pemanggilan berikutnya hanya memperbarui.
     * Dijaga oleh npm run verify:fcm. API 26+ (NotificationChannel).
     */
    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val kanal = NotificationChannel(
            CHANNEL_ID,
            "Notifikasi Fixify",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Pesan chat, status pesanan, dan tawaran pekerjaan"
            enableVibration(true)
        }
        getSystemService(NotificationManager::class.java)?.createNotificationChannel(kanal)
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, channelName)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "isAndroid" -> result.success(true)
                    "signInWithGoogle" -> {
                        pending = result
                        launchGoogleSignIn()
                    }
                    else -> result.notImplemented()
                }
            }

        // Setelan notifikasi app. Android 13+ tidak menampilkan dialog izin
        // lagi setelah pengguna menolak; satu-satunya jalan adalah layar
        // setelan ini. Notifikasi yang mati di tingkat OS membuat FCM tetap
        // "terkirim" di server padahal tidak terlihat pengguna.
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, notificationChannel)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "openSettings" -> {
                        result.success(bukaSetelanNotifikasi())
                    }
                    else -> result.notImplemented()
                }
            }
    }

    private fun bukaSetelanNotifikasi(): Boolean {
        return try {
            val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
            } else {
                Intent(
                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:$packageName"),
                )
            }
            startActivity(intent)
            true
        } catch (e: Exception) {
            Log.e("NotifSettings", "gagal membuka setelan: ${e.message}")
            false
        }
    }

    private fun launchGoogleSignIn() {
        try {
            // Rujukan LANGSUNG ke R, bukan resources.getIdentifier(...):
            // getIdentifier bersifat refleksi sehingga resource-shrinker build
            // rilis menganggapnya tak terpakai dan MEMBUANG default_web_client_id
            // dari APK. Gejalanya "String resource ID #0x0" sebelum sempat
            // menghubungi Google, lalu app jatuh ke OAuth browser.
            val webClientId = getString(R.string.default_web_client_id)
            val gso = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                .requestIdToken(webClientId)
                .requestEmail()
                .requestProfile()
                .build()
            val client = GoogleSignIn.getClient(this, gso)
            startActivityForResult(client.signInIntent, requestCode)
        } catch (e: Exception) {
            Log.e("GoogleSignIn", "launch gagal: ${e.message}")
            pending?.error("SIGNIN_FAILED", e.message, null)
            pending = null
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != this.requestCode) return
        val result = pending
        pending = null
        if (result == null) return

        if (resultCode == Activity.RESULT_CANCELED) {
            result.error("SIGNIN_CANCELED", "Dibatalkan pengguna", null)
            return
        }
        try {
            val account: GoogleSignInAccount =
                GoogleSignIn.getSignedInAccountFromIntent(data).getResult(ApiException::class.java)
            val idToken = account.idToken
            val serverAuthCode = account.serverAuthCode
            if (idToken == null) {
                result.error("NO_ID_TOKEN", "idToken kosong", null)
                return
            }
            // accessToken dikirim bila tersedia (serverAuthCode flow); Supabase
            // menerima null accessToken bila hanya idToken yang ada.
            val args = mapOf(
                "idToken" to idToken,
                "accessToken" to serverAuthCode
            )
            result.success(args)
        } catch (e: ApiException) {
            result.error("SIGNIN_FAILED", "ApiException ${e.statusCode}", null)
        }
    }

    override fun onDestroy() {
        pending?.error("DISPOSED", "Activity dimusnahkan", null)
        pending = null
        super.onDestroy()
    }

    companion object {
        /** Harus sama dengan channelId di src/lib/fcm.js. */
        private const val CHANNEL_ID = "fixify_default"
    }
}

package com.fixify.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle
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
 *     applicationId com.fixify.app.
 */
class MainActivity : FlutterActivity() {
    private val channelName = "fixify/google_signin"
    private val requestCode = 9017
    private var pending: MethodChannel.Result? = null

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
    }

    private fun launchGoogleSignIn() {
        try {
            val webClientId = getString(
                resources.getIdentifier("default_web_client_id", "string", packageName)
            )
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
}

package com.taproom.signage

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Full-screen kiosk for a Fire TV Stick.
 *
 * Finds the server itself (see [Discovery]), remembers it, and keeps the board on
 * screen. Nothing here needs a keyboard or a pointer: the only interaction is the
 * MENU button, which opens the address/rediscover dialog.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private lateinit var status: TextView
    private val main = Handler(Looper.getMainLooper())

    private val prefs by lazy { getSharedPreferences(PREFS, Context.MODE_PRIVATE) }
    private var baseUrl: String? = null
    private var consecutiveFailures = 0
    private var searching = false
    private var connectionGeneration = 0
    private var manualAddress = false

    companion object {
        private const val PREFS = "taproom"
        private const val KEY_URL = "base_url"
        private const val KEY_MANUAL = "manual_address"
        private const val RETRY_MS = 5000L
        /** After this many failed loads, stop retrying the address and look again. */
        private const val REDISCOVER_AFTER = 3
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.addFlags(WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        goFullscreen()

        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }

        web = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            isFocusable = false            // the board is not interactive; swallow D-pad
            isFocusableInTouchMode = false
            configure(settings)
            webViewClient = Client()
        }
        root.addView(web, FrameLayout.LayoutParams(-1, -1))

        status = TextView(this).apply {
            setTextColor(Color.WHITE)
            textSize = 22f
            gravity = Gravity.CENTER
            setPadding(80, 80, 80, 80)
            setBackgroundColor(Color.BLACK)
        }
        root.addView(status, FrameLayout.LayoutParams(-1, -1))

        setContentView(root)

        baseUrl = prefs.getString(KEY_URL, null)
        manualAddress = prefs.getBoolean(KEY_MANUAL, false)
        connect()
    }

    private fun configure(s: WebSettings) {
        s.javaScriptEnabled = true
        // The board caches its last payload in localStorage so a server outage
        // leaves last night's menu on screen instead of a blank panel.
        s.domStorageEnabled = true
        s.loadsImagesAutomatically = true
        s.mediaPlaybackRequiresUserGesture = false
        s.cacheMode = WebSettings.LOAD_DEFAULT
        s.setSupportZoom(false)
        s.builtInZoomControls = false
        s.displayZoomControls = false
        s.useWideViewPort = true
        s.loadWithOverviewMode = true
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        }
    }

    // ------------------------------------------------------------- connecting

    private fun connect() {
        if (searching) return
        searching = true
        showStatus(getString(R.string.searching))

        val generation = connectionGeneration
        Discovery.resolve(baseUrl, manualAddress) { found ->
            main.post {
                if (generation != connectionGeneration || isFinishing) return@post
                searching = false
                if (found == null) {
                    showStatus(getString(R.string.not_found))
                    main.postDelayed({ if (generation == connectionGeneration) connect() }, 15000)
                } else {
                    if (found != baseUrl) {
                        baseUrl = found
                        prefs.edit().putString(KEY_URL, found).apply()
                    }
                    load()
                }
            }
        }
    }

    private fun load() {
        val url = baseUrl ?: return connect()
        Log.i("loading $url/display")
        web.loadUrl("$url/display")
    }

    private fun onLoadFailed(reason: String) {
        consecutiveFailures++
        showStatus(getString(R.string.cannot_reach, baseUrl ?: "?", reason))

        val generation = connectionGeneration
        if (consecutiveFailures >= REDISCOVER_AFTER && !manualAddress) {
            // The server has probably moved (new DHCP lease, different box).
            consecutiveFailures = 0
            baseUrl = null
            prefs.edit().remove(KEY_URL).apply()
            main.postDelayed({ if (generation == connectionGeneration) connect() }, 2000)
        } else {
            main.postDelayed({ if (generation == connectionGeneration) load() }, RETRY_MS)
        }
    }

    private inner class Client : WebViewClient() {
        override fun onPageFinished(view: WebView, url: String) {
            consecutiveFailures = 0
            hideStatus()
        }

        override fun onReceivedError(
            view: WebView, request: WebResourceRequest?, error: WebResourceError?
        ) {
            // Sub-resource failures are not worth a full reconnect.
            if (request != null && !request.isForMainFrame) return
            val reason = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && error != null) {
                error.description?.toString() ?: "error"
            } else {
                "error"
            }
            onLoadFailed(reason)
        }

        @Deprecated("Kept for Fire OS builds below API 23")
        override fun onReceivedError(
            view: WebView, errorCode: Int, description: String?, failingUrl: String?
        ) {
            if (failingUrl != null && baseUrl != null && !failingUrl.startsWith(baseUrl!!)) return
            onLoadFailed(description ?: "error")
        }
    }

    // ----------------------------------------------------------------- chrome

    private fun showStatus(text: String) {
        status.text = text
        status.visibility = View.VISIBLE
    }

    private fun hideStatus() {
        status.visibility = View.GONE
    }

    private fun goFullscreen() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            )
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) goFullscreen()
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        return when (keyCode) {
            KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_BUTTON_Y -> {
                showMenu(); true
            }
            // Never let BACK drop the viewer onto the Fire TV home screen.
            KeyEvent.KEYCODE_BACK -> true
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> {
                load(); true
            }
            else -> super.onKeyDown(keyCode, event)
        }
    }

    private fun showMenu() {
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.menu_title))
            .setMessage(getString(R.string.menu_current, baseUrl ?: getString(R.string.none)))
            .setPositiveButton(R.string.menu_search) { _, _ ->
                connectionGeneration++
                searching = false
                manualAddress = false
                baseUrl = null
                prefs.edit().remove(KEY_URL).putBoolean(KEY_MANUAL, false).apply()
                connect()
            }
            .setNeutralButton(R.string.menu_manual) { _, _ -> promptForAddress() }
            .setNegativeButton(R.string.menu_reload) { _, _ -> load() }
            .show()
    }

    private fun promptForAddress() {
        val input = EditText(this).apply {
            inputType = InputType.TYPE_TEXT_VARIATION_URI
            setText(baseUrl ?: "http://")
            setSelection(text.length)
        }
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 24, 48, 0)
            addView(input)
        }
        AlertDialog.Builder(this)
            .setTitle(R.string.manual_title)
            .setView(box)
            .setPositiveButton(R.string.save) { _, _ ->
                var entered = input.text.toString().trim().trimEnd('/')
                if (!entered.contains("://")) entered = "http://$entered"
                val uri = try { java.net.URI(entered) } catch (_: Exception) { null }
                if (uri != null && uri.scheme in listOf("http", "https") && !uri.host.isNullOrBlank() && uri.userInfo == null && uri.query == null && uri.fragment == null && (uri.path.isNullOrEmpty() || uri.path == "/") && (uri.port == -1 || uri.port in 1..65535)) {
                    connectionGeneration++
                    searching = false
                    manualAddress = true
                    consecutiveFailures = 0
                    baseUrl = entered
                    prefs.edit().putString(KEY_URL, entered).putBoolean(KEY_MANUAL, true).apply()
                    load()
                } else {
                    AlertDialog.Builder(this).setMessage(R.string.invalid_address).setPositiveButton(R.string.cancel, null).show()
                }
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    override fun onDestroy() {
        connectionGeneration++
        main.removeCallbacksAndMessages(null)
        web.destroy()
        super.onDestroy()
    }
}

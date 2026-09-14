package com.taproom.signage

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Brings the board back after a power cut — the usual way signage dies overnight.
 *
 * Fire OS emits BOOT_COMPLETED; the QUICKBOOT actions cover sticks that resume
 * rather than cold boot. Starting an activity from a receiver is restricted on
 * Android 10+, which is why the app targets SDK 28 (see app/build.gradle.kts).
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Log.i("boot signal: ${intent.action}")
        val launch = Intent(context, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        try {
            context.startActivity(launch)
        } catch (t: Throwable) {
            Log.w("could not start on boot: ${t.message}")
        }
    }
}

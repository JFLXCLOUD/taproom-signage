package com.taproom.signage

/** One tag for the whole app, so `adb logcat -s TaproomSignage` shows everything. */
object Log {
    private const val TAG = "TaproomSignage"
    fun i(msg: String) = android.util.Log.i(TAG, msg)
    fun w(msg: String) = android.util.Log.w(TAG, msg)
}

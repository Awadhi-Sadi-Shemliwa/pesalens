package com.pesalens.mobile;

import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.IBinder;
import android.util.Log;

/**
 * Sentinel service whose only job is to receive onTaskRemoved when the user
 * swipes PesaLens out of the Recents tray, and wipe the persisted refresh
 * token before the process dies.
 *
 * Why a Service and not Activity.onDestroy:
 *   Activity onDestroy is not guaranteed to run on a task-swipe-remove —
 *   Android often just kills the process. A Service registered with
 *   stopWithTask="false" is the documented hook that *does* fire on task
 *   removal, even when the activity has already been torn down.
 *
 * What it wipes:
 *   The Capacitor Preferences plugin stores its values in the
 *   SharedPreferences file named "CapacitorStorage" (Capacitor 6+ default).
 *   We remove `pesalens.refresh` and `pesalens.lastActiveAt` so the next
 *   cold launch lands on the landing page with no session to restore.
 *
 *   Cached user profile / language / theme stay in localStorage (a separate
 *   WebView-managed file) so the next sign-in still feels personalised.
 */
public class PesaLensCleanupService extends Service {
    private static final String TAG = "PesaLensCleanupSvc";
    private static final String CAPACITOR_PREFS = "CapacitorStorage";
    private static final String REFRESH_KEY = "pesalens.refresh";
    private static final String LAST_ACTIVE_KEY = "pesalens.lastActiveAt";

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // No-op — the service exists purely so the framework can deliver
        // onTaskRemoved. Return START_NOT_STICKY so Android doesn't
        // resurrect us after the cleanup runs.
        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        try {
            SharedPreferences prefs = getApplicationContext()
                    .getSharedPreferences(CAPACITOR_PREFS, Context.MODE_PRIVATE);
            prefs.edit()
                    .remove(REFRESH_KEY)
                    .remove(LAST_ACTIVE_KEY)
                    .commit();
            Log.i(TAG, "Swiped from recents — refresh token wiped");
        } catch (Throwable t) {
            // Best-effort: if the prefs file can't be written we can't do
            // anything useful, and the background-grace timer will catch
            // the stale session on the next cold start anyway.
            Log.w(TAG, "onTaskRemoved cleanup failed", t);
        }
        super.onTaskRemoved(rootIntent);
        stopSelf();
    }
}

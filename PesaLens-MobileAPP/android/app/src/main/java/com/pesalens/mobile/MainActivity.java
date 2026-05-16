package com.pesalens.mobile;

import android.content.Intent;
import android.os.Bundle;

import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Edge-to-edge: WebView draws under the status & nav bars so the CSS
        // env(safe-area-inset-*) variables report real values.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        // Start the cleanup sentinel so onTaskRemoved fires when the user
        // swipes PesaLens out of recents. Without this the service never
        // gets bound to the task and the refresh token would persist
        // through a kill-from-recents (current spec wants instant signout).
        startService(new Intent(this, PesaLensCleanupService.class));
    }
}

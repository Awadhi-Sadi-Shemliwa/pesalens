package com.pesalens.mobile;

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
    }
}

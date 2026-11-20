package kr.gigonggyo.routeagent;

import android.app.Activity;
import android.os.Bundle;
import android.content.pm.PackageManager;
import android.util.Base64;
import android.view.View;
import android.webkit.WebView;
import android.widget.*;
import com.kakao.vectormap.*;
import java.security.MessageDigest;

public final class MainActivity extends Activity {
    private MapView map;
    private FrameLayout deck;
    private WebView chat;
    private TextView status;
    private boolean sdkInitialized;
    private boolean started;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(16, 16, 16, 16);
        LinearLayout tabs = new LinearLayout(this);
        Button mapButton = new Button(this);
        mapButton.setText("카카오 지도");
        Button chatButton = new Button(this);
        chatButton.setText("경로 대화 · 모의");
        tabs.addView(mapButton);
        tabs.addView(chatButton);
        root.addView(tabs);
        status = new TextView(this);
        root.addView(status);
        deck = new FrameLayout(this);
        root.addView(deck, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);

        chat = new WebView(this);
        chat.getSettings().setJavaScriptEnabled(true);
        chat.getSettings().setBlockNetworkLoads(true);
        chat.loadUrl("file:///android_asset/conversation.html");
        deck.addView(chat);
        chat.setVisibility(View.GONE);
        mapButton.setOnClickListener(view -> showMapTab());
        chatButton.setOnClickListener(view -> {
            chat.setVisibility(View.VISIBLE);
            chat.bringToFront();
            status.setText("용운동 → 충남대 · 모의 경로와 매장 비교");
        });

        EditText key = new EditText(this);
        key.setSingleLine(true);
        key.setHint("카카오 네이티브 앱 키");
        Button connect = new Button(this);
        connect.setText("지도 연결");
        TextView hash = new TextView(this);
        hash.setTextIsSelectable(true);
        hash.setText("카카오 Android 플랫폼 등록\n패키지  " + getPackageName() + "\n키 해시  " + keyHash());
        LinearLayout setup = new LinearLayout(this);
        setup.setOrientation(LinearLayout.VERTICAL);
        setup.addView(hash);
        setup.addView(key);
        setup.addView(connect);
        deck.addView(setup);
        status.setText("대전 지도 연결");
        connect.setOnClickListener(view -> {
            String value = key.getText().toString().trim();
            if (!value.matches("[a-fA-F0-9]{32}")) {
                key.setError("네이티브 앱 키를 확인해 주세요");
                return;
            }
            connect.setEnabled(false);
            startMap(value, setup, connect, key);
        });
    }

    private void showMapTab() {
        chat.setVisibility(View.GONE);
        status.setText(started ? "대전 · 용운동과 충남대 일대" : "대전 지도 연결");
    }

    private void startMap(String key, View setup, Button connect, EditText keyField) {
        try {
            if (!sdkInitialized) {
                KakaoMapSdk.init(getApplicationContext(), key);
                sdkInitialized = true;
                keyField.setEnabled(false);
            }
            MapView candidate = new MapView(this);
            map = candidate;
            deck.addView(candidate, 0, new FrameLayout.LayoutParams(-1, -1));
            status.setText("카카오 지도 연결 중…");
            candidate.start(new MapLifeCycleCallback() {
                @Override public void onMapDestroy() {}
                @Override public void onMapError(Exception error) {
                    runOnUiThread(() -> {
                        if (isFinishing() || isDestroyed() || map != candidate) return;
                        started = false;
                        deck.removeView(candidate);
                        map = null;
                        setup.setVisibility(View.VISIBLE);
                        connect.setEnabled(true);
                        status.setText("지도 연결 실패 · 패키지명과 키 해시를 확인해 주세요. 키를 바꾸려면 앱을 다시 시작하세요.");
                    });
                }
            }, new KakaoMapReadyCallback() {
                @Override public LatLng getPosition() { return LatLng.from(36.345, 127.40); }
                @Override public int getZoomLevel() { return 12; }
                @Override public void onMapReady(KakaoMap ready) {
                    runOnUiThread(() -> {
                        if (isFinishing() || isDestroyed() || map != candidate) return;
                        started = true;
                        setup.setVisibility(View.GONE);
                        status.setText("대전 · 용운동과 충남대 일대");
                    });
                }
            });
        } catch (RuntimeException error) {
            if (map != null) deck.removeView(map);
            map = null;
            connect.setEnabled(true);
            status.setText("지도 초기화 실패 · 앱 키 설정을 확인해 주세요.");
        }
    }

    @SuppressWarnings("deprecation")
    private String keyHash() {
        try {
            byte[] signature = getPackageManager().getPackageInfo(
                getPackageName(), PackageManager.GET_SIGNATURES).signatures[0].toByteArray();
            return Base64.encodeToString(MessageDigest.getInstance("SHA-1").digest(signature), Base64.NO_WRAP);
        } catch (Exception error) {
            return "확인 실패";
        }
    }

    @Override protected void onResume() { super.onResume(); if (map != null) map.resume(); }
    @Override protected void onPause() { if (map != null) map.pause(); super.onPause(); }
}

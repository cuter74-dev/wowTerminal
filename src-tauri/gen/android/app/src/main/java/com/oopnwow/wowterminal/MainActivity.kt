package com.oopnwow.wowterminal

import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // (#144) edge-to-edge(Android 15+/targetSdk 35+ 강제)에서 웹뷰가 시스템 바 아래로
    // 깔리는데 Android WebView는 CSS env(safe-area-inset-*)를 신뢰성 있게 제공하지
    // 않는다. 시스템 바 + 디스플레이 컷아웃 인셋만큼 콘텐츠 루트에 패딩을 준다 —
    // 상단 상태바 겹침과 하단 내비바 겹침을 함께 해결한다.
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { v, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      insets
    }
  }
}

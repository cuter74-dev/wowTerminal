// S-001 스플래시/로딩.

export function SplashScreen() {
  return (
    <main
      style={{
        width: "100vw",
        height: "100vh",
        background: "#1a1a20",
        color: "#e6e6e6",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        userSelect: "none",
      }}
    >
      <div style={{ fontSize: 64 }}>🖥️</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: "#fff" }}>AI Terminal</div>
      <div style={{ fontSize: 12, color: "#789" }}>v0.1.0-beta</div>
      <div
        style={{
          width: 180,
          height: 3,
          background: "#2a2a30",
          borderRadius: 2,
          overflow: "hidden",
          marginTop: 8,
        }}
      >
        <div
          style={{
            width: "40%",
            height: "100%",
            background: "#4a9eff",
            borderRadius: 2,
            animation: "wt-splash 1s ease-in-out infinite",
          }}
        />
      </div>
      <div style={{ fontSize: 11, color: "#566" }}>초기화 중…</div>
      <style>
        {`@keyframes wt-splash { 0% { margin-left: -40%; } 100% { margin-left: 100%; } }`}
      </style>
    </main>
  );
}

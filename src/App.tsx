import { useState } from "react";
import { Terminal } from "./components/Terminal";
import { HostList } from "./components/HostList";
import {
  HostKeyMismatchModal,
  MismatchInfo,
} from "./components/HostKeyMismatchModal";
import { SshConnectError, TerminalSource } from "./types";
import "./App.css";

function App() {
  const [source, setSource] = useState<TerminalSource>({ kind: "local" });
  const [mismatch, setMismatch] = useState<MismatchInfo | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  function handleSshError(err: SshConnectError) {
    if (err.kind === "host_key_mismatch") {
      setMismatch({
        host: err.host,
        port: err.port,
        algorithm: err.algorithm,
        stored: err.stored,
        presented: err.presented,
      });
    }
    // 'other'는 모달 없이 터미널 안에 메시지로 이미 표시됨.
  }

  return (
    <main style={{ width: "100vw", height: "100vh", display: "flex" }}>
      <HostList source={source} onSelect={(s) => {
        setMismatch(null);
        setSource(s);
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <Terminal
          source={source}
          retryNonce={retryNonce}
          onSshError={handleSshError}
        />
      </div>
      {mismatch && (
        <HostKeyMismatchModal
          info={mismatch}
          onCancel={() => setMismatch(null)}
          onTrusted={() => {
            setMismatch(null);
            // 재마운트하여 다시 connect 시도.
            setRetryNonce((n) => n + 1);
          }}
        />
      )}
    </main>
  );
}

export default App;

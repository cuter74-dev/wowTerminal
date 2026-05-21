import { useState } from "react";
import { Terminal } from "./components/Terminal";
import { HostList } from "./components/HostList";
import { TerminalSource } from "./types";
import "./App.css";

function App() {
  const [source, setSource] = useState<TerminalSource>({ kind: "local" });

  return (
    <main style={{ width: "100vw", height: "100vh", display: "flex" }}>
      <HostList source={source} onSelect={setSource} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <Terminal source={source} />
      </div>
    </main>
  );
}

export default App;

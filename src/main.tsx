import ReactDOM from "react-dom/client";
import App from "./App";

// StrictMode는 dev에서 effect를 mount→unmount→mount로 두 번 실행한다.
// PTY/SSH 세션은 mount당 1개 생성되므로 이 이중 실행이 세션 인계 도중
// 잘못된 kill(인계된 세션 사망)과 detached_init 이중 호출을 유발한다.
// prod 빌드에는 StrictMode가 없으므로(1회 실행) 동작 일관성을 위해 제거.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />,
);

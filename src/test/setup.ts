// vitest 공통 설정 (#158): 프론트 코드가 import하는 Tauri 모듈을 목으로 바꾼다.
import { vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => import("./tauriMock"));
vi.mock("@tauri-apps/api/event", () => import("./tauriMock"));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: async () => {} }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: async () => false }));

// React act() 경고 없이 effect를 돌리기 위한 플래그.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

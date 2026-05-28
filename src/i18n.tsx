// 경량 자체 i18n (#22). 외부 의존성 없이 React Context로 현재 언어만 전달한다.
//
// 사용 패턴 — 각 컴포넌트가 자신의 문자열을 로컬 사전으로 들고, useT로 선택한다:
//
//   const STR = {
//     en: { title: "Settings", cancel: "Cancel" },
//     ko: { title: "설정", cancel: "취소" },
//   } as const;
//   function MyComp() {
//     const t = useT(STR);
//     return <h1>{t.title}</h1>;
//   }
//
// 언어는 App이 LangProvider로 settings.general.language를 주입한다.

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { Lang } from "./settings";

const LangContext = createContext<Lang>("en");

export function LangProvider({
  lang,
  children,
}: {
  lang: Lang;
  children: ReactNode;
}) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export function useLang(): Lang {
  return useContext(LangContext);
}

/**
 * 컴포넌트 로컬 사전 타입. 영어(en)는 필수, 나머지 언어는 선택.
 * 번역이 없는 언어는 useT가 en으로 폴백한다 → 언어를 점진적으로 채울 수 있다.
 */
export type LangDict<T> = { en: T } & Partial<Record<Lang, T>>;

/** 컴포넌트 로컬 사전에서 현재 언어 묶음을 고른다. 없으면 영어로 폴백. */
export function useT<T>(dict: LangDict<T>): T {
  return dict[useLang()] ?? dict.en;
}

import type { Language } from "../schema.ts";
import { createKiwiAnalyzer } from "./kiwi.ts";
import type { Analyzer } from "./types.ts";

export { AnalyzerUnavailableError } from "./types.ts";
export type { Analyzer, Token, WordClass } from "./types.ts";

/**
 * 언어별 형태소 분석기다.
 * 새 언어를 지원하려면 Analyzer를 구현하고 여기에 등록한다.
 */
const LOADERS: Partial<Record<Language, () => Promise<Analyzer>>> = {
  ko: () => createKiwiAnalyzer(),
};

/**
 * 대본의 언어에 맞는 분석기를 불러온다.
 * 그 언어에 등록된 분석기가 없으면 undefined를 돌려준다.
 * 등록된 분석기를 불러오지 못하면 AnalyzerUnavailableError를 던진다.
 */
export async function loadAnalyzer(language: Language): Promise<Analyzer | undefined> {
  return LOADERS[language]?.();
}

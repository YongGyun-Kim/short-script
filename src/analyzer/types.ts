import type { Language } from "../schema.ts";

/**
 * 언어에 공통인 낱말 분류다.
 * 측정 함수는 분석기마다 다른 품사 태그를 보지 않고 이 분류만 본다.
 * 새 언어의 분석기는 자기 품사 태그를 이 분류로 바꿔서 돌려준다.
 */
export type WordClass =
  | "noun" // 일반 명사와 고유 명사
  | "verb"
  | "adjective"
  | "adverb"
  | "connective" // 문장을 앞 문장과 잇는 접속 표현. 예: 하지만, 그래서
  | "demonstrative" // 앞에 나온 대상을 가리키는 지시어. 예: 이, 그것
  | "clauseLink" // 절과 절을 잇는 요소. 예: 연결 어미 "-고", "-지만"
  | "other";

/** 분석기가 문장을 쪼갠 단위 하나다. */
export interface Token {
  /** 문장에 나온 형태다. */
  form: string;
  /** 사전에서 찾을 때 쓰는 기본형이다. */
  lemma: string;
  /** 분석기가 붙인 원래 품사 태그다. */
  tag: string;
  wordClass: WordClass;
  /** 문장 안에서 시작하는 위치다. */
  start: number;
  length: number;
}

/** 언어 하나를 맡는 형태소 분석기다. */
export interface Analyzer {
  readonly language: Language;
  /** 기록에 남기는 분석기의 이름과 버전이다. */
  readonly name: string;
  analyze(text: string): Token[];
}

/** 등록된 분석기를 불러오지 못했을 때 던지는 오류다. 메시지는 사용자에게 그대로 보여 준다. */
export class AnalyzerUnavailableError extends Error {
  override name = "AnalyzerUnavailableError";
}

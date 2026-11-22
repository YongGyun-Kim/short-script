import { z } from "zod";

/**
 * 문장의 타입이다. 대본 생성 단계가 붙인 라벨이다.
 * 쇼더스의 실제 타입 목록은 확인하지 못했다. 확인하면 이 목록을 맞춘다.
 */
export const SENTENCE_TYPES = [
  "hook", // 훅: 시청자가 계속 볼 이유를 만든다
  "context", // 배경: 본문을 이해하는 데 필요한 상황을 알린다
  "problem", // 문제: 시청자가 겪는 문제를 제시한다
  "agitation", // 문제 심화: 문제를 방치했을 때의 결과를 보여 준다
  "point", // 포인트: 핵심 정보나 주장을 전한다
  "solution", // 해결: 문제를 푸는 방법을 제시한다
  "example", // 예시: 포인트나 해결을 사례로 뒷받침한다
  "result", // 결과: 해결 뒤에 달라진 점을 보여 준다
  "closing", // 마무리: 내용을 정리한다
  "cta", // 행동 유도: 시청자에게 다음 행동을 요청한다
] as const;
export type SentenceType = (typeof SENTENCE_TYPES)[number];

export function isSentenceType(value: string): value is SentenceType {
  return (SENTENCE_TYPES as readonly string[]).includes(value);
}

export const STRUCTURE_IDS = [
  "basic", // 기본 3단
  "problem-solution", // 문제·해결
  "pas", // 문제, 문제 심화, 해결
  "aida", // 주의, 흥미, 욕구, 행동
  "problem-solution-result", // 문제·해결·결과
  "story", // 이야기형
  "list", // 목록형
] as const;
export type StructureId = (typeof STRUCTURE_IDS)[number];

/**
 * 대본의 언어다. 지금 판정기는 한국어 대본을 대상으로 만든다.
 * 다른 언어는 형태소 분석기와 측정 규칙을 추가하면 쓸 수 있다.
 */
export const LANGUAGES = ["ko", "en", "ja", "zh"] as const;
export type Language = (typeof LANGUAGES)[number];

/**
 * 대본 생성 단계가 넘기는 문장이다.
 * 판정기는 대본이 생성된 직후에 대본의 내용만 판정하므로, TTS 재생 시간과 속도는 받지 않는다.
 * 값이 유효한지는 판정 항목(format.fields)이 재므로 여기서는 형태만 확인한다.
 */
export const SentenceSchema = z.object({
  /** TTS가 읽을 문장이다. */
  text: z.string(),
  /** 문장의 역할 라벨이다. */
  type: z.string(),
});
export type Sentence = z.infer<typeof SentenceSchema>;

/** 판정기의 입력이다. 대본 생성 직후의 대본 하나다. */
export const JudgeInputSchema = z.object({
  /** 기록을 다른 자료와 연결할 때 쓰는 대본 식별자다. */
  scriptId: z.string().min(1),
  /** 대본의 언어다. 정하지 않으면 한국어로 본다. */
  language: z.enum(LANGUAGES).default("ko"),
  /** 사용자가 고른 구조다. 대본 생성 단계는 이 구조에 맞춰 대본을 만든다. */
  structure: z.enum(STRUCTURE_IDS),
  /** 재생 순서대로 놓인 문장이다. */
  sentences: z.array(SentenceSchema).min(1),
});
export type JudgeInput = z.infer<typeof JudgeInputSchema>;

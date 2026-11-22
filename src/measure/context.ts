import type { Analyzer, Token } from "../analyzer/types.ts";
import type { ScriptReview } from "../model/review.ts";
import type { JudgeInput, Language } from "../schema.ts";
import { STRUCTURES, stepIndexOf } from "../structures.ts";
import type { StructureDefinition } from "../structures.ts";
import { countSyllables } from "../text.ts";

/** 측정 함수들이 함께 쓰는 문장 정보다. */
export interface SentenceContext {
  index: number;
  text: string;
  type: string;
  /** TTS가 읽는 음절 수다. */
  syllables: number;
  /** 숫자나 영문이 있어서 음절 수를 어림했으면 true다. */
  syllablesEstimated: boolean;
  /** 문장이 속한 구조 단계의 순번이다. 구조에 없는 타입이면 -1이다. */
  stepIndex: number;
  /** 형태소 분석 결과다. 분석기가 없으면 빈 배열이다. */
  tokens: Token[];
}

export interface MeasureContext {
  language: Language;
  /** 형태소 분석기의 이름과 버전이다. 분석기가 없으면 null이다. */
  analyzer: string | null;
  structure: StructureDefinition;
  sentences: SentenceContext[];
  /** 모델이 대본 전체를 읽고 내린 판단이다. 판단을 받지 못했으면 null이다. */
  review: ScriptReview | null;
  /** review가 null인 이유다. 모델 판단이 필요한 항목은 이 이유로 건너뛴다. */
  reviewMissingReason: string;
}

/** 모델 판단이 필요한 측정 함수가 판단을 꺼낼 때 쓴다. 판정기가 판단이 있을 때만 이 함수들을 부른다. */
export function requireReview(context: MeasureContext): ScriptReview {
  if (!context.review) throw new Error("모델 판단이 없는데 모델 판단이 필요한 항목을 쟀다.");
  return context.review;
}

export function buildContext(input: JudgeInput, analyzer?: Analyzer): MeasureContext {
  if (analyzer && analyzer.language !== input.language) {
    throw new Error(
      `분석기의 언어(${analyzer.language})와 대본의 언어(${input.language})가 다르다.`,
    );
  }

  const structure = STRUCTURES[input.structure];
  const sentences = input.sentences.map((sentence, index) => {
    const syllables = countSyllables(sentence.text);
    return {
      index,
      text: sentence.text,
      type: sentence.type,
      syllables: syllables.count,
      syllablesEstimated: syllables.estimated,
      stepIndex: stepIndexOf(structure, sentence.type),
      tokens: analyzer ? analyzer.analyze(sentence.text) : [],
    };
  });
  return {
    language: input.language,
    analyzer: analyzer?.name ?? null,
    structure,
    sentences,
    review: null,
    reviewMissingReason: "작은 모델을 연결하지 않았다.",
  };
}

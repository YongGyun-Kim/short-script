import type { ItemId } from "./items.ts";
import type { Language, StructureId } from "./schema.ts";

/**
 * ok는 기준값 안이다. flagged는 기준값을 벗어났다.
 * unset은 기준값이 아직 없어서 판정하지 않았다는 뜻이다.
 */
export type Verdict = "ok" | "flagged" | "unset";

/** 문장 하나의 측정값이다. */
export interface SentenceValue {
  /** 문장의 순번이다. 0부터 센다. */
  index: number;
  value: number;
  /** 측정값을 설명하는 말이다. */
  note?: string;
}

/** 판정 항목 하나의 측정 결과다. */
export interface Measurement {
  item: ItemId;
  /** skipped는 이 항목을 재지 않았다는 뜻이다. 이유는 skipReason에 있다. */
  status: "measured" | "skipped";
  /** 대표 측정값이다. 값의 뜻은 항목 정의의 measures에 있다. */
  value: number | null;
  /** 함께 남기는 보조 측정값이다. */
  facts: Record<string, number | boolean | string>;
  /** 문장별 측정값이다. 문장 단위로 재지 않는 항목은 빈 배열이다. */
  sentences: SentenceValue[];
  verdict: Verdict;
  skipReason?: string;
}

/** 측정 함수가 돌려주는 값이다. 판정기가 여기에 항목과 판정을 붙여 기록으로 만든다. */
export type Measured = Pick<Measurement, "value" | "facts" | "sentences">;

/**
 * 대본 하나의 판정 기록이다.
 * 측정값을 그대로 남기므로 기준값이 바뀌어도 판정을 다시 계산할 수 있다.
 */
export interface JudgeRecord {
  scriptId: string;
  /** 기록을 시기별로 비교할 때 같은 판정기로 잰 기록인지 확인하는 값이다. */
  judgeVersion: string;
  judgedAt: string;
  language: Language;
  /** 형태소 분석기의 이름과 버전이다. 분석기 없이 쟀으면 null이다. */
  analyzer: string | null;
  /** 작은 모델의 이름과 버전이다. 모델 없이 쟀으면 null이다. */
  model: string | null;
  /** 모델 사용량이다. 대본 하나에 모델을 몇 번 부르고 토큰과 시간을 얼마나 썼는지 남긴다. */
  modelUsage: ModelUsageRecord | null;
  structure: StructureId;
  totals: {
    sentenceCount: number;
    syllableCount: number;
  };
  measurements: Measurement[];
}

export interface ModelUsageRecord {
  /** 모델을 부른 횟수다. 답의 형식이 틀려서 다시 부르면 늘어난다. */
  calls: number;
  promptTokens: number;
  outputTokens: number;
  durationMs: number;
  /** 모델 판단을 받았으면 true다. */
  succeeded: boolean;
}

/** 기준값이다. 측정값이 min보다 작거나 max보다 크면 flagged가 된다. */
export interface Threshold {
  min?: number;
  max?: number;
}
export type Thresholds = Partial<Record<ItemId, Threshold>>;

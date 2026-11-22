import type { Analyzer } from "./analyzer/types.ts";
import { ITEMS } from "./items.ts";
import type { ItemId } from "./items.ts";
import {
  measureOneIdea,
  measureReference,
  measureSentenceLength,
  measureVocabulary,
} from "./measure/clarity.ts";
import { buildContext } from "./measure/context.ts";
import type { MeasureContext } from "./measure/context.ts";
import { measureFields, measureTtsNotation } from "./measure/format.ts";
import {
  measureDeviceGap,
  measureDevices,
  measureEmptySentences,
  measureHookPayoff,
  measureHookQuestion,
  measureRepetition,
} from "./measure/interest.ts";
import {
  measureCohesion,
  measureOpeningAndClosing,
  measureRequiredSteps,
  measureStepOrder,
  measureTimeShare,
  measureTypeMatch,
} from "./measure/structure.ts";
import { ReviewFailedError, reviewScript } from "./model/review.ts";
import type { ModelClient } from "./model/types.ts";
import type {
  JudgeRecord,
  Measured,
  Measurement,
  ModelUsageRecord,
  Threshold,
  Thresholds,
  Verdict,
} from "./record.ts";
import type { JudgeInput } from "./schema.ts";
import { round } from "./text.ts";

/** 측정 방법이나 항목이 바뀌면 올린다. 기록을 비교할 때 같은 버전끼리 비교한다. */
export const JUDGE_VERSION = "0.5.0";

/**
 * 기준값이다. 구조의 정의에서 바로 나오는 항목만 정했다.
 * 나머지 항목은 기록을 쌓아 측정값의 분포를 본 뒤에 정한다.
 */
export const DEFAULT_THRESHOLDS: Thresholds = {
  "format.fields": { max: 0 },
  "structure.requiredSteps": { max: 0 },
  "structure.stepOrder": { max: 0 },
  "structure.openingAndClosing": { max: 0 },
};

interface Measurer {
  measure: (context: MeasureContext) => Measured;
  /** true면 형태소 분석 결과가 있어야 잰다. */
  needsAnalyzer?: true;
  /** true면 모델 판단이 있어야 잰다. */
  needsReview?: true;
  /** true면 모델 판단이 있을 때 함께 쓴다. 모델 판단이 없어도 잰다. */
  usesReview?: true;
  /** true면 한국어 대본만 잰다. 음절 수, 표현 목록, 모델에 보내는 지시가 한국어 규칙이기 때문이다. */
  koreanOnly?: true;
}

/** 항목별 측정 함수와 그 함수가 필요로 하는 것이다. */
const MEASURERS: Record<ItemId, Measurer> = {
  "format.fields": { measure: measureFields },
  "format.ttsNotation": { measure: measureTtsNotation, koreanOnly: true },
  "structure.requiredSteps": { measure: measureRequiredSteps },
  "structure.stepOrder": { measure: measureStepOrder },
  "structure.openingAndClosing": { measure: measureOpeningAndClosing },
  "structure.timeShare": { measure: measureTimeShare },
  "structure.cohesion": { measure: measureCohesion, needsReview: true, koreanOnly: true },
  "structure.typeMatch": { measure: measureTypeMatch, needsReview: true, koreanOnly: true },
  "clarity.sentenceLength": { measure: measureSentenceLength, koreanOnly: true },
  "clarity.oneIdea": { measure: measureOneIdea, needsAnalyzer: true },
  "clarity.vocabulary": { measure: measureVocabulary, needsAnalyzer: true },
  "clarity.reference": {
    measure: measureReference,
    needsAnalyzer: true,
    needsReview: true,
    koreanOnly: true,
  },
  "interest.devices": { measure: measureDevices, usesReview: true, koreanOnly: true },
  "interest.hookQuestion": { measure: measureHookQuestion, needsReview: true, koreanOnly: true },
  "interest.hookPayoff": { measure: measureHookPayoff, needsReview: true, koreanOnly: true },
  "interest.emptySentences": { measure: measureEmptySentences, koreanOnly: true },
  "interest.repetition": { measure: measureRepetition },
  "interest.deviceGap": { measure: measureDeviceGap, usesReview: true, koreanOnly: true },
};

/** 이 대본에서 항목을 재지 않는 이유를 찾는다. 잴 수 있으면 undefined를 돌려준다. */
function skipReasonFor(measurer: Measurer, context: MeasureContext): string | undefined {
  if (measurer.koreanOnly && context.language !== "ko") {
    return "한국어 대본에만 쓰는 측정 규칙이다.";
  }
  if (measurer.needsAnalyzer && context.analyzer === null) {
    return `${context.language} 대본에 쓸 형태소 분석기를 연결하지 않았다.`;
  }
  if (measurer.needsReview && context.review === null) {
    return context.reviewMissingReason;
  }
  return undefined;
}

function decide(value: number | null, threshold: Threshold | undefined): Verdict {
  if (value === null || !threshold) return "unset";
  if (threshold.max !== undefined && value > threshold.max) return "flagged";
  if (threshold.min !== undefined && value < threshold.min) return "flagged";
  return "ok";
}

export interface JudgeOptions {
  /** 대본의 언어에 맞는 형태소 분석기다. 없으면 분석기가 필요한 항목을 재지 않는다. */
  analyzer?: Analyzer;
  /** 대본 전체를 읽고 판단하는 작은 모델이다. 없으면 모델 판단이 필요한 항목을 재지 않는다. */
  model?: ModelClient;
  thresholds?: Thresholds;
  /** 기록에 남길 판정 시각이다. 정하지 않으면 현재 시각을 쓴다. */
  now?: Date;
}

/**
 * 대본 하나를 재고 기록을 만든다.
 * 모델은 대본 하나에 한 번 부른다. 답의 형식이 틀리면 한 번 더 부른다.
 */
export async function judge(input: JudgeInput, options: JudgeOptions = {}): Promise<JudgeRecord> {
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
  const context = buildContext(input, options.analyzer);

  let modelUsage: ModelUsageRecord | null = null;
  if (options.model && input.language === "ko") {
    try {
      const result = await reviewScript(
        options.model,
        context.structure,
        context.sentences.map((sentence) => sentence.text),
      );
      context.review = result.review;
      modelUsage = { ...result.usage, succeeded: true };
    } catch (error) {
      if (!(error instanceof ReviewFailedError)) throw error;
      // 모델 판단을 받지 못해도 나머지 항목의 기록은 남긴다.
      context.reviewMissingReason = `모델 판단을 받지 못했다: ${error.message}`;
      modelUsage = { ...error.usage, succeeded: false };
    }
  }

  const measurements: Measurement[] = ITEMS.map((item) => {
    const measurer = MEASURERS[item.id];
    const skipReason = skipReasonFor(measurer, context);
    if (skipReason !== undefined) {
      return {
        item: item.id,
        status: "skipped",
        value: null,
        facts: {},
        sentences: [],
        verdict: "unset",
        skipReason,
      };
    }
    const measured = measurer.measure(context);
    return {
      item: item.id,
      status: "measured",
      ...measured,
      verdict: decide(measured.value, thresholds[item.id]),
    };
  });

  return {
    scriptId: input.scriptId,
    judgeVersion: JUDGE_VERSION,
    judgedAt: (options.now ?? new Date()).toISOString(),
    language: input.language,
    analyzer: context.analyzer,
    model: options.model?.name ?? null,
    modelUsage,
    structure: input.structure,
    totals: {
      sentenceCount: context.sentences.length,
      syllableCount: context.sentences.reduce((sum, s) => sum + s.syllables, 0),
    },
    measurements,
  };
}

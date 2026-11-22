import type { Measured, SentenceValue } from "../record.ts";
import { round } from "../text.ts";
import { requireReview } from "./context.ts";
import type { MeasureContext } from "./context.ts";

/** 선택한 구조에서 빠진 필수 단계를 센다. */
export function measureRequiredSteps(context: MeasureContext): Measured {
  const present = new Set(context.sentences.map((sentence) => sentence.stepIndex));
  const missing = context.structure.steps.filter(
    (step, index) => step.required && !present.has(index),
  );
  return {
    value: missing.length,
    facts: { missingSteps: missing.map((step) => step.name).join(", ") },
    sentences: [],
  };
}

/** 구조의 순서에서 어긋난 문장과 타입이 구조에 없는 문장을 센다. */
export function measureStepOrder(context: MeasureContext): Measured {
  const { steps } = context.structure;
  const sentences: SentenceValue[] = [];
  let outOfOrder = 0;
  let outsideStructure = 0;
  let latestStep = -1;

  for (const sentence of context.sentences) {
    if (sentence.stepIndex === -1) {
      outsideStructure += 1;
      sentences.push({
        index: sentence.index,
        value: 1,
        note: `타입 ${sentence.type}은 이 구조의 단계에 없다.`,
      });
    } else if (sentence.stepIndex < latestStep) {
      outOfOrder += 1;
      const own = steps[sentence.stepIndex]?.name;
      const latest = steps[latestStep]?.name;
      sentences.push({
        index: sentence.index,
        value: 1,
        note: `"${own}" 단계의 문장이 "${latest}" 단계 뒤에 있다.`,
      });
    } else {
      latestStep = sentence.stepIndex;
    }
  }

  return {
    value: outOfOrder + outsideStructure,
    facts: { outOfOrder, outsideStructure },
    sentences,
  };
}

/**
 * 대본이 구조의 첫 단계로 시작하고 끝 단계로 끝나는지 본다.
 * 끝 단계가 선택 단계인 구조도 끝맺음이 없으면 여기서 걸린다.
 */
export function measureOpeningAndClosing(context: MeasureContext): Measured {
  const { steps } = context.structure;
  const lastStepIndex = steps.length - 1;
  const first = context.sentences[0];
  const last = context.sentences.at(-1);

  const startsWithFirstStep = first?.stepIndex === 0;
  const endsWithLastStep = last?.stepIndex === lastStepIndex;

  // 첫 단계에 속한 문장이 이어지는 동안의 음절 수를 더한다.
  let openingSyllables = 0;
  for (const sentence of context.sentences) {
    if (sentence.stepIndex !== 0) break;
    openingSyllables += sentence.syllables;
  }

  return {
    value: (startsWithFirstStep ? 0 : 1) + (endsWithLastStep ? 0 : 1),
    facts: {
      startsWithFirstStep,
      endsWithLastStep,
      openingSyllables,
      firstStep: steps[0]?.name ?? "",
      lastStep: steps[lastStepIndex]?.name ?? "",
    },
    sentences: [],
  };
}

const OUTSIDE = "구조 밖";

/**
 * 단계별 분량 비율을 잰다.
 * 판정기는 재생 시간을 받지 않으므로 TTS가 읽을 음절 수로 분량을 잰다.
 */
export function measureTimeShare(context: MeasureContext): Measured {
  const syllables = new Map<string, number>();
  for (const step of context.structure.steps) syllables.set(step.name, 0);

  let total = 0;
  for (const sentence of context.sentences) {
    const name = context.structure.steps[sentence.stepIndex]?.name ?? OUTSIDE;
    syllables.set(name, (syllables.get(name) ?? 0) + sentence.syllables);
    total += sentence.syllables;
  }
  if (total === 0) return { value: null, facts: {}, sentences: [] };

  const facts: Record<string, number | string> = {};
  let topStep = "";
  let topShare = 0;
  for (const [name, count] of syllables) {
    const share = count / total;
    facts[`share.${name}`] = round(share, 3);
    if (share > topShare) {
      topShare = share;
      topStep = name;
    }
  }
  facts.topStep = topStep;

  return { value: round(topShare, 3), facts, sentences: [] };
}

/**
 * 앞 문장과 화제가 끊기는 문장을 센다. 모델 판단이 필요하다.
 * 목록형에서 다음 항목으로 넘어가는 문장과 마무리 문장은 넣지 말라고 모델에 지시한다.
 */
export function measureCohesion(context: MeasureContext): Measured {
  const review = requireReview(context);
  const sentences: SentenceValue[] = review.topicBreaks
    .filter((index) => index > 0)
    .map((index) => ({ index, value: 1, note: "모델이 앞 문장과 화제가 끊긴다고 봤다." }));
  return { value: sentences.length, facts: {}, sentences };
}

/**
 * 타입 라벨의 단계와 모델이 고른 단계가 다른 문장을 센다. 모델 판단이 필요하다.
 * 같은 단계 안의 타입 차이(배경과 포인트 등)는 세지 않는다.
 * 타입이 구조에 없는 문장은 단계 순서 항목이 세므로 여기서는 건너뛴다.
 */
export function measureTypeMatch(context: MeasureContext): Measured {
  const review = requireReview(context);
  const { steps } = context.structure;
  const sentences: SentenceValue[] = [];
  let compared = 0;

  for (const sentence of context.sentences) {
    if (sentence.stepIndex === -1) continue;
    compared += 1;
    const modelStep = review.steps[sentence.index];
    if (modelStep === undefined || modelStep === sentence.stepIndex) continue;
    sentences.push({
      index: sentence.index,
      value: 1,
      note: `라벨(${sentence.type})은 "${steps[sentence.stepIndex]?.name}" 단계인데 모델은 "${steps[modelStep]?.name}" 단계로 봤다.`,
    });
  }

  return { value: sentences.length, facts: { comparedSentences: compared }, sentences };
}

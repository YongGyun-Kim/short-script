import type { Measured, SentenceValue } from "../record.ts";
import { characterBigrams, jaccard, round } from "../text.ts";
import { requireReview } from "./context.ts";
import type { MeasureContext } from "./context.ts";

/** 스크립트가 표현으로 찾는 흥미 장치다. */
const SCRIPT_DEVICES = [
  { key: "question", label: "질문", pattern: /\?|(까요|니까)\s*[.!]?\s*$/ },
  {
    key: "contrast",
    label: "의외나 대비",
    pattern:
      /하지만|그런데|그러나|오히려|반대로|반면|사실은|알고 보면|의외로|놀랍게도|뜻밖에|정작|아니라|[와과] 달리/,
  },
  { key: "specific", label: "구체적인 수치나 사례", pattern: /\d|예를 들어|예컨대|가령|실제로/ },
] as const;

/** 표현만으로 찾기 어려워서 모델이 판단하는 흥미 장치다. */
const IMPACT = { key: "impact", label: "시청자에게 미치는 영향" } as const;

const DEVICE_KEYS = [...SCRIPT_DEVICES.map((device) => device.key), IMPACT.key];

interface Device {
  key: string;
  label: string;
}

/**
 * 문장마다 있는 흥미 장치를 찾는다.
 * 모델 판단이 있으면 모델이 "영향"이 있다고 본 문장에 영향 장치를 더한다.
 * 모델 판단이 없으면 스크립트로 찾은 장치만 돌려준다.
 */
function findDevices(context: MeasureContext): Device[][] {
  const impact = new Set(context.review?.impactSentences ?? []);
  return context.sentences.map((sentence) => {
    const devices: Device[] = SCRIPT_DEVICES.filter((device) => device.pattern.test(sentence.text));
    if (impact.has(sentence.index)) devices.push(IMPACT);
    return devices;
  });
}

/** 문장마다 있는 흥미 장치를 잰다. */
export function measureDevices(context: MeasureContext): Measured {
  const devicesBySentence = findDevices(context);

  const counts: Record<string, number> = {};
  for (const key of DEVICE_KEYS) counts[`${key}Count`] = 0;

  let withDevice = 0;
  const sentences: SentenceValue[] = devicesBySentence.map((devices, index) => {
    for (const device of devices) {
      const key = `${device.key}Count`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    if (devices.length === 0) return { index, value: 0 };
    withDevice += 1;
    return { index, value: devices.length, note: devices.map((device) => device.label).join(", ") };
  });

  return {
    value: round(withDevice / context.sentences.length),
    facts: { ...counts, impactJudged: context.review !== null },
    sentences,
  };
}

/**
 * 흥미 장치가 없는 문장이 이어지는 가장 긴 구간을 잰다.
 * 판정기는 재생 시간을 받지 않으므로 구간의 길이를 음절 수로 잰다.
 */
export function measureDeviceGap(context: MeasureContext): Measured {
  const devicesBySentence = findDevices(context);
  let longest = { syllables: 0, startIndex: -1, endIndex: -1 };
  let current = { syllables: 0, startIndex: -1, endIndex: -1 };

  for (const sentence of context.sentences) {
    if ((devicesBySentence[sentence.index]?.length ?? 0) > 0) {
      current = { syllables: 0, startIndex: -1, endIndex: -1 };
      continue;
    }
    current = {
      syllables: current.syllables + sentence.syllables,
      startIndex: current.startIndex === -1 ? sentence.index : current.startIndex,
      endIndex: sentence.index,
    };
    if (current.syllables > longest.syllables) longest = current;
  }

  return {
    value: longest.syllables,
    facts: {
      gapStartIndex: longest.startIndex,
      gapEndIndex: longest.endIndex,
      impactJudged: context.review !== null,
    },
    sentences: [],
  };
}

/** 첫 문장(훅)에 영상이 다룰 구체적인 내용이 있는지 잰다. 모델 판단이 필요하다. */
export function measureHookQuestion(context: MeasureContext): Measured {
  const review = requireReview(context);
  return { value: review.hookHasContent ? 1 : 0, facts: {}, sentences: [] };
}

/** 첫 문장 뒤의 문장들이 훅의 질문이나 주장에 답하는지 잰다. 모델 판단이 필요하다. */
export function measureHookPayoff(context: MeasureContext): Measured {
  const review = requireReview(context);
  if (context.sentences.length < 2) {
    return { value: null, facts: { reason: "훅 뒤에 문장이 없다." }, sentences: [] };
  }
  return { value: review.hookPaidOff ? 1 : 0, facts: {}, sentences: [] };
}

/**
 * 새 내용 없이 쓰이는 표현이다. 실제 대본으로 확인하지 않은 초안이다.
 * 일반론은 표현만으로 찾을 수 없어서 넣지 않았다.
 */
const EMPTY_EXPRESSIONS = [
  {
    label: "예고",
    pattern:
      /알아보겠|알아볼게|알아봅시다|알아보죠|알아보도록|살펴보겠|살펴볼게|살펴봅시다|살펴보죠|살펴보도록|알려\s?드리겠|알려\s?드릴게|소개해\s?드리겠|소개해\s?드릴게|정리해\s?드리겠|정리해\s?드릴게|말씀드리겠|시작하겠습니다|시작할게요|함께 보시죠|같이 보시죠/,
  },
  {
    label: "감탄",
    pattern: /(정말|진짜|너무|참)\s?(놀랍|대단|신기|충격)|충격적입니다|믿기 어렵/,
  },
] as const;

/** 훅과 끝맺음은 새 정보가 없어도 역할이 있으므로 세지 않는다. */
const EXEMPT_TYPES = new Set(["hook", "cta", "closing"]);

/** 예고나 감탄 표현이 있는 문장을 센다. */
export function measureEmptySentences(context: MeasureContext): Measured {
  const sentences: SentenceValue[] = [];
  for (const sentence of context.sentences) {
    if (EXEMPT_TYPES.has(sentence.type)) continue;
    const found = EMPTY_EXPRESSIONS.flatMap((expression) => {
      const match = sentence.text.match(expression.pattern);
      return match ? [`${expression.label}: ${match[0]}`] : [];
    });
    if (found.length > 0) {
      sentences.push({ index: sentence.index, value: found.length, note: found.join(", ") });
    }
  }
  return { value: sentences.length, facts: {}, sentences };
}

/**
 * 두 문장의 글자 겹침 비율을 잰다.
 * 글자 묶음만 비교하므로 표현이 다르고 뜻이 같은 문장은 찾지 못한다.
 */
export function measureRepetition(context: MeasureContext): Measured {
  const bigrams = context.sentences.map((sentence) => characterBigrams(sentence.text));
  const closest = context.sentences.map(() => ({ similarity: 0, other: -1 }));

  let top = { similarity: 0, first: -1, second: -1 };
  for (let i = 0; i < bigrams.length; i += 1) {
    for (let j = i + 1; j < bigrams.length; j += 1) {
      const a = bigrams[i];
      const b = bigrams[j];
      if (!a || !b) continue;
      const similarity = jaccard(a, b);
      for (const [self, other] of [
        [i, j],
        [j, i],
      ] as const) {
        const entry = closest[self];
        if (entry && similarity > entry.similarity) {
          entry.similarity = similarity;
          entry.other = other;
        }
      }
      if (similarity > top.similarity) top = { similarity, first: i, second: j };
    }
  }

  const sentences: SentenceValue[] = closest.map((entry, index) => ({
    index,
    value: round(entry.similarity),
    ...(entry.other === -1 ? {} : { note: `문장 ${entry.other}과 가장 많이 겹친다.` }),
  }));

  return {
    value: round(top.similarity),
    facts: { pairFirstIndex: top.first, pairSecondIndex: top.second },
    sentences,
  };
}

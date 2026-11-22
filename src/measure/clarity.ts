import type { Measured, SentenceValue } from "../record.ts";
import { round } from "../text.ts";
import { requireReview } from "./context.ts";
import type { MeasureContext } from "./context.ts";

const ESTIMATED_NOTE = "숫자나 영문이 있어서 음절 수를 어림했다.";

/** 문장별 음절 수를 잰다. */
export function measureSentenceLength(context: MeasureContext): Measured {
  const sentences: SentenceValue[] = context.sentences.map((sentence) => ({
    index: sentence.index,
    value: sentence.syllables,
    ...(sentence.syllablesEstimated ? { note: ESTIMATED_NOTE } : {}),
  }));

  let longest = context.sentences[0];
  let total = 0;
  for (const sentence of context.sentences) {
    total += sentence.syllables;
    if (longest && sentence.syllables > longest.syllables) longest = sentence;
  }

  return {
    value: longest?.syllables ?? null,
    facts: {
      longestIndex: longest?.index ?? -1,
      meanSyllables: round(total / context.sentences.length, 1),
    },
    sentences,
  };
}

/**
 * 문장별 절의 수를 잰다. 형태소 분석 결과가 필요하다.
 * 절의 수는 절을 잇는 요소의 수에 1을 더한 값이다.
 * 명사를 꾸미는 절("요금제를 고른 가구")은 세지 않는다.
 */
export function measureOneIdea(context: MeasureContext): Measured {
  const sentences: SentenceValue[] = context.sentences.map((sentence) => ({
    index: sentence.index,
    value: 1 + sentence.tokens.filter((token) => token.wordClass === "clauseLink").length,
  }));

  let most = sentences[0];
  let total = 0;
  for (const sentence of sentences) {
    total += sentence.value;
    if (most && sentence.value > most.value) most = sentence;
  }

  return {
    value: most?.value ?? null,
    facts: {
      mostClausesIndex: most?.index ?? -1,
      meanClauses: round(total / sentences.length),
    },
    sentences,
  };
}

/**
 * 어휘 난이도를 잰다. 형태소 분석 결과가 필요하다.
 * 지금은 명사가 연달아 나온 길이만 잰다.
 * 어려운 단어의 비율은 어휘 등급 목록을 연결한 뒤에 잰다.
 */
export function measureVocabulary(context: MeasureContext): Measured {
  let longest = { length: 0, index: -1, words: "" };

  const sentences: SentenceValue[] = context.sentences.map((sentence) => {
    let best: string[] = [];
    let run: string[] = [];
    for (const token of sentence.tokens) {
      if (token.wordClass === "noun") {
        run.push(token.form);
        if (run.length > best.length) best = [...run];
      } else {
        run = [];
      }
    }
    if (best.length > longest.length) {
      longest = { length: best.length, index: sentence.index, words: best.join(" ") };
    }
    return {
      index: sentence.index,
      value: best.length,
      ...(best.length > 1 ? { note: best.join(" ") } : {}),
    };
  });

  return {
    value: null,
    facts: {
      longestNounRun: longest.length,
      longestNounRunIndex: longest.index,
      longestNounRunWords: longest.words,
      difficultWordRatio: "어휘 등급 목록을 연결하지 않아서 재지 않았다.",
    },
    sentences,
  };
}

/**
 * 가리키는 대상이 불분명한 지시어를 센다. 형태소 분석 결과와 모델 판단이 필요하다.
 * 모델이 짚은 문장 중 형태소 분석기가 지시어를 찾은 문장만 센다.
 * 지시어가 없는 문장을 모델이 짚으면 세지 않고 그 수만 남긴다.
 */
export function measureReference(context: MeasureContext): Measured {
  const flagged = new Set(requireReview(context).unclearReferences);
  const sentences: SentenceValue[] = [];
  let withDemonstratives = 0;
  let ignored = 0;

  for (const sentence of context.sentences) {
    const demonstratives = sentence.tokens.filter((token) => token.wordClass === "demonstrative");
    // 첫 문장은 앞 문장이 없으므로 재지 않는다.
    if (sentence.index === 0 || demonstratives.length === 0) {
      if (flagged.has(sentence.index)) ignored += 1;
      continue;
    }
    withDemonstratives += 1;
    if (!flagged.has(sentence.index)) continue;
    sentences.push({
      index: sentence.index,
      value: 1,
      note: `모델이 지시어 "${demonstratives.map((token) => token.form).join(", ")}"의 대상을 앞 문장에서 알 수 없다고 봤다.`,
    });
  }

  return {
    value: sentences.length,
    facts: { sentencesWithDemonstratives: withDemonstratives, ignoredModelFlags: ignored },
    sentences,
  };
}

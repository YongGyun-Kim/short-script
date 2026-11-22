import type { Measured, SentenceValue } from "../record.ts";
import { isSentenceType } from "../schema.ts";
import type { MeasureContext } from "./context.ts";

/** 필드와 값의 유효성을 잰다. */
export function measureFields(context: MeasureContext): Measured {
  const sentences: SentenceValue[] = [];
  for (const sentence of context.sentences) {
    const problems: string[] = [];
    if (sentence.text.trim() === "") problems.push("문장이 비어 있다.");
    if (!isSentenceType(sentence.type)) {
      problems.push(`허용 목록에 없는 타입이다: ${sentence.type}`);
    }
    if (problems.length > 0) {
      sentences.push({ index: sentence.index, value: problems.length, note: problems.join(" ") });
    }
  }
  return { value: sentences.length, facts: {}, sentences };
}

const URL_PATTERN = /https?:\/\/\S+|www\.\S+|\S+@\S+\.\S+/g;

/**
 * TTS가 잘못 읽거나 건너뛸 수 있는 표기다.
 * 실제 TTS로 확인한 목록이 아니다. 쇼더스의 TTS가 읽는 방식을 확인하면 조정한다.
 */
const NOTATIONS = [
  { key: "bracket", label: "괄호", pattern: /[([{<〈《「『【]/g },
  { key: "emoji", label: "이모지", pattern: /\p{Extended_Pictographic}/gu },
  { key: "symbol", label: "기호", pattern: /[※★☆♥♡→←↑↓#@*^|\\_=]/g },
  { key: "acronym", label: "영문 약어", pattern: /[A-Z]{2,}/g },
] as const;

/** TTS가 잘못 읽는 표기를 센다. */
export function measureTtsNotation(context: MeasureContext): Measured {
  const totals: Record<string, number> = { url: 0 };
  for (const notation of NOTATIONS) totals[notation.key] = 0;

  const sentences: SentenceValue[] = [];
  for (const sentence of context.sentences) {
    const labels: string[] = [];
    let count = 0;

    const urls = sentence.text.match(URL_PATTERN) ?? [];
    if (urls.length > 0) {
      count += urls.length;
      totals.url = (totals.url ?? 0) + urls.length;
      labels.push("URL이나 이메일");
    }
    // URL 안의 기호를 한 번 더 세지 않도록 URL을 지운 뒤에 나머지 표기를 찾는다.
    const rest = sentence.text.replace(URL_PATTERN, " ");
    for (const notation of NOTATIONS) {
      const matches = rest.match(notation.pattern) ?? [];
      if (matches.length === 0) continue;
      count += matches.length;
      totals[notation.key] = (totals[notation.key] ?? 0) + matches.length;
      labels.push(notation.label);
    }

    if (count > 0) {
      sentences.push({ index: sentence.index, value: count, note: labels.join(", ") });
    }
  }

  const value = sentences.reduce((sum, sentence) => sum + sentence.value, 0);
  return { value, facts: totals, sentences };
}

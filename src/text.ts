/**
 * 문장에서 읽는 음절 수와 글자 겹침을 계산한다.
 * 형태소 분석기를 쓰지 않는다.
 */

const DIGIT_NAMES = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
const SMALL_UNITS = ["", "십", "백", "천"];
const BIG_UNITS = ["", "만", "억", "조", "경"];

/** 정수를 한자어 수사로 읽는다. 예: "3000"은 "삼천", "10000"은 "만"이다. */
export function readInteger(digits: string): string {
  // 0으로 시작하는 수는 전화번호처럼 숫자를 하나씩 읽는다.
  if (digits.length > 1 && digits.startsWith("0")) {
    return [...digits].map((d) => (d === "0" ? "공" : DIGIT_NAMES[Number(d)])).join("");
  }
  if (digits === "0") return "영";
  if (digits.length > BIG_UNITS.length * 4) {
    return [...digits].map((d) => (d === "0" ? "영" : DIGIT_NAMES[Number(d)])).join("");
  }

  const groups: string[] = [];
  for (let end = digits.length; end > 0; end -= 4) {
    groups.unshift(digits.slice(Math.max(0, end - 4), end));
  }

  let reading = "";
  groups.forEach((group, groupIndex) => {
    const bigIndex = groups.length - 1 - groupIndex;
    let groupReading = "";
    [...group].forEach((digit, digitIndex) => {
      const value = Number(digit);
      if (value === 0) return;
      const position = group.length - 1 - digitIndex;
      // 십, 백, 천 앞의 1은 읽지 않는다.
      const digitName = value === 1 && position > 0 ? "" : (DIGIT_NAMES[value] ?? "");
      groupReading += digitName + (SMALL_UNITS[position] ?? "");
    });
    if (groupReading === "") return;
    // 10000은 "일만"이 아니라 "만"으로 읽는다.
    if (groupReading === "일" && bigIndex === 1) groupReading = "";
    reading += groupReading + BIG_UNITS[bigIndex];
  });
  return reading;
}

/** 영문 대문자 약어를 글자 이름으로 읽을 때의 음절 수다. 예: A는 "에이"로 2음절이다. */
const LETTER_SYLLABLES: Record<string, number> = {
  A: 2,
  B: 1,
  C: 1,
  D: 1,
  E: 1,
  F: 2,
  G: 1,
  H: 3,
  I: 2,
  J: 2,
  K: 2,
  L: 1,
  M: 1,
  N: 1,
  O: 1,
  P: 1,
  Q: 1,
  R: 1,
  S: 2,
  T: 1,
  U: 1,
  V: 2,
  W: 3,
  X: 2,
  Y: 2,
  Z: 1,
};

function latinSyllables(word: string): number {
  if (word.length <= 5 && word === word.toUpperCase()) {
    return [...word].reduce((sum, letter) => sum + (LETTER_SYLLABLES[letter] ?? 1), 0);
  }
  // 영어 단어는 모음 묶음의 수로 음절 수를 어림한다.
  return Math.max(1, (word.toLowerCase().match(/[aeiouy]+/g) ?? []).length);
}

const TOKEN_PATTERN = /\d[\d,]*(?:\.\d+)?|[A-Za-z]+|[가-힣]|%/g;

export interface SyllableCount {
  count: number;
  /** 숫자나 영문이 있어서 음절 수를 어림했으면 true다. */
  estimated: boolean;
}

/**
 * TTS가 읽는 음절 수를 센다.
 * 한글은 글자 수를 센다. 숫자는 한자어 수사로 읽는다고 가정한다.
 * "3개"를 "세 개"로 읽는 경우처럼 실제 읽기와 다를 수 있다.
 */
export function countSyllables(text: string): SyllableCount {
  let count = 0;
  let estimated = false;
  for (const token of text.match(TOKEN_PATTERN) ?? []) {
    if (/^[가-힣]$/.test(token)) {
      count += 1;
    } else if (token === "%") {
      count += 3; // "퍼센트"
      estimated = true;
    } else if (/^\d/.test(token)) {
      const [integerPart = "", fractionPart] = token.replaceAll(",", "").split(".");
      count += readInteger(integerPart).length;
      // 소수는 "점"과 숫자 하나씩으로 읽는다.
      if (fractionPart) count += 1 + fractionPart.length;
      estimated = true;
    } else {
      count += latinSyllables(token);
      estimated = true;
    }
  }
  return { count, estimated };
}

/** 공백과 문장 부호를 뺀 글자에서 이웃한 두 글자의 묶음을 만든다. */
export function characterBigrams(text: string): Set<string> {
  const characters = [...text.replace(/[^\p{L}\p{N}]/gu, "")];
  const bigrams = new Set<string>();
  for (let i = 0; i < characters.length - 1; i += 1) {
    bigrams.add(`${characters[i]}${characters[i + 1]}`);
  }
  return bigrams;
}

/** 두 묶음이 겹치는 비율이다. 0은 겹치지 않음, 1은 같음이다. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return shared / (a.size + b.size - shared);
}

export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

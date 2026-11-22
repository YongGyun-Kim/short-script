import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { KiwiBuilder } from "kiwi-nlp";
import type { TokenInfo } from "kiwi-nlp";
import { kiwiModelDir } from "./kiwi-model.ts";
import { AnalyzerUnavailableError } from "./types.ts";
import type { Analyzer, Token, WordClass } from "./types.ts";

/** 앞에 나온 대상을 가리키는 관형사와 대명사다. */
const DEMONSTRATIVES = new Set([
  "이",
  "그",
  "저",
  "이런",
  "그런",
  "저런",
  "이것",
  "그것",
  "저것",
  "이거",
  "그거",
  "여기",
  "거기",
  "이곳",
  "그곳",
]);

/** Kiwi는 불규칙 활용을 "VA-I"처럼 표시한다. 표시를 떼고 세종 태그만 남긴다. */
function baseTag(tag: string): string {
  return tag.split("-")[0] ?? tag;
}

/**
 * 연결 어미가 절과 절을 잇는지 판단한다.
 * 아래 경우는 한 서술어를 이루는 표현이므로 절을 잇는 것으로 보지 않는다.
 * - 보조 용언 앞의 어미. 예: "만들어 줍니다", "하고 싶다", "하지 않다"
 * - 부사를 만드는 "-게". 예: "빠르게", "살게 되다"
 * - 동사 바로 앞의 "-어". 예: "찾아 갑니다"
 */
function linksClauses(form: string, nextTag: string | undefined): boolean {
  if (nextTag === "VX") return false;
  if (form === "게") return false;
  if (form === "어" && nextTag === "VV") return false;
  return true;
}

function classify(tag: string, form: string, nextTag: string | undefined): WordClass {
  switch (tag) {
    case "NNG":
    case "NNP":
      return "noun";
    case "VV":
      return "verb";
    case "VA":
      return "adjective";
    case "MAG":
      return "adverb";
    case "MAJ":
      return "connective";
    case "EC":
      return linksClauses(form, nextTag) ? "clauseLink" : "other";
    case "MM":
    case "NP":
      return DEMONSTRATIVES.has(form) ? "demonstrative" : "other";
    default:
      return "other";
  }
}

function toToken(info: TokenInfo, next: TokenInfo | undefined): Token {
  const tag = baseTag(info.tag);
  const wordClass = classify(tag, info.str, next ? baseTag(next.tag) : undefined);
  // 동사와 형용사는 어간에 "다"를 붙여 기본형을 만든다.
  const lemma = wordClass === "verb" || wordClass === "adjective" ? `${info.str}다` : info.str;
  return { form: info.str, lemma, tag, wordClass, start: info.position, length: info.length };
}

/** 한국어 형태소 분석기 Kiwi를 불러온다. */
export async function createKiwiAnalyzer(modelDir: string = kiwiModelDir()): Promise<Analyzer> {
  if (!existsSync(join(modelDir, "sj.morph"))) {
    throw new AnalyzerUnavailableError(
      `Kiwi 모델 파일이 없어요: ${modelDir}\n"npm run setup"을 먼저 실행해 주세요.`,
    );
  }

  const wasmPath = join(dirname(fileURLToPath(import.meta.resolve("kiwi-nlp"))), "kiwi-wasm.wasm");
  const builder = await KiwiBuilder.create(wasmPath);

  const modelFiles: Record<string, Uint8Array> = {};
  for (const name of readdirSync(modelDir)) {
    if (name.startsWith(".")) continue;
    modelFiles[name] = new Uint8Array(readFileSync(join(modelDir, name)));
  }
  const kiwi = await builder.build({ modelFiles, modelType: "cong" });

  return {
    language: "ko",
    name: `kiwi-nlp ${builder.version()}`,
    analyze(text) {
      const infos = kiwi.tokenize(text);
      return infos.map((info, index) => toToken(info, infos[index + 1]));
    },
  };
}

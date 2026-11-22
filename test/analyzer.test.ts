import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { loadAnalyzer } from "../src/analyzer/index.ts";
import type { Analyzer, Token, WordClass } from "../src/analyzer/index.ts";
import { kiwiModelDir } from "../src/analyzer/kiwi-model.ts";
import type { ItemId } from "../src/items.ts";
import { judge } from "../src/judge.ts";
import type { JudgeRecord, Measurement } from "../src/record.ts";
import type { JudgeInput, Language } from "../src/schema.ts";

function measurement(record: JudgeRecord, item: ItemId): Measurement {
  const found = record.measurements.find((m) => m.item === item);
  assert.ok(found, `${item} 항목이 기록에 없다`);
  return found;
}

function script(texts: string[], language: Language = "ko"): JudgeInput {
  return {
    scriptId: "test",
    language,
    structure: "basic",
    sentences: texts.map((text, index) => ({
      text,
      type: index === 0 ? "hook" : index === texts.length - 1 ? "cta" : "point",
    })),
  };
}

/**
 * 테스트용 분석기다. "낱말:분류"를 공백으로 이은 문장을 받는다.
 * 분류의 줄임말은 n(명사), c(접속 표현), d(지시어), l(절을 잇는 요소), o(그 밖)다.
 */
const CLASSES: Record<string, WordClass> = {
  n: "noun",
  c: "connective",
  d: "demonstrative",
  l: "clauseLink",
  o: "other",
};

function fakeAnalyzer(language: Language = "ko"): Analyzer {
  return {
    language,
    name: "fake 1.0",
    analyze(text): Token[] {
      let start = 0;
      return text.split(" ").map((word) => {
        const [form = "", code = "o"] = word.split(":");
        const token: Token = {
          form,
          lemma: form,
          tag: code,
          wordClass: CLASSES[code] ?? "other",
          start,
          length: form.length,
        };
        start += word.length + 1;
        return token;
      });
    },
  };
}

test("분석기의 이름을 기록에 남긴다", async () => {
  const record = await judge(script(["요금:n 오른다:o", "확인:n 하세요:o"]), {
    analyzer: fakeAnalyzer(),
  });
  assert.equal(record.analyzer, "fake 1.0");
});

test("분석기의 언어가 대본의 언어와 다르면 오류를 낸다", async () => {
  await assert.rejects(async () =>
    judge(script(["요금:n"], "ko"), { analyzer: fakeAnalyzer("en") }),
  );
});

test("문장별 절의 수를 잰다", async () => {
  const record = await judge(
    script(["요금:n 오른다:o", "요금:n 오르:o 고:l 물가:n 오르:o 지만:l 대책:n 없다:o"]),
    { analyzer: fakeAnalyzer() },
  );
  const oneIdea = measurement(record, "clarity.oneIdea");
  assert.equal(oneIdea.value, 3);
  assert.equal(oneIdea.facts.mostClausesIndex, 1);
  assert.deepEqual(
    oneIdea.sentences.map((s) => s.value),
    [1, 3],
  );
});

test("명사가 연달아 나온 길이를 잰다", async () => {
  const record = await judge(
    script(["요금:n 오른다:o", "가계부:n 자동:n 작성:n 기능:n 을:o 제공:n 한다:o"]),
    { analyzer: fakeAnalyzer() },
  );
  const vocabulary = measurement(record, "clarity.vocabulary");
  assert.equal(vocabulary.value, null);
  assert.equal(vocabulary.facts.longestNounRun, 4);
  assert.equal(vocabulary.facts.longestNounRunIndex, 1);
  assert.equal(vocabulary.facts.longestNounRunWords, "가계부 자동 작성 기능");
});

test("등록된 분석기가 없는 언어는 undefined를 돌려준다", async () => {
  assert.equal(await loadAnalyzer("en"), undefined);
});

// 아래 테스트는 "npm run setup"으로 Kiwi 모델을 내려받은 뒤에만 실행한다.
const kiwiReady = existsSync(join(kiwiModelDir(), "sj.morph"));

test("Kiwi로 한국어 문장을 잰다", { skip: !kiwiReady }, async () => {
  const analyzer = await loadAnalyzer("ko");
  assert.ok(analyzer);
  assert.equal(analyzer.language, "ko");
  assert.match(analyzer.name, /^kiwi-nlp /);

  const record = await judge(
    script([
      "다음 달부터 전기요금이 오릅니다.",
      "요금이 오르고 물가도 올라서 가계 부담이 커졌지만 대책은 아직 없습니다.",
      "이 앱은 영수증 촬영을 통한 가계부 자동 작성 기능을 제공합니다.",
      "AI가 3분 만에 쇼츠를 만들어 줍니다.",
    ]),
    { analyzer },
  );

  // "오르고", "올라서", "커졌지만"이 절을 잇는다. "만들어 줍니다"의 "-어"는 세지 않는다.
  const oneIdea = measurement(record, "clarity.oneIdea");
  assert.deepEqual(
    oneIdea.sentences.map((s) => s.value),
    [1, 4, 1, 1],
  );

  const vocabulary = measurement(record, "clarity.vocabulary");
  assert.equal(vocabulary.facts.longestNounRunWords, "가계부 자동 작성 기능");
});

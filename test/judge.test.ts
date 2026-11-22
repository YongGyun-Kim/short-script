import assert from "node:assert/strict";
import { test } from "node:test";
import { ITEMS } from "../src/items.ts";
import type { ItemId } from "../src/items.ts";
import { judge } from "../src/judge.ts";
import type { JudgeRecord, Measurement } from "../src/record.ts";
import type { JudgeInput, Sentence, StructureId } from "../src/schema.ts";
import { countSyllables, readInteger } from "../src/text.ts";

function sentence(type: string, text: string): Sentence {
  return { text, type };
}

function script(structure: StructureId, sentences: Sentence[]): JudgeInput {
  return { scriptId: "test", language: "ko", structure, sentences };
}

function measurement(record: JudgeRecord, item: ItemId): Measurement {
  const found = record.measurements.find((m) => m.item === item);
  assert.ok(found, `${item} 항목이 기록에 없다`);
  return found;
}

const GOOD_BASIC = script("basic", [
  sentence("hook", "다음 달부터 전기요금이 오릅니다."),
  sentence("point", "하지만 요금제를 바꾸면 가격이 유지됩니다."),
  sentence("cta", "한전 앱에서 요금제를 확인해 보세요."),
]);

test("숫자를 한자어 수사로 읽는다", async () => {
  assert.equal(readInteger("3000"), "삼천");
  assert.equal(readInteger("10000"), "만");
  assert.equal(readInteger("2026"), "이천이십육");
  assert.equal(readInteger("100000000"), "일억");
  assert.equal(readInteger("15"), "십오");
  assert.equal(readInteger("010"), "공일공");
});

test("TTS가 읽는 음절 수를 센다", async () => {
  assert.deepEqual(countSyllables("전기요금이 오릅니다."), { count: 9, estimated: false });
  assert.equal(countSyllables("3천 원").count, 3);
  assert.equal(countSyllables("2026년").count, 6);
  assert.equal(countSyllables("1,234").count, 6);
  assert.equal(countSyllables("3.5%").count, 6);
  assert.equal(countSyllables("AI").count, 4);
  assert.equal(countSyllables("AI").estimated, true);
});

test("기록에는 모든 항목이 정의한 순서대로 들어간다", async () => {
  const record = await judge(GOOD_BASIC, { now: new Date("2026-01-01T00:00:00Z") });
  assert.deepEqual(
    record.measurements.map((m) => m.item),
    ITEMS.map((item) => item.id),
  );
  assert.equal(record.judgedAt, "2026-01-01T00:00:00.000Z");
  // 문장별 음절 수는 14, 18, 15다.
  assert.deepEqual(record.totals, { sentenceCount: 3, syllableCount: 47 });
});

test("연결하지 않은 항목은 재지 않았다고 기록한다", async () => {
  const typeMatch = measurement(await judge(GOOD_BASIC), "structure.typeMatch");
  assert.equal(typeMatch.status, "skipped");
  assert.equal(typeMatch.value, null);
  assert.equal(typeMatch.verdict, "unset");
  assert.ok(typeMatch.skipReason);
});

test("분석기가 없으면 분석기가 필요한 항목을 재지 않는다", async () => {
  const record = await judge(GOOD_BASIC);
  assert.equal(record.analyzer, null);
  for (const item of ["clarity.oneIdea", "clarity.vocabulary"] as const) {
    const skipped = measurement(record, item);
    assert.equal(skipped.status, "skipped", item);
    assert.match(skipped.skipReason ?? "", /형태소 분석기/);
  }
});

test("모델이 없으면 모델이 필요한 항목을 재지 않는다", async () => {
  const record = await judge(GOOD_BASIC);
  assert.equal(record.model, null);
  for (const item of [
    "structure.cohesion",
    "structure.typeMatch",
    "interest.hookQuestion",
    "interest.hookPayoff",
  ] as const) {
    const skipped = measurement(record, item);
    assert.equal(skipped.status, "skipped", item);
    assert.match(skipped.skipReason ?? "", /작은 모델/);
  }
  // 흥미 장치는 모델이 없어도 스크립트로 찾은 장치만으로 잰다.
  const devices = measurement(record, "interest.devices");
  assert.equal(devices.status, "measured");
  assert.equal(devices.facts.impactJudged, false);
});

test("한국어가 아닌 대본은 한국어 측정 규칙을 쓰는 항목을 재지 않는다", async () => {
  const record = await judge({ ...GOOD_BASIC, language: "en" });
  assert.equal(record.language, "en");
  assert.equal(measurement(record, "clarity.sentenceLength").status, "skipped");
  assert.equal(measurement(record, "interest.devices").status, "skipped");
  // 구조 항목은 언어와 관계없이 잰다.
  assert.equal(measurement(record, "structure.requiredSteps").status, "measured");
});

test("구조를 지킨 대본은 구조 항목에서 걸리지 않는다", async () => {
  const record = await judge(GOOD_BASIC);
  for (const item of [
    "format.fields",
    "structure.requiredSteps",
    "structure.stepOrder",
    "structure.openingAndClosing",
  ] as const) {
    assert.equal(measurement(record, item).verdict, "ok", item);
  }
  assert.equal(measurement(record, "structure.openingAndClosing").facts.openingSyllables, 14);
});

test("기준값이 없는 항목은 판정하지 않는다", async () => {
  assert.equal(measurement(await judge(GOOD_BASIC), "clarity.sentenceLength").verdict, "unset");
});

test("빠진 필수 단계를 센다", async () => {
  const record = await judge(
    script("problem-solution", [
      sentence("hook", "매달 전기요금이 부담되시죠?"),
      sentence("solution", "요금제를 바꾸면 됩니다."),
      sentence("cta", "지금 확인해 보세요."),
    ]),
  );
  const required = measurement(record, "structure.requiredSteps");
  assert.equal(required.value, 1);
  assert.equal(required.facts.missingSteps, "문제");
  assert.equal(required.verdict, "flagged");
});

test("순서가 어긋난 문장과 구조에 없는 타입을 센다", async () => {
  const record = await judge(
    script("basic", [
      sentence("hook", "다음 달부터 전기요금이 오릅니다."),
      sentence("cta", "지금 확인해 보세요."),
      sentence("point", "요금제를 바꾸면 가격이 유지됩니다."),
      sentence("result", "요금이 줄었습니다."),
    ]),
  );
  const order = measurement(record, "structure.stepOrder");
  assert.equal(order.value, 2);
  assert.deepEqual(order.facts, { outOfOrder: 1, outsideStructure: 1 });
  assert.deepEqual(
    order.sentences.map((s) => s.index),
    [2, 3],
  );

  const ends = measurement(record, "structure.openingAndClosing");
  assert.equal(ends.value, 1);
  assert.equal(ends.facts.startsWithFirstStep, true);
  assert.equal(ends.facts.endsWithLastStep, false);
});

test("단계별 분량 비율을 음절 수로 잰다", async () => {
  const share = measurement(
    await judge(
      script("basic", [
        sentence("hook", "가나"),
        sentence("point", "가나다라마바"),
        sentence("cta", "가나"),
      ]),
    ),
    "structure.timeShare",
  );
  assert.equal(share.value, 0.6);
  assert.equal(share.facts.topStep, "본문");
  assert.equal(share.facts["share.훅"], 0.2);
});

test("유효하지 않은 값을 센다", async () => {
  const fields = measurement(
    await judge(
      script("basic", [
        sentence("hook", "다음 달부터 전기요금이 오릅니다."),
        sentence("intro", ""),
        sentence("cta", "지금 확인해 보세요."),
      ]),
    ),
    "format.fields",
  );
  assert.equal(fields.value, 1);
  assert.equal(fields.sentences[0]?.index, 1);
  assert.equal(fields.sentences[0]?.value, 2);
  assert.equal(fields.verdict, "flagged");
});

test("TTS가 잘못 읽는 표기를 세고 URL 안의 기호는 다시 세지 않는다", async () => {
  const notation = measurement(
    await judge(
      script("basic", [
        sentence("hook", "AI(인공지능)가 바꿉니다."),
        sentence("point", "자세한 내용은 https://example.com/a_b#c 에 있습니다."),
        sentence("cta", "지금 확인해 보세요."),
      ]),
    ),
    "format.ttsNotation",
  );
  assert.equal(notation.value, 3);
  assert.deepEqual(notation.facts, { url: 1, bracket: 1, emoji: 0, symbol: 0, acronym: 1 });
});

test("문장별 음절 수를 잰다", async () => {
  const record = await judge(
    script("basic", [
      sentence("hook", "가나다라마바사아자차"),
      sentence("point", "가나다라마바"),
      sentence("cta", "가나다"),
    ]),
  );
  const length = measurement(record, "clarity.sentenceLength");
  assert.equal(length.value, 10);
  assert.equal(length.facts.longestIndex, 0);
  assert.equal(length.facts.meanSyllables, 6.3);
});

test("문장별 흥미 장치와 장치 없는 구간을 잰다", async () => {
  const record = await judge(
    script("basic", [
      sentence("hook", "전기요금이 왜 오를까요?"),
      sentence("context", "요금이 조정됩니다."),
      sentence("point", "요금제는 여러 가지입니다."),
      sentence("point", "하지만 가구의 30퍼센트만 요금제를 바꿉니다."),
      sentence("cta", "요금제를 확인해 보세요."),
    ]),
  );
  const devices = measurement(record, "interest.devices");
  assert.equal(devices.value, 0.4);
  assert.equal(devices.facts.questionCount, 1);
  assert.equal(devices.facts.contrastCount, 1);
  assert.equal(devices.facts.specificCount, 1);
  assert.equal(devices.sentences[3]?.value, 2);

  const gap = measurement(record, "interest.deviceGap");
  // 1번(8음절)과 2번(11음절)에 흥미 장치가 없다.
  assert.equal(gap.value, 19);
  assert.equal(gap.facts.gapStartIndex, 1);
  assert.equal(gap.facts.gapEndIndex, 2);
});

test("예고와 감탄 표현이 있는 문장을 세고 훅은 세지 않는다", async () => {
  const empty = measurement(
    await judge(
      script("basic", [
        sentence("hook", "지금부터 알아보겠습니다."),
        sentence("context", "지금부터 하나씩 알아보겠습니다."),
        sentence("point", "정말 놀랍습니다."),
        sentence("point", "요금제를 바꾸면 가격이 유지됩니다."),
        sentence("cta", "지금 확인해 보세요."),
      ]),
    ),
    "interest.emptySentences",
  );
  assert.equal(empty.value, 2);
  assert.deepEqual(
    empty.sentences.map((s) => s.index),
    [1, 2],
  );
});

test("같은 문장이 두 번 나오면 겹침 비율이 1이다", async () => {
  const repetition = measurement(
    await judge(
      script("basic", [
        sentence("hook", "다음 달부터 전기요금이 오릅니다."),
        sentence("point", "배송이 하루 만에 옵니다."),
        sentence("point", "배송이 하루 만에 옵니다."),
        sentence("cta", "지금 확인해 보세요."),
      ]),
    ),
    "interest.repetition",
  );
  assert.equal(repetition.value, 1);
  assert.equal(repetition.facts.pairFirstIndex, 1);
  assert.equal(repetition.facts.pairSecondIndex, 2);
});

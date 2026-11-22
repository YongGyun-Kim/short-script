import assert from "node:assert/strict";
import { test } from "node:test";
import type { Analyzer, Token } from "../src/analyzer/index.ts";
import type { ItemId } from "../src/items.ts";
import { judge } from "../src/judge.ts";
import type { JsonRequest, ModelClient } from "../src/model/index.ts";
import { ReviewFormatError, buildReviewRequest, parseReview } from "../src/model/review.ts";
import type { JudgeRecord, Measurement } from "../src/record.ts";
import type { JudgeInput } from "../src/schema.ts";
import { STRUCTURES } from "../src/structures.ts";

function measurement(record: JudgeRecord, item: ItemId): Measurement {
  const found = record.measurements.find((m) => m.item === item);
  assert.ok(found, `${item} 항목이 기록에 없다`);
  return found;
}

function script(sentences: [type: string, text: string][]): JudgeInput {
  return {
    scriptId: "test",
    language: "ko",
    structure: "basic",
    sentences: sentences.map(([type, text]) => ({ text, type })),
  };
}

/** 테스트용 분석기다. "그"는 지시어로 보고 나머지는 그 밖의 낱말로 본다. */
const analyzer: Analyzer = {
  language: "ko",
  name: "fake 1.0",
  analyze(text): Token[] {
    return text.split(" ").map((form, index) => ({
      form,
      lemma: form,
      tag: "",
      wordClass: form === "그" ? "demonstrative" : "other",
      start: index,
      length: form.length,
    }));
  },
};

/** 테스트용 모델이다. 받은 요청을 기억하고, 정해 준 답을 차례로 돌려준다. */
function fakeModel(...answers: (object | string | Error)[]) {
  const requests: JsonRequest[] = [];
  const client: ModelClient = {
    name: "fake-model 1.0",
    async generateJson(request) {
      requests.push(request);
      const answer = answers[Math.min(requests.length - 1, answers.length - 1)];
      if (answer instanceof Error) throw answer;
      return {
        content: typeof answer === "string" ? answer : JSON.stringify(answer),
        usage: { promptTokens: 600, outputTokens: 100, durationMs: 1500 },
      };
    },
  };
  return { client, requests };
}

const SCRIPT = script([
  ["hook", "요금 왜 오를까요?"],
  ["point", "요금 3천 원 오릅니다."],
  ["point", "신청은 금방 끝납니다."],
  ["point", "그 방법은 쉽습니다."],
  ["cta", "지금 확인해 보세요."],
]);

/** SCRIPT에 대한 모델의 답이다. 기본 3단 구조의 단계 이름은 훅, 본문, 끝맺음이다. */
const REVIEW = {
  steps: ["훅", "본문", "끝맺음", "본문", "끝맺음"],
  topicBreaks: [2],
  impactSentences: [2],
  unclearReferences: [3, 4],
  hookHasContent: true,
  hookPaidOff: false,
};

test("모델을 대본 하나에 한 번만 부르고 사용량을 남긴다", async () => {
  const model = fakeModel(REVIEW);
  const record = await judge(SCRIPT, { analyzer, model: model.client });
  assert.equal(model.requests.length, 1);
  assert.equal(record.model, "fake-model 1.0");
  assert.deepEqual(record.modelUsage, {
    calls: 1,
    promptTokens: 600,
    outputTokens: 100,
    durationMs: 1500,
    succeeded: true,
  });
});

test("모델에 대본 전체와 구조의 단계를 보낸다", () => {
  const request = buildReviewRequest(
    STRUCTURES.basic,
    SCRIPT.sentences.map((s) => s.text),
  );
  assert.match(request.prompt, /\[0\] 요금 왜 오를까요\?/);
  assert.match(request.prompt, /\[4\] 지금 확인해 보세요\./);
  assert.match(request.prompt, /0\. 훅:/);
  assert.match(request.prompt, /2\. 끝맺음 \(없어도 됨\):/);
  assert.match(request.prompt, /문장 수 5개/);
});

test("라벨의 단계와 모델이 고른 단계가 다른 문장을 센다", async () => {
  const record = await judge(SCRIPT, { analyzer, model: fakeModel(REVIEW).client });
  const typeMatch = measurement(record, "structure.typeMatch");
  assert.equal(typeMatch.value, 1);
  assert.equal(typeMatch.facts.comparedSentences, 5);
  assert.equal(typeMatch.sentences[0]?.index, 2);
  assert.match(typeMatch.sentences[0]?.note ?? "", /"본문" 단계인데 모델은 "끝맺음" 단계/);
});

test("모델이 화제가 끊긴다고 본 문장을 센다", async () => {
  const record = await judge(SCRIPT, { analyzer, model: fakeModel(REVIEW).client });
  const cohesion = measurement(record, "structure.cohesion");
  assert.equal(cohesion.value, 1);
  assert.equal(cohesion.sentences[0]?.index, 2);
});

test("지시어가 있는 문장만 대상이 불분명하다고 센다", async () => {
  const record = await judge(SCRIPT, { analyzer, model: fakeModel(REVIEW).client });
  const reference = measurement(record, "clarity.reference");
  // 모델은 3번과 4번을 짚었지만 지시어 "그"가 있는 문장은 3번뿐이다.
  assert.equal(reference.value, 1);
  assert.equal(reference.sentences[0]?.index, 3);
  assert.deepEqual(reference.facts, { sentencesWithDemonstratives: 1, ignoredModelFlags: 1 });
});

test("모델이 영향이 있다고 본 문장을 흥미 장치에 더한다", async () => {
  const record = await judge(SCRIPT, { analyzer, model: fakeModel(REVIEW).client });
  const devices = measurement(record, "interest.devices");
  // 0번은 질문, 1번은 숫자, 2번은 모델이 본 영향이다. 3번과 4번에는 장치가 없다.
  assert.equal(devices.value, 0.6);
  assert.equal(devices.facts.impactCount, 1);
  assert.equal(devices.facts.impactJudged, true);
  assert.equal(devices.sentences[2]?.note, "시청자에게 미치는 영향");

  const gap = measurement(record, "interest.deviceGap");
  // 3번(8음절)과 4번(8음절)에 흥미 장치가 없다.
  assert.equal(gap.value, 16);
  assert.equal(gap.facts.gapStartIndex, 3);
});

test("훅의 내용과 해소를 모델 판단으로 기록한다", async () => {
  const record = await judge(SCRIPT, { analyzer, model: fakeModel(REVIEW).client });
  assert.equal(measurement(record, "interest.hookQuestion").value, 1);
  assert.equal(measurement(record, "interest.hookPayoff").value, 0);
});

test("훅 뒤에 문장이 없으면 해소를 재지 않는다", async () => {
  const model = fakeModel({
    ...REVIEW,
    steps: ["훅"],
    topicBreaks: [],
    impactSentences: [],
    unclearReferences: [],
  });
  const record = await judge(script([["hook", "요금 왜 오를까요?"]]), { model: model.client });
  assert.equal(measurement(record, "interest.hookPayoff").value, null);
});

test("답의 형식이 틀리면 한 번 더 부른다", async () => {
  const model = fakeModel("[1, 2, 3]", REVIEW);
  const record = await judge(SCRIPT, { analyzer, model: model.client });
  assert.equal(model.requests.length, 2);
  assert.equal(record.modelUsage?.calls, 2);
  assert.equal(record.modelUsage?.promptTokens, 1200);
  assert.equal(measurement(record, "structure.typeMatch").status, "measured");
});

test("두 번 모두 형식이 틀리면 모델 판단이 필요한 항목만 건너뛴다", async () => {
  const model = fakeModel({ ...REVIEW, steps: ["훅"] });
  const record = await judge(SCRIPT, { analyzer, model: model.client });
  assert.equal(model.requests.length, 2);
  assert.equal(record.modelUsage?.succeeded, false);

  const typeMatch = measurement(record, "structure.typeMatch");
  assert.equal(typeMatch.status, "skipped");
  assert.match(typeMatch.skipReason ?? "", /모델 판단을 받지 못했다: 답의 형식이 2번 모두 틀렸다/);
  // 흥미 장치는 스크립트로 찾은 장치만으로 잰다.
  const devices = measurement(record, "interest.devices");
  assert.equal(devices.status, "measured");
  assert.equal(devices.facts.impactJudged, false);
  // 스크립트 항목은 그대로 잰다.
  assert.equal(measurement(record, "structure.stepOrder").status, "measured");
});

test("모델 호출 자체가 실패하면 다시 부르지 않는다", async () => {
  const model = fakeModel(new Error("연결이 끊겼다"));
  const record = await judge(SCRIPT, { analyzer, model: model.client });
  assert.equal(model.requests.length, 1);
  assert.match(
    measurement(record, "interest.hookQuestion").skipReason ?? "",
    /모델 판단을 받지 못했다: 연결이 끊겼다/,
  );
});

test("모델의 답을 읽고 형식이 틀린 답을 거른다", () => {
  const structure = STRUCTURES.basic;
  const review = parseReview(JSON.stringify({ ...REVIEW, topicBreaks: [3, 2, 2] }), structure, 5);
  assert.deepEqual(review.steps, [0, 1, 2, 1, 2]);
  assert.deepEqual(review.topicBreaks, [2, 3]);

  const cases = [
    "yes",
    JSON.stringify([REVIEW]),
    JSON.stringify({ ...REVIEW, steps: ["훅", "본문"] }),
    JSON.stringify({ ...REVIEW, steps: ["훅", "본문", "결과", "본문", "끝맺음"] }),
    JSON.stringify({ ...REVIEW, topicBreaks: [9] }),
    JSON.stringify({ ...REVIEW, hookPaidOff: "no" }),
  ];
  for (const content of cases) {
    assert.throws(() => parseReview(content, structure, 5), ReviewFormatError, content);
  }
});

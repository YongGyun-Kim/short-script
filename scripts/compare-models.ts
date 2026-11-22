/**
 * Ollama 모델 후보에게 예시 대본을 하나씩 보내서 대본 단위 판단을 비교한다.
 * 판정기가 쓰는 요청(src/model/review.ts)을 그대로 쓴다.
 *
 * 사용법: node scripts/compare-models.ts <모델> [<모델> ...]
 * 모델 이름 뒤에 "=low"를 붙이면 생각 단계를 그 수준으로 켠다. 예: gpt-oss:20b=low
 *
 * 대본마다 두 번 보내서 답이 같은지도 본다. 결과는 표준 출력에 쓴다.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadModel } from "../src/model/index.ts";
import { ReviewFailedError, buildReviewRequest, parseReview } from "../src/model/review.ts";
import type { ScriptReview } from "../src/model/review.ts";
import { JudgeInputSchema } from "../src/schema.ts";
import type { JudgeInput } from "../src/schema.ts";
import { STRUCTURES, stepIndexOf } from "../src/structures.ts";

const SCRIPT_DIR = "examples/scripts";

interface Attempt {
  review: ScriptReview | null;
  error: string;
  durationMs: number;
  promptTokens: number;
  outputTokens: number;
}

function loadScripts(): { file: string; input: JudgeInput }[] {
  return readdirSync(SCRIPT_DIR)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => ({
      file,
      input: JudgeInputSchema.parse(JSON.parse(readFileSync(join(SCRIPT_DIR, file), "utf8"))),
    }));
}

/** 다시 부르지 않고 한 번만 보낸다. 첫 답의 형식이 맞는지 보려는 것이다. */
async function askOnce(
  model: Awaited<ReturnType<typeof loadModel>>,
  input: JudgeInput,
): Promise<Attempt> {
  const structure = STRUCTURES[input.structure];
  const texts = input.sentences.map((sentence) => sentence.text);
  const response = await model.generateJson(buildReviewRequest(structure, texts));
  const base = { ...response.usage, review: null, error: "" };
  try {
    return { ...base, review: parseReview(response.content, structure, texts.length) };
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) };
  }
}

function list(values: number[]): string {
  return `[${values.join(",")}]`;
}

async function evaluate(spec: string): Promise<void> {
  const model = await loadModel(spec);
  const scripts = loadScripts();

  // 첫 요청은 모델을 메모리에 올리는 시간이 들어가므로 시간을 재기 전에 한 번 보낸다.
  const first = scripts[0];
  if (first) await askOnce(model, first.input).catch(() => undefined);

  console.log(`\n##### ${model.name}${spec.includes("=") ? ` (think=${spec.split("=")[1]})` : ""}`);
  let formatErrors = 0;
  let mismatches = 0;
  let compared = 0;
  let unstable = 0;
  let durationMs = 0;
  let promptTokens = 0;
  let outputTokens = 0;

  for (const { file, input } of scripts) {
    const first = await askOnce(model, input);
    const second = await askOnce(model, input);
    durationMs += first.durationMs;
    promptTokens += first.promptTokens;
    outputTokens += first.outputTokens;
    if (JSON.stringify(first.review) !== JSON.stringify(second.review)) unstable += 1;

    if (!first.review) {
      formatErrors += 1;
      console.log(`${file} | 형식 오류: ${first.error}`);
      continue;
    }
    const structure = STRUCTURES[input.structure];
    const labelSteps = input.sentences.map((sentence) => stepIndexOf(structure, sentence.type));
    const differs = labelSteps
      .map((step, index) => (step !== -1 && first.review?.steps[index] !== step ? index : -1))
      .filter((index) => index !== -1);
    compared += labelSteps.filter((step) => step !== -1).length;
    mismatches += differs.length;
    const r = first.review;
    console.log(
      [
        file,
        `${(first.durationMs / 1000).toFixed(2)}초`,
        `라벨과 다른 단계 ${list(differs)}`,
        `화제 끊김 ${list(r.topicBreaks)}`,
        `영향 ${list(r.impactSentences)}`,
        `지시어 ${list(r.unclearReferences)}`,
        `훅 내용 ${r.hookHasContent}`,
        `훅 해소 ${r.hookPaidOff}`,
      ].join(" | "),
    );
  }

  console.log(
    [
      `대본 ${scripts.length}개`,
      `첫 답의 형식 오류 ${formatErrors}`,
      `라벨과 다른 단계 ${mismatches}/${compared}문장`,
      `두 번 보낸 답이 다른 대본 ${unstable}`,
      `대본당 ${(durationMs / scripts.length / 1000).toFixed(2)}초`,
      `입력 토큰 ${promptTokens}`,
      `출력 토큰 ${outputTokens}`,
    ].join(" | "),
  );
}

const specs = process.argv.slice(2);
if (specs.length === 0) {
  console.error("사용법: node scripts/compare-models.ts <모델> [<모델> ...]");
  process.exitCode = 1;
} else {
  for (const spec of specs) {
    try {
      await evaluate(spec);
    } catch (error) {
      const message =
        error instanceof ReviewFailedError || error instanceof Error
          ? error.message
          : String(error);
      console.log(`\n##### ${spec} 실패: ${message}`);
    }
  }
}

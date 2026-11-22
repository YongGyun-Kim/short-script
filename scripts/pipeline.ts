/**
 * 대본 하나로 단위 테스트부터 모델 판단까지 차례로 돌리고, 결과를 JSON 파일 하나로 쓴다.
 *
 * 사용법: node scripts/pipeline.ts <대본.json> [--out <결과.json>] [--model <이름>]
 *
 * 단계는 네 개다.
 * 1. 단위 테스트: 판정기의 측정 함수가 정의대로 동작하는지 확인한다.
 * 2. 입력 검사: 대본 파일의 형식을 확인한다.
 * 3. 도구 준비: 형태소 분석기(Kiwi)와 Ollama 모델을 불러온다.
 * 4. 판정: 스크립트 항목을 재고, 모델에 대본 전체를 한 번 보내 모델 판단 항목을 잰다.
 *
 * 한 단계가 실패하면 뒤 단계는 건너뛰고, 거기까지의 결과를 파일에 쓴다.
 * 결과 파일을 지정하지 않으면 results/<scriptId>.json에 쓴다.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAnalyzer } from "../src/analyzer/index.ts";
import type { Analyzer } from "../src/analyzer/index.ts";
import { judge } from "../src/judge.ts";
import { DEFAULT_MODEL, loadModel } from "../src/model/index.ts";
import type { ModelClient } from "../src/model/index.ts";
import type { JudgeRecord } from "../src/record.ts";
import { JudgeInputSchema } from "../src/schema.ts";
import type { JudgeInput } from "../src/schema.ts";
import { parseTapSummary } from "../src/test-report.ts";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

type StepId = "unitTests" | "input" | "tools" | "judge";

interface StepResult {
  id: StepId;
  name: string;
  /** passed는 통과, failed는 실패, skipped는 앞 단계가 실패해서 돌리지 않았다는 뜻이다. */
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  detail: Record<string, unknown>;
  error?: string;
}

/** 파이프라인 결과 파일의 형식이다. */
interface PipelineResult {
  scriptFile: string;
  ranAt: string;
  /** 네 단계가 모두 통과했으면 true다. */
  succeeded: boolean;
  steps: StepResult[];
  /** 판정 기록이다. 판정 단계까지 가지 못했으면 null이다. */
  record: JudgeRecord | null;
}

const STEP_NAMES: Record<StepId, string> = {
  unitTests: "단위 테스트",
  input: "입력 검사",
  tools: "도구 준비",
  judge: "판정",
};

const USAGE = [
  "사용법: node scripts/pipeline.ts <대본.json> [옵션]",
  "  --out <결과.json>  결과를 쓸 파일이에요. 없으면 results/<scriptId>.json에 써요.",
  `  --model <이름>     Ollama 모델을 정해요. 기본값은 ${DEFAULT_MODEL}이에요.`,
].join("\n");

function takeOption(args: string[], name: string): string | null | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  args.splice(index, 2);
  return value ?? null;
}

/** 단계 하나를 돌리고 걸린 시간과 결과를 남긴다. 실패하면 error에 이유를 남긴다. */
async function runStep(
  id: StepId,
  body: () => Promise<{ detail: Record<string, unknown>; error?: string }>,
): Promise<StepResult> {
  const started = performance.now();
  let detail: Record<string, unknown> = {};
  let error: string | undefined;
  try {
    ({ detail, error } = await body());
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  const durationMs = Math.round(performance.now() - started);
  const status = error === undefined ? "passed" : "failed";
  console.error(
    `[${STEP_NAMES[id]}] ${status === "passed" ? "통과했어요" : "실패했어요"} (${(durationMs / 1000).toFixed(1)}초)${error ? `\n  ${error}` : ""}`,
  );
  return { id, name: STEP_NAMES[id], status, durationMs, detail, ...(error ? { error } : {}) };
}

function skippedStep(id: StepId): StepResult {
  return { id, name: STEP_NAMES[id], status: "skipped", durationMs: 0, detail: {} };
}

async function main(argv: string[]): Promise<number> {
  const args = [...argv];
  const outOption = takeOption(args, "--out");
  const modelSpec = takeOption(args, "--model");
  const scriptFile = args[0];
  if (!scriptFile || outOption === null || modelSpec === null) {
    console.error(USAGE);
    return 1;
  }

  const result: PipelineResult = {
    scriptFile,
    ranAt: new Date().toISOString(),
    succeeded: false,
    steps: [],
    record: null,
  };
  const order: StepId[] = ["unitTests", "input", "tools", "judge"];
  let input: JudgeInput | undefined;
  let analyzer: Analyzer | undefined;
  let model: ModelClient | undefined;

  const steps: Record<StepId, () => Promise<{ detail: Record<string, unknown>; error?: string }>> =
    {
      unitTests: async () => {
        const run = spawnSync(
          process.execPath,
          ["--test", "--test-reporter=tap", "test/**/*.test.ts"],
          { cwd: PROJECT_ROOT, encoding: "utf8" },
        );
        const summary = parseTapSummary(run.stdout ?? "");
        const failed = run.status !== 0 || summary.fail > 0 || summary.tests === 0;
        return {
          detail: { ...summary },
          ...(failed
            ? { error: `단위 테스트 ${summary.tests}개 중 ${summary.fail}개가 실패했어요.` }
            : {}),
        };
      },
      input: async () => {
        let raw: unknown;
        try {
          raw = JSON.parse(readFileSync(scriptFile, "utf8"));
        } catch {
          return { detail: {}, error: `대본 파일을 읽지 못했어요: ${scriptFile}` };
        }
        const parsed = JudgeInputSchema.safeParse(raw);
        if (!parsed.success) {
          const issues = parsed.error.issues.map(
            (issue) => `${issue.path.join(".")}: ${issue.message}`,
          );
          return { detail: { issues }, error: "대본의 형식이 맞지 않아요." };
        }
        input = parsed.data;
        return {
          detail: {
            scriptId: input.scriptId,
            language: input.language,
            structure: input.structure,
            sentenceCount: input.sentences.length,
          },
        };
      },
      tools: async () => {
        if (!input) throw new Error("입력이 없어요.");
        analyzer = await loadAnalyzer(input.language);
        model = await loadModel(modelSpec);
        return { detail: { analyzer: analyzer?.name ?? null, model: model.name } };
      },
      judge: async () => {
        if (!input) throw new Error("입력이 없어요.");
        const record = await judge(input, {
          ...(analyzer ? { analyzer } : {}),
          ...(model ? { model } : {}),
        });
        result.record = record;
        const flagged = record.measurements.filter((m) => m.verdict === "flagged");
        const skipped = record.measurements.filter((m) => m.status === "skipped");
        const detail = {
          modelUsage: record.modelUsage,
          measuredItems: record.measurements.length - skipped.length,
          skippedItems: skipped.map((m) => m.item),
          flaggedItems: flagged.map((m) => m.item),
        };
        if (record.modelUsage && !record.modelUsage.succeeded) {
          const reason = skipped.find((m) => m.skipReason)?.skipReason ?? "";
          return { detail, error: `모델 판단을 받지 못했어요. ${reason}` };
        }
        return { detail };
      },
    };

  for (const id of order) {
    const previousFailed = result.steps.some((step) => step.status !== "passed");
    result.steps.push(previousFailed ? skippedStep(id) : await runStep(id, steps[id]));
  }
  result.succeeded = result.steps.every((step) => step.status === "passed");

  const name = input?.scriptId ?? basename(scriptFile, ".json");
  const outPath = outOption ?? join("results", `${name}.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
  console.error(`결과를 썼어요: ${outPath}`);
  return result.succeeded ? 0 : 1;
}

process.exitCode = await main(process.argv.slice(2));

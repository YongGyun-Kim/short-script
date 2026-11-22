/**
 * 예시 대본을 모두 판정하고, 대본 파일의 _expected에 적은 기대와 측정값을 대조한다.
 * 판정기가 의도대로 동작하는지 확인하는 용도다.
 *
 * 사용법: node scripts/check-samples.ts [--records <기록.json>]
 * --records를 주면 대본 12개의 판정 기록을 JSON 배열 파일 하나로 쓴다.
 * 형태소 분석기와 기본 모델을 모두 연결해서 잰다.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadAnalyzer } from "../src/analyzer/index.ts";
import type { ItemId } from "../src/items.ts";
import { judge } from "../src/judge.ts";
import { loadModel } from "../src/model/index.ts";
import type { JudgeRecord } from "../src/record.ts";
import { JudgeInputSchema } from "../src/schema.ts";

const SCRIPT_DIR = "examples/scripts";

/** 대본 파일에 적는 기대다. 조건은 하나 이상 적는다. */
interface Expectation {
  item: ItemId;
  /** 측정값이 이 값과 같아야 한다. */
  equals?: number;
  /** 측정값이 이 값 이상이어야 한다. */
  min?: number;
  /** 측정값이 이 값 이하여야 한다. */
  max?: number;
  /** 이 문장들이 모두 짚혀야 한다. */
  includes?: number[];
  /** 이 문장들은 짚히지 않아야 한다. */
  excludes?: number[];
  /** 기대한 이유다. */
  why: string;
}

function check(record: JudgeRecord, expectation: Expectation): { pass: boolean; actual: string } {
  const m = record.measurements.find((item) => item.item === expectation.item);
  if (!m || m.status === "skipped") return { pass: false, actual: `재지 않음 (${m?.skipReason})` };
  const flagged = m.sentences.filter((s) => s.value > 0).map((s) => s.index);
  const value = m.value;
  const actual = `값 ${value}, 짚은 문장 [${flagged.join(",")}]`;

  let pass = true;
  if (expectation.equals !== undefined) pass &&= value === expectation.equals;
  if (expectation.min !== undefined) pass &&= value !== null && value >= expectation.min;
  if (expectation.max !== undefined) pass &&= value !== null && value <= expectation.max;
  if (expectation.includes) pass &&= expectation.includes.every((i) => flagged.includes(i));
  if (expectation.excludes) pass &&= expectation.excludes.every((i) => !flagged.includes(i));
  return { pass, actual };
}

function describe(expectation: Expectation): string {
  const parts: string[] = [];
  if (expectation.equals !== undefined) parts.push(`= ${expectation.equals}`);
  if (expectation.min !== undefined) parts.push(`>= ${expectation.min}`);
  if (expectation.max !== undefined) parts.push(`<= ${expectation.max}`);
  if (expectation.includes) parts.push(`[${expectation.includes.join(",")}] 짚음`);
  if (expectation.excludes) parts.push(`[${expectation.excludes.join(",")}] 안 짚음`);
  return parts.join(", ");
}

async function main(argv: string[]): Promise<number> {
  const recordsIndex = argv.indexOf("--records");
  const recordsPath = recordsIndex === -1 ? undefined : argv[recordsIndex + 1];

  const analyzer = await loadAnalyzer("ko");
  const model = await loadModel();
  const files = readdirSync(SCRIPT_DIR)
    .filter((file) => file.endsWith(".json"))
    .sort();

  const records: JudgeRecord[] = [];
  let passed = 0;
  let total = 0;
  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(SCRIPT_DIR, file), "utf8")) as {
      _expected?: Expectation[];
    };
    const record = await judge(JudgeInputSchema.parse(raw), {
      ...(analyzer ? { analyzer } : {}),
      model,
    });
    records.push(record);

    const usage = record.modelUsage;
    console.log(
      `\n${file} | 모델 ${usage?.calls ?? 0}번, ${((usage?.durationMs ?? 0) / 1000).toFixed(2)}초, 입력 ${usage?.promptTokens ?? 0} 출력 ${usage?.outputTokens ?? 0} 토큰`,
    );
    for (const expectation of raw._expected ?? []) {
      const { pass, actual } = check(record, expectation);
      total += 1;
      if (pass) passed += 1;
      console.log(
        `  ${pass ? "통과" : "실패"} | ${expectation.item} ${describe(expectation)} | ${actual} | ${expectation.why}`,
      );
    }
  }

  console.log(`\n기대 ${total}개 중 ${passed}개 통과`);
  if (recordsPath) {
    writeFileSync(recordsPath, `${JSON.stringify(records, null, 2)}\n`);
    console.log(`기록을 썼어요: ${recordsPath}`);
  }
  return 0;
}

process.exitCode = await main(process.argv.slice(2));

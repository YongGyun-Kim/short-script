import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { AnalyzerUnavailableError, loadAnalyzer } from "./analyzer/index.ts";
import type { Analyzer } from "./analyzer/index.ts";
import { judge } from "./judge.ts";
import { DEFAULT_MODEL, ModelUnavailableError, loadModel } from "./model/index.ts";
import type { ModelClient } from "./model/index.ts";
import { JudgeInputSchema } from "./schema.ts";

const USAGE = [
  "사용법: node src/cli.ts <대본.json> [옵션]",
  "  --out <기록.json>     기록을 JSON 파일 하나로 써요. 같은 파일이 있으면 덮어써요.",
  `  --model <이름>         Ollama 모델을 정해요. 기본값은 ${DEFAULT_MODEL}이에요.`,
  "  --no-model             작은 모델 없이 재요. 모델 판단이 필요한 항목은 재지 않아요.",
  "  --no-analyzer          형태소 분석기 없이 재요. 분석기가 필요한 항목은 재지 않아요.",
].join("\n");

/** 값이 없는 옵션을 찾아서 지우고, 있었는지를 돌려준다. */
function takeFlag(args: string[], name: string): boolean {
  const index = args.indexOf(name);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

/** 값이 있는 옵션을 찾아서 지우고, 값을 돌려준다. 값이 빠졌으면 null을 돌려준다. */
function takeOption(args: string[], name: string): string | null | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  args.splice(index, 2);
  return value ?? null;
}

async function main(argv: string[]): Promise<number> {
  const args = [...argv];
  const useAnalyzer = !takeFlag(args, "--no-analyzer");
  const useModel = !takeFlag(args, "--no-model");
  const outPath = takeOption(args, "--out");
  const modelSpec = takeOption(args, "--model");
  const inputPath = args[0];
  if (!inputPath || outPath === null || modelSpec === null) {
    console.error(USAGE);
    return 1;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(inputPath, "utf8"));
  } catch {
    console.error(`대본 파일을 읽지 못했어요: ${inputPath}`);
    return 1;
  }

  const parsed = JudgeInputSchema.safeParse(raw);
  if (!parsed.success) {
    console.error("대본의 형식이 맞지 않아요.");
    for (const issue of parsed.error.issues) {
      console.error(`- ${issue.path.join(".")}: ${issue.message}`);
    }
    return 1;
  }

  let analyzer: Analyzer | undefined;
  if (useAnalyzer) {
    try {
      analyzer = await loadAnalyzer(parsed.data.language);
    } catch (error) {
      if (!(error instanceof AnalyzerUnavailableError)) throw error;
      console.error(error.message);
      console.error("분석기 없이 재려면 --no-analyzer를 붙여 주세요.");
      return 1;
    }
  }

  let model: ModelClient | undefined;
  if (useModel) {
    try {
      model = await loadModel(modelSpec);
    } catch (error) {
      if (!(error instanceof ModelUnavailableError)) throw error;
      console.error(error.message);
      console.error("모델 없이 재려면 --no-model을 붙여 주세요.");
      return 1;
    }
  }

  const record = await judge(parsed.data, {
    ...(analyzer ? { analyzer } : {}),
    ...(model ? { model } : {}),
  });
  const json = `${JSON.stringify(record, null, 2)}\n`;
  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, json);
    console.error(`기록을 썼어요: ${outPath}`);
  } else {
    process.stdout.write(json);
  }
  return 0;
}

process.exitCode = await main(process.argv.slice(2));

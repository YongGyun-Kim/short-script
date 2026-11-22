import { createOllamaClient } from "./ollama.ts";
import type { OllamaOptions } from "./ollama.ts";
import type { ModelClient } from "./types.ts";

export { ModelUnavailableError } from "./types.ts";
export type { JsonRequest, JsonResponse, ModelClient, ModelUsage } from "./types.ts";

/**
 * 판정기가 기본으로 쓰는 Ollama 모델이다.
 * 환경 변수 JUDGE_MODEL이나 --model 옵션으로 바꿀 수 있다.
 * 고른 근거는 docs/model-comparison.md에 있다.
 */
export const DEFAULT_MODEL = "gemma4:e4b";

/**
 * 모델을 불러온다. 모델은 "이름" 또는 "이름=생각 단계"로 적는다.
 * 예: "gemma4:e4b", "gpt-oss:20b=low"
 */
export async function loadModel(
  spec: string = process.env.JUDGE_MODEL ?? DEFAULT_MODEL,
): Promise<ModelClient> {
  const [model = "", think] = spec.split("=");
  return createOllamaClient({
    model,
    ...(think ? { think: think as NonNullable<OllamaOptions["think"]> } : {}),
  });
}

import { ModelUnavailableError } from "./types.ts";
import type { JsonRequest, JsonResponse, ModelClient } from "./types.ts";

export interface OllamaOptions {
  /** Ollama 모델의 이름과 태그다. 예: "gemma4:e4b" */
  model: string;
  /** Ollama 서버의 주소다. */
  host?: string;
  /**
   * 생각 단계의 설정이다. 기본값 false는 생각 단계를 끈다.
   * 생각 단계를 끌 수 없는 모델은 "low"처럼 단계를 정한다.
   */
  think?: boolean | "low" | "medium" | "high";
}

export const DEFAULT_OLLAMA_HOST = "http://localhost:11434";

interface TagsResponse {
  models?: { name: string; digest: string }[];
}

interface ChatResponse {
  message?: { content?: string };
  error?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  /** 나노초 단위다. */
  total_duration?: number;
}

/** 로컬 Ollama 서버의 모델을 쓰는 클라이언트를 만든다. */
export async function createOllamaClient(options: OllamaOptions): Promise<ModelClient> {
  const host = options.host ?? process.env.OLLAMA_HOST_URL ?? DEFAULT_OLLAMA_HOST;
  const think = options.think ?? false;

  let tags: TagsResponse;
  try {
    tags = (await (await fetch(`${host}/api/tags`)).json()) as TagsResponse;
  } catch {
    throw new ModelUnavailableError(
      `Ollama 서버에 연결하지 못했어요: ${host}\nOllama를 실행한 뒤 다시 시도해 주세요.`,
    );
  }
  const installed = tags.models?.find((model) => model.name === options.model);
  if (!installed) {
    throw new ModelUnavailableError(
      `Ollama에 ${options.model} 모델이 없어요.\n"ollama pull ${options.model}"을 먼저 실행해 주세요.`,
    );
  }

  // 생각 단계가 없는 모델은 think 설정을 받지 않을 수 있다. 그 경우 설정을 빼고 보낸다.
  let sendThink = true;

  async function chat(request: JsonRequest): Promise<{ ok: boolean; body: ChatResponse }> {
    const response = await fetch(`${host}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: options.model,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.prompt },
        ],
        stream: false,
        format: request.schema,
        ...(sendThink ? { think } : {}),
        // 같은 대본에 같은 답이 나오도록 무작위성을 없앤다.
        options: { temperature: 0, seed: 0 },
      }),
    });
    return { ok: response.ok, body: (await response.json()) as ChatResponse };
  }

  return {
    // 같은 태그의 모델이 바뀔 수 있으므로 모델 파일의 식별값을 함께 남긴다.
    name: `ollama ${options.model}@${installed.digest.slice(0, 12)}`,

    async generateJson(request: JsonRequest): Promise<JsonResponse> {
      let { ok, body } = await chat(request);
      if (sendThink && body.error?.includes("think")) {
        sendThink = false;
        ({ ok, body } = await chat(request));
      }
      if (!ok || body.error) {
        throw new Error(`Ollama 요청이 실패했다: ${body.error ?? "응답 오류"}`);
      }
      return {
        content: body.message?.content ?? "",
        usage: {
          promptTokens: body.prompt_eval_count ?? 0,
          outputTokens: body.eval_count ?? 0,
          durationMs: Math.round((body.total_duration ?? 0) / 1e6),
        },
      };
    },
  };
}

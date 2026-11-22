/** 모델 호출의 사용량이다. Ollama가 응답과 함께 돌려주는 값이다. */
export interface ModelUsage {
  /** 모델이 읽은 입력 토큰 수다. */
  promptTokens: number;
  /** 모델이 만든 출력 토큰 수다. */
  outputTokens: number;
  /** 요청 하나를 처리하는 데 걸린 시간(ms)이다. 모델을 불러오는 시간도 들어간다. */
  durationMs: number;
}

/** 정해진 JSON 형식으로 답을 받는 요청이다. */
export interface JsonRequest {
  system: string;
  prompt: string;
  /** 답의 형식을 정하는 JSON 스키마다. */
  schema: Record<string, unknown>;
}

export interface JsonResponse {
  /** 모델이 만든 글이다. 형식을 지켰는지는 받는 쪽에서 확인한다. */
  content: string;
  usage: ModelUsage;
}

/** JSON으로 답하는 모델이다. */
export interface ModelClient {
  /** 기록에 남기는 모델의 이름과 버전이다. */
  readonly name: string;
  generateJson(request: JsonRequest): Promise<JsonResponse>;
}

/** 모델을 쓸 수 없을 때 던지는 오류다. 메시지는 사용자에게 그대로 보여 준다. */
export class ModelUnavailableError extends Error {
  override name = "ModelUnavailableError";
}

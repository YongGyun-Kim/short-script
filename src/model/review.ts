import type { SentenceType } from "../schema.ts";
import type { StructureDefinition } from "../structures.ts";
import type { JsonRequest, ModelClient, ModelUsage } from "./types.ts";

/**
 * 대본 전체를 모델에 한 번 보내서 모델이 맡은 판단을 모두 받는다.
 *
 * 모델이 맡은 판단은 문장의 뜻과 앞뒤 흐름을 봐야 하는 것이다.
 * 단계 분류, 화제 끊김, 시청자에게 미치는 영향, 지시어의 대상, 훅의 내용과 해소다.
 * 프롬프트 문구를 바꾸면 답이 달라질 수 있으므로 판정기 버전을 함께 올린다.
 */

/** 타입이 뜻하는 역할이다. 단계 설명에 쓴다. */
export const TYPE_ROLES: Record<SentenceType, string> = {
  hook: "시청자가 영상을 계속 볼 이유를 만든다. 궁금증을 일으키거나 핵심 사실을 먼저 던진다",
  context: "본문을 이해하는 데 필요한 배경이나 상황을 알린다",
  problem: "시청자가 겪는 문제나 불편을 제시한다",
  agitation: "문제를 그대로 두면 생기는 나쁜 결과를 보여 준다",
  point: "핵심 정보나 주장을 전한다",
  solution: "문제를 푸는 방법을 제시한다",
  example: "앞의 내용을 사례나 수치로 뒷받침한다",
  result: "해결한 뒤에 달라진 점을 보여 준다",
  closing: "앞의 내용을 정리하며 마무리한다",
  cta: "시청자에게 특정 행동을 하라고 요청한다",
};

/** 모델이 대본 하나에 대해 내린 판단이다. 문장 번호는 0부터 센다. */
export interface ScriptReview {
  /** 문장마다 모델이 고른 구조 단계의 번호다. */
  steps: number[];
  /** 앞 문장과 화제가 끊긴다고 본 문장이다. */
  topicBreaks: number[];
  /** 시청자에게 생기는 이득이나 손해를 말한다고 본 문장이다. */
  impactSentences: number[];
  /** 지시어의 대상을 앞 문장에서 알 수 없다고 본 문장이다. */
  unclearReferences: number[];
  /** 0번 문장에 영상이 다룰 구체적인 내용이 있는가. */
  hookHasContent: boolean;
  /** 1번 이후 문장이 0번 문장의 질문이나 주장에 답하는가. */
  hookPaidOff: boolean;
}

export interface ReviewUsage extends ModelUsage {
  /** 모델을 부른 횟수다. 답의 형식이 틀려서 다시 부르면 2가 된다. */
  calls: number;
}

/** 모델의 답이 정한 형식을 지키지 않았을 때 던지는 오류다. */
export class ReviewFormatError extends Error {
  override name = "ReviewFormatError";
}

/** 모델 판단을 끝내 받지 못했을 때 던지는 오류다. 그때까지 쓴 사용량을 함께 남긴다. */
export class ReviewFailedError extends Error {
  override name = "ReviewFailedError";
  readonly usage: ReviewUsage;
  constructor(message: string, usage: ReviewUsage) {
    super(message);
    this.usage = usage;
  }
}

const SYSTEM =
  "너는 쇼츠 영상 대본을 검사하는 검사기다. 대본 전체를 읽고, 요청한 JSON 형식으로만 답한다. 설명을 붙이지 않는다.";

/** 모델에 보낼 요청을 만든다. */
export function buildReviewRequest(structure: StructureDefinition, texts: string[]): JsonRequest {
  const stepNames = structure.steps.map((step) => step.name);
  const stepLines = structure.steps.map(
    (step, index) =>
      `${index}. ${step.name}${step.required ? "" : " (없어도 됨)"}: ${step.types.map((type) => TYPE_ROLES[type]).join(" / ")}`,
  );
  const sentenceLines = texts.map((text, index) => `[${index}] ${text}`);

  const prompt = [
    `구조: ${structure.name}`,
    "단계:",
    ...stepLines,
    "",
    "대본:",
    ...sentenceLines,
    "",
    "아래 여섯 가지를 판단해서 JSON으로 답해라.",
    `1. steps: 문장마다 위 단계 중 어느 단계에 속하는지 단계 이름을 문장 순서대로 적는다. 문장 번호가 아니라 단계 이름이다. 배열의 길이는 문장 수 ${texts.length}개와 같아야 한다.`,
    "2. topicBreaks: 앞 문장과 화제가 이어지지 않고 갑자기 다른 이야기로 넘어가는 문장 번호. 목록형에서 다음 항목으로 넘어가는 문장과 마지막 마무리 문장은 넣지 않는다. 없으면 빈 배열.",
    "3. impactSentences: 시청자에게 생기는 이득이나 손해(돈, 시간, 건강, 기회)를 말하는 문장 번호. 없으면 빈 배열.",
    '4. unclearReferences: "이", "그", "그것" 같은 지시어가 있는데 무엇을 가리키는지 앞 문장에서 알 수 없는 문장 번호. 없으면 빈 배열.',
    "5. hookHasContent: 0번 문장에 영상이 다룰 구체적인 내용이 있으면 true. 인사, 안부, 무엇을 다룰지 알 수 없는 예고뿐이면 false.",
    "6. hookPaidOff: 1번 이후 문장들이 0번 문장이 꺼낸 질문이나 주장에 답이나 근거를 주면 true.",
  ].join("\n");

  const indexList = { type: "array", items: { type: "integer" } };
  const schema = {
    type: "object",
    properties: {
      steps: { type: "array", items: { type: "string", enum: stepNames } },
      topicBreaks: indexList,
      impactSentences: indexList,
      unclearReferences: indexList,
      hookHasContent: { type: "boolean" },
      hookPaidOff: { type: "boolean" },
    },
    required: [
      "steps",
      "topicBreaks",
      "impactSentences",
      "unclearReferences",
      "hookHasContent",
      "hookPaidOff",
    ],
  };

  return { system: SYSTEM, prompt, schema };
}

function readIndexList(value: unknown, field: string, sentenceCount: number): number[] {
  if (!Array.isArray(value)) throw new ReviewFormatError(`${field}가 배열이 아니다.`);
  for (const item of value) {
    if (!Number.isInteger(item) || item < 0 || item >= sentenceCount) {
      throw new ReviewFormatError(`${field}에 없는 문장 번호가 있다: ${String(item)}`);
    }
  }
  return [...new Set(value as number[])].sort((a, b) => a - b);
}

/** 모델의 답을 읽는다. 형식이 틀리면 ReviewFormatError를 던진다. */
export function parseReview(
  content: string,
  structure: StructureDefinition,
  sentenceCount: number,
): ScriptReview {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new ReviewFormatError(`JSON이 아니다: ${content.slice(0, 80)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ReviewFormatError(`JSON 객체가 아니다: ${content.slice(0, 80)}`);
  }
  const answer = parsed as Record<string, unknown>;

  const stepNames = structure.steps.map((step) => step.name);
  if (!Array.isArray(answer.steps) || answer.steps.length !== sentenceCount) {
    throw new ReviewFormatError(`steps의 길이가 문장 수 ${sentenceCount}와 다르다.`);
  }
  const steps = answer.steps.map((name) => {
    const index = stepNames.indexOf(String(name));
    if (index === -1) throw new ReviewFormatError(`구조에 없는 단계 이름이다: ${String(name)}`);
    return index;
  });

  if (typeof answer.hookHasContent !== "boolean" || typeof answer.hookPaidOff !== "boolean") {
    throw new ReviewFormatError("hookHasContent나 hookPaidOff가 참, 거짓 값이 아니다.");
  }

  return {
    steps,
    topicBreaks: readIndexList(answer.topicBreaks, "topicBreaks", sentenceCount),
    impactSentences: readIndexList(answer.impactSentences, "impactSentences", sentenceCount),
    unclearReferences: readIndexList(answer.unclearReferences, "unclearReferences", sentenceCount),
    hookHasContent: answer.hookHasContent,
    hookPaidOff: answer.hookPaidOff,
  };
}

/**
 * 대본 하나를 모델에 보내 판단을 받는다.
 * 답의 형식이 틀리면 maxCalls번까지 다시 부른다. 끝내 실패하면 ReviewFailedError를 던진다.
 */
export async function reviewScript(
  model: ModelClient,
  structure: StructureDefinition,
  texts: string[],
  maxCalls = 2,
): Promise<{ review: ScriptReview; usage: ReviewUsage }> {
  const request = buildReviewRequest(structure, texts);
  const usage: ReviewUsage = { calls: 0, promptTokens: 0, outputTokens: 0, durationMs: 0 };
  let lastError = "";

  while (usage.calls < maxCalls) {
    usage.calls += 1;
    let content: string;
    try {
      const response = await model.generateJson(request);
      usage.promptTokens += response.usage.promptTokens;
      usage.outputTokens += response.usage.outputTokens;
      usage.durationMs += response.usage.durationMs;
      content = response.content;
    } catch (error) {
      // 호출 자체가 실패하면 다시 불러도 같을 가능성이 높으므로 바로 멈춘다.
      const message = error instanceof Error ? error.message : String(error);
      throw new ReviewFailedError(message, usage);
    }
    try {
      return { review: parseReview(content, structure, texts.length), usage };
    } catch (error) {
      if (!(error instanceof ReviewFormatError)) throw error;
      lastError = error.message;
    }
  }
  throw new ReviewFailedError(`답의 형식이 ${maxCalls}번 모두 틀렸다. ${lastError}`, usage);
}

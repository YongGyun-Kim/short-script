/**
 * 판정 항목의 정의다.
 *
 * 판정기는 영상이 좋은지를 판단하지 않는다.
 * 대본에 있어야 할 것이 있는지, 없어야 할 것이 없는지를 항목별로 잰다.
 */

/** 판정 대상이다. */
export type ItemTarget = "format" | "structure" | "clarity" | "interest";

/** required는 대본에 있어야 할 것, forbidden은 없어야 할 것이다. */
export type ItemKind = "required" | "forbidden";

/** script는 LLM 없이 잰다. model은 작은 오픈 모델이 대본 전체를 읽고 내린 판단을 쓴다. */
export type ItemMethod = "script" | "model" | "script+model";

export interface ItemDefinition {
  id: string;
  name: string;
  target: ItemTarget;
  kind: ItemKind;
  method: ItemMethod;
  /** 기록의 value가 뜻하는 값이다. */
  measures: string;
}

export const ITEMS = [
  {
    id: "format.fields",
    name: "필드와 값의 유효성",
    target: "format",
    kind: "required",
    method: "script",
    measures: "빈 문장이나 목록에 없는 타입이 있는 문장의 수",
  },
  {
    id: "format.ttsNotation",
    name: "TTS가 잘못 읽는 표기",
    target: "format",
    kind: "forbidden",
    method: "script",
    measures: "TTS가 잘못 읽을 수 있는 표기의 수",
  },
  {
    id: "structure.requiredSteps",
    name: "필수 단계",
    target: "structure",
    kind: "required",
    method: "script",
    measures: "선택한 구조에서 빠진 필수 단계의 수",
  },
  {
    id: "structure.stepOrder",
    name: "단계 순서",
    target: "structure",
    kind: "required",
    method: "script",
    measures: "구조의 순서에서 어긋났거나 타입이 구조에 없는 문장의 수",
  },
  {
    id: "structure.openingAndClosing",
    name: "시작과 끝",
    target: "structure",
    kind: "required",
    method: "script",
    measures:
      "충족하지 못한 조건의 수. 조건은 첫 단계로 시작하기와 끝 단계로 끝나기다. 훅의 음절 수도 남긴다",
  },
  {
    id: "structure.timeShare",
    name: "분량 배분",
    target: "structure",
    kind: "forbidden",
    method: "script",
    measures:
      "음절 수를 가장 많이 차지한 단계의 음절 수 비율. 재생 시간을 받지 않으므로 음절 수로 분량을 잰다",
  },
  {
    id: "structure.cohesion",
    name: "문장 간 연결",
    target: "structure",
    kind: "required",
    method: "model",
    measures:
      "모델이 앞 문장과 화제가 끊긴다고 본 문장의 수. 목록형의 항목 전환과 마무리 문장은 넣지 않게 지시한다",
  },
  {
    id: "structure.typeMatch",
    name: "타입 일치",
    target: "structure",
    kind: "required",
    method: "model",
    measures: "타입 라벨의 단계와 모델이 고른 단계가 다른 문장의 수",
  },
  {
    id: "clarity.sentenceLength",
    name: "문장 길이",
    target: "clarity",
    kind: "forbidden",
    method: "script",
    measures: "가장 긴 문장의 음절 수",
  },
  {
    id: "clarity.oneIdea",
    name: "한 문장 한 내용",
    target: "clarity",
    kind: "required",
    method: "script",
    measures: "한 문장에 들어 있는 절의 수 중 가장 큰 값",
  },
  {
    id: "clarity.vocabulary",
    name: "어휘 난이도",
    target: "clarity",
    kind: "forbidden",
    method: "script",
    measures:
      "어려운 단어의 비율. 어휘 등급 목록을 연결하기 전에는 비워 두고, 명사가 연달아 나온 길이만 facts에 남긴다",
  },
  {
    id: "clarity.reference",
    name: "가리키는 대상",
    target: "clarity",
    kind: "required",
    method: "script+model",
    measures:
      "지시어가 있는 문장 중 모델이 대상을 앞 문장에서 알 수 없다고 본 문장의 수. 지시어는 형태소 분석기가 찾는다",
  },
  {
    id: "interest.devices",
    name: "문장별 흥미 장치",
    target: "interest",
    kind: "required",
    method: "script+model",
    measures:
      "흥미 장치가 하나 이상 있는 문장의 비율. 질문, 대비, 수치는 스크립트가, 시청자에게 미치는 영향은 모델이 찾는다",
  },
  {
    id: "interest.hookQuestion",
    name: "훅의 질문",
    target: "interest",
    kind: "required",
    method: "model",
    measures: "첫 문장에 영상이 다룰 구체적인 내용이 있으면 1, 인사나 예고뿐이면 0",
  },
  {
    id: "interest.hookPayoff",
    name: "훅의 해소",
    target: "interest",
    kind: "required",
    method: "model",
    measures: "뒤의 문장들이 첫 문장의 질문이나 주장에 답하면 1, 아니면 0",
  },
  {
    id: "interest.emptySentences",
    name: "내용 없는 문장",
    target: "interest",
    kind: "forbidden",
    method: "script",
    measures: "예고나 감탄 표현이 있는 문장의 수. 훅과 끝맺음은 세지 않는다",
  },
  {
    id: "interest.repetition",
    name: "반복",
    target: "interest",
    kind: "forbidden",
    method: "script",
    measures: "두 문장의 글자 겹침 비율 중 가장 큰 값(0에서 1)",
  },
  {
    id: "interest.deviceGap",
    name: "장치 없는 구간",
    target: "interest",
    kind: "forbidden",
    method: "script",
    measures: "흥미 장치가 없는 문장이 이어진 가장 긴 구간의 음절 수",
  },
] as const satisfies readonly ItemDefinition[];

export type ItemId = (typeof ITEMS)[number]["id"];

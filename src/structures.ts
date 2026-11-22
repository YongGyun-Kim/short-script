import { isSentenceType } from "./schema.ts";
import type { SentenceType, StructureId } from "./schema.ts";

/** 구조의 한 단계다. 한 단계는 문장 한 개 이상으로 이루어진다. */
export interface StructureStep {
  /** 단계의 이름이다. */
  name: string;
  /** 이 단계에 올 수 있는 문장 타입이다. 한 구조 안에서 한 타입은 한 단계에만 속한다. */
  types: readonly SentenceType[];
  /** true면 이 단계가 빠진 대본은 필수 단계 항목에서 걸린다. */
  required: boolean;
}

export interface StructureDefinition {
  id: StructureId;
  name: string;
  /** 재생 순서대로 놓인 단계다. */
  steps: readonly StructureStep[];
}

const HOOK: StructureStep = { name: "훅", types: ["hook"], required: true };
const CTA: StructureStep = { name: "끝맺음", types: ["cta", "closing"], required: false };

/**
 * 판정기가 아는 구조의 목록이다.
 * 출처는 영상 제작 도구 회사들의 공개 글이며, 수치로 검증된 목록이 아니다.
 * 이 목록은 대본 생성 단계가 사용자에게 제시하는 구조 목록과 같아야 한다.
 * 쇼더스의 실제 목록은 확인하지 못했다.
 */
export const STRUCTURES: Record<StructureId, StructureDefinition> = {
  basic: {
    id: "basic",
    name: "기본 3단",
    steps: [HOOK, { name: "본문", types: ["context", "point", "example"], required: true }, CTA],
  },
  "problem-solution": {
    id: "problem-solution",
    name: "문제·해결",
    steps: [
      HOOK,
      { name: "문제", types: ["problem", "context"], required: true },
      { name: "해결", types: ["solution", "point"], required: true },
      { name: "예시", types: ["example"], required: false },
      CTA,
    ],
  },
  pas: {
    id: "pas",
    name: "문제, 문제 심화, 해결",
    steps: [
      { name: "문제", types: ["hook", "problem"], required: true },
      { name: "문제 심화", types: ["agitation"], required: true },
      { name: "해결", types: ["solution", "point"], required: true },
      CTA,
    ],
  },
  aida: {
    id: "aida",
    name: "주의, 흥미, 욕구, 행동",
    steps: [
      { name: "주의", types: ["hook"], required: true },
      { name: "흥미", types: ["context", "problem", "point"], required: true },
      { name: "욕구", types: ["solution", "example", "result"], required: true },
      { name: "행동", types: ["cta"], required: true },
    ],
  },
  "problem-solution-result": {
    id: "problem-solution-result",
    name: "문제·해결·결과",
    steps: [
      HOOK,
      { name: "문제", types: ["problem", "context"], required: true },
      { name: "해결", types: ["solution", "point"], required: true },
      { name: "결과", types: ["result"], required: true },
      CTA,
    ],
  },
  story: {
    id: "story",
    name: "이야기형",
    steps: [
      HOOK,
      { name: "상황", types: ["context"], required: true },
      { name: "사건", types: ["problem", "point", "agitation"], required: true },
      { name: "전환", types: ["solution", "result", "example"], required: false },
      { name: "교훈", types: ["closing", "cta"], required: true },
    ],
  },
  list: {
    id: "list",
    name: "목록형",
    steps: [HOOK, { name: "항목", types: ["point", "example"], required: true }, CTA],
  },
};

/**
 * 문장의 타입이 구조의 몇 번째 단계에 속하는지 찾는다.
 * 타입이 구조의 어느 단계에도 없으면 -1을 돌려준다.
 */
export function stepIndexOf(structure: StructureDefinition, type: string): number {
  if (!isSentenceType(type)) return -1;
  return structure.steps.findIndex((step) => step.types.includes(type));
}

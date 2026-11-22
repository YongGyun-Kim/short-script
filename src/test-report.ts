/** 단위 테스트 실행 결과의 요약이다. */
export interface TestSummary {
  tests: number;
  pass: number;
  fail: number;
  skipped: number;
  /** 실패한 테스트의 이름이다. */
  failedTests: string[];
}

/**
 * Node 테스트 실행기의 TAP 출력에서 요약을 읽는다.
 * 요약 줄("# tests 36")이 없으면 그 값은 0이다.
 */
export function parseTapSummary(tap: string): TestSummary {
  const count = (name: string): number => {
    const match = tap.match(new RegExp(`^# ${name} (\\d+)$`, "m"));
    return match?.[1] ? Number(match[1]) : 0;
  };
  // 최상위 테스트의 실패만 센다. 하위 테스트 줄은 들여쓰기로 시작한다.
  const failedTests = [...tap.matchAll(/^not ok \d+ - (.+)$/gm)].map((match) => match[1] ?? "");
  return {
    tests: count("tests"),
    pass: count("pass"),
    fail: count("fail"),
    skipped: count("skipped"),
    failedTests,
  };
}

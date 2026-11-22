import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTapSummary } from "../src/test-report.ts";

test("TAP 출력에서 테스트 요약과 실패한 테스트 이름을 읽는다", () => {
  const tap = [
    "TAP version 13",
    "# Subtest: 첫 번째",
    "ok 1 - 첫 번째",
    "# Subtest: 두 번째",
    "not ok 2 - 두 번째",
    "  ---",
    "  not ok 1 - 하위 테스트",
    "1..2",
    "# tests 2",
    "# pass 1",
    "# fail 1",
    "# skipped 0",
  ].join("\n");
  assert.deepEqual(parseTapSummary(tap), {
    tests: 2,
    pass: 1,
    fail: 1,
    skipped: 0,
    failedTests: ["두 번째"],
  });
});

test("요약 줄이 없으면 0으로 읽는다", () => {
  assert.deepEqual(parseTapSummary(""), {
    tests: 0,
    pass: 0,
    fail: 0,
    skipped: 0,
    failedTests: [],
  });
});

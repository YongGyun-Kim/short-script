/**
 * Kiwi 모델 파일을 내려받아 모델 폴더에 푼다.
 * 모델은 약 100MB라서 저장소와 npm 패키지에 넣지 않는다.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  KIWI_MODEL_MARKER,
  KIWI_MODEL_SHA256,
  KIWI_MODEL_URL,
  KIWI_MODEL_VERSION,
  kiwiModelDir,
} from "../src/analyzer/kiwi-model.ts";

async function main(): Promise<number> {
  const installed = createRequire(import.meta.url)("kiwi-nlp/package.json") as { version: string };
  if (installed.version !== KIWI_MODEL_VERSION) {
    console.error(
      `kiwi-nlp 버전(${installed.version})과 모델 버전(${KIWI_MODEL_VERSION})이 달라요. src/analyzer/kiwi-model.ts의 버전과 SHA-256 값을 맞춰 주세요.`,
    );
    return 1;
  }

  const modelDir = kiwiModelDir();
  const markerPath = join(modelDir, KIWI_MODEL_MARKER);
  if (existsSync(markerPath) && readFileSync(markerPath, "utf8").trim() === KIWI_MODEL_VERSION) {
    console.log(`Kiwi 모델 ${KIWI_MODEL_VERSION}이 이미 있어요: ${modelDir}`);
    return 0;
  }

  console.log(`Kiwi 모델을 내려받아요: ${KIWI_MODEL_URL}`);
  const response = await fetch(KIWI_MODEL_URL);
  if (!response.ok) {
    console.error(`모델을 내려받지 못했어요. 응답 코드: ${response.status}`);
    return 1;
  }
  const archive = Buffer.from(await response.arrayBuffer());

  const sha256 = createHash("sha256").update(archive).digest("hex");
  if (sha256 !== KIWI_MODEL_SHA256) {
    console.error(`내려받은 파일이 기대한 파일과 달라요. SHA-256: ${sha256}`);
    return 1;
  }

  const archivePath = join(tmpdir(), `kiwi-model-${KIWI_MODEL_VERSION}-${process.pid}.tgz`);
  writeFileSync(archivePath, archive);
  try {
    mkdirSync(modelDir, { recursive: true });
    // 압축 파일 안의 경로는 models/cong/base/<파일>이다. 앞의 세 단계를 떼고 푼다.
    execFileSync("tar", ["-xzf", archivePath, "-C", modelDir, "--strip-components=3"]);
  } finally {
    rmSync(archivePath, { force: true });
  }
  writeFileSync(markerPath, `${KIWI_MODEL_VERSION}\n`);

  console.log(`Kiwi 모델을 준비했어요: ${modelDir}`);
  return 0;
}

process.exitCode = await main();

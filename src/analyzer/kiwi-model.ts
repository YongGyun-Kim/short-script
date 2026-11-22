import { fileURLToPath } from "node:url";

/**
 * Kiwi 모델 파일의 위치와 버전이다.
 * 모델은 npm 패키지에 들어 있지 않아서 "npm run setup"으로 따로 내려받는다.
 */

/** 내려받는 모델의 버전이다. 설치한 kiwi-nlp의 버전과 같아야 한다. */
export const KIWI_MODEL_VERSION = "0.25.0";

export const KIWI_MODEL_URL = `https://github.com/bab2min/Kiwi/releases/download/v${KIWI_MODEL_VERSION}/kiwi_model_v${KIWI_MODEL_VERSION}_base.tgz`;

/** 내려받은 파일이 맞는지 확인하는 SHA-256 값이다. 모델 버전을 바꾸면 함께 바꾼다. */
export const KIWI_MODEL_SHA256 = "2b32096ce9f48da6aaaf486db01ff46834e7e3dcb92f507879d35e3d2180a2dc";

/** 모델 폴더에 설치한 버전을 적어 두는 파일이다. */
export const KIWI_MODEL_MARKER = ".kiwi-model-version";

/** 모델 폴더의 경로다. 환경 변수 KIWI_MODEL_DIR로 바꿀 수 있다. */
export function kiwiModelDir(): string {
  return process.env.KIWI_MODEL_DIR ?? fileURLToPath(new URL("../../models/kiwi", import.meta.url));
}

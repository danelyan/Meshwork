// Ресурсы MediaPipe для детекции лица в комнате звонка (docs/stack.md): WASM-рантайм копируется из
// node_modules/@mediapipe/tasks-vision, модель Face Landmarker скачивается один раз. Всё – в public/mediapipe
// (в .gitignore: 25 МБ бинарей в репозитории не нужны). Запуск: prebuild/predev; без сети модель не скачается –
// слежение за лицом в комнате просто выключено, остальное приложение не страдает.
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const src = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const out = join(root, 'public/mediapipe');
const wasmOut = join(out, 'wasm');
mkdirSync(wasmOut, { recursive: true });

const files = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm'];
for (const f of files) {
  const from = join(src, f);
  const to = join(wasmOut, f);
  if (!existsSync(from)) {
    console.warn(`mediapipe: нет ${from} – пропуск`);
    continue;
  }
  if (!existsSync(to) || statSync(to).size !== statSync(from).size) copyFileSync(from, to);
}

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const model = join(out, 'face_landmarker.task');
if (!existsSync(model) || statSync(model).size < 1_000_000) {
  try {
    const res = await fetch(MODEL_URL, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(model, Buffer.from(await res.arrayBuffer()));
    console.log(`mediapipe: модель скачана, ${statSync(model).size} байт`);
  } catch (err) {
    console.warn(`mediapipe: модель не скачана (${err instanceof Error ? err.message : err}) – слежение за лицом будет выключено`);
  }
} else {
  console.log('mediapipe: ресурсы на месте');
}

/**
 * Банк «мгновенных реакций» Киры: public/ack/<kind>_NN.<ext> + manifest.json.
 * Запуск: npx tsx scripts/gen-ack.mts  (нужны YANDEX_API_KEY, YANDEX_FOLDER_ID в .env; голос/скорость — TTS_VOICE/TTS_SPEED/TTS_FORMAT).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ACK_TEXTS, type AckKind, type AckManifest } from '../src/lib/ack-texts';
import { synthesizeYandex } from '../src/server/tts/index';
import { loadPlatformEnv } from './load-env.mjs';

loadPlatformEnv();

const apiKey = process.env.YANDEX_API_KEY;
if (!apiKey) {
  console.error('gen-ack: нет YANDEX_API_KEY в окружении/.env');
  process.exit(1);
}
const format = process.env.TTS_FORMAT === 'oggopus' ? 'oggopus' : 'mp3';
const ext = format === 'oggopus' ? 'ogg' : 'mp3';
const voice = process.env.TTS_VOICE || 'marina';
const emotion = process.env.TTS_EMOTION ?? 'neutral';
const speed = Number(process.env.TTS_SPEED) || 1.1;
const dir = join(import.meta.dirname, '..', 'public', 'ack');
mkdirSync(dir, { recursive: true });

const manifest: AckManifest = { think: [], listen: [], soft: [] };
try {
  for (const kind of Object.keys(ACK_TEXTS) as AckKind[]) {
    for (const [i, text] of ACK_TEXTS[kind].entries()) {
      const audio = await synthesizeYandex(text, { apiKey, folderId: process.env.YANDEX_FOLDER_ID, voice, emotion: emotion || undefined, speed, format });
      const name = `${kind}_${String(i + 1).padStart(2, '0')}.${ext}`;
      writeFileSync(join(dir, name), Buffer.from(audio));
      manifest[kind].push(name);
      console.log(`${name}  ${text}`);
    }
  }
} catch (e) {
  console.error(`gen-ack: синтез не удался (${e instanceof Error ? e.message : String(e)}). Банк не записан; повторите, когда SpeechKit ответит.`);
  process.exit(1);
}
writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`готово: ${dir}`);

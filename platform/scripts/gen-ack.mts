/**
 * Банк «мгновенных реакций» Киры: public/ack/<kind>_NN.<ext> + manifest.json.
 * Запуск: npx tsx scripts/gen-ack.mts. Провайдер – по TTS_PROVIDER из .env: elevenlabs (ELEVENLABS_API_KEY/VOICE/MODEL, mp3)
 * или yandex (YANDEX_API_KEY, YANDEX_FOLDER_ID; голос/скорость – TTS_VOICE/TTS_SPEED/TTS_FORMAT). Голос тот же, что у реплик Киры.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ACK_TEXTS, type AckKind, type AckManifest } from '../src/lib/ack-texts';
import { synthesizeElevenLabs, synthesizeYandex } from '../src/server/tts/index';
import { loadPlatformEnv } from './load-env.mjs';

loadPlatformEnv();

const eleven = process.env.TTS_PROVIDER === 'elevenlabs';
const apiKey = eleven ? process.env.ELEVENLABS_API_KEY : process.env.YANDEX_API_KEY;
if (!apiKey || (eleven && !process.env.ELEVENLABS_VOICE)) {
  console.error(eleven ? 'gen-ack: нет ELEVENLABS_API_KEY/ELEVENLABS_VOICE в .env' : 'gen-ack: нет YANDEX_API_KEY в окружении/.env');
  process.exit(1);
}
const format = !eleven && process.env.TTS_FORMAT === 'oggopus' ? 'oggopus' : 'mp3';
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
      const audio = eleven
        ? await synthesizeElevenLabs(text, { apiKey, voiceId: process.env.ELEVENLABS_VOICE as string, model: process.env.ELEVENLABS_MODEL, baseUrl: process.env.ELEVENLABS_BASE_URL, proxyUrl: process.env.ELEVENLABS_PROXY_URL, speed })
        : await synthesizeYandex(text, { apiKey, folderId: process.env.YANDEX_FOLDER_ID, voice, emotion: emotion || undefined, speed, format });
      const name = `${kind}_${String(i + 1).padStart(2, '0')}.${ext}`;
      writeFileSync(join(dir, name), Buffer.from(audio));
      manifest[kind].push(name);
      console.log(`${name}  ${text}`);
    }
  }
} catch (e) {
  console.error(`gen-ack: синтез не удался (${e instanceof Error ? e.message : String(e)}). Банк не записан; повторите, когда провайдер озвучки ответит.`);
  process.exit(1);
}
writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`готово: ${dir}`);

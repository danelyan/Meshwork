// Способ связи (Q-35, R-E-07): почта или Telegram. Один формат для кандидата
// (Candidate.contact) и компании (Company.contact). Нормализует ввод: «t.me/name»,
// «https://t.me/name» и «name» с @ приводятся к «@name».
import { z } from 'zod';

const CONTACT_ERROR = 'Укажи почту (name@mail.ru) или Telegram (@username)';

/** Username Telegram: 5–32 символа, латиница, цифры и подчёркивание, начинается с буквы. */
const TG = /^@?([a-zA-Z][a-zA-Z0-9_]{4,31})$/;
const TG_LINK = /^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/([a-zA-Z][a-zA-Z0-9_]{4,31})\/?$/;

const Email = z.email();

/** null — не похоже ни на почту, ни на Telegram. */
export function normalizeContact(raw: string): string | null {
  const v = raw.trim();
  if (!v || v.length > 120) return null;
  if (v.includes('@') && !v.startsWith('@')) {
    if (!Email.safeParse(v).success) return null;
    // Служебный адрес онбординга (`user-…@users.invalid`) контактом не считается.
    return v.toLowerCase().endsWith('.invalid') ? null : v;
  }
  const m = TG_LINK.exec(v) ?? TG.exec(v);
  return m ? `@${m[1]}` : null;
}

/** Контакт на границе API: почта или Telegram, нормализованный. */
export const ContactSchema = z
  .string()
  .trim()
  .min(1, CONTACT_ERROR)
  .max(120, CONTACT_ERROR)
  .transform((v, ctx) => {
    const out = normalizeContact(v);
    if (out === null) {
      ctx.issues.push({ code: 'custom', message: CONTACT_ERROR, input: v });
      return z.NEVER;
    }
    return out;
  });

/** POST /api/profile/contact: пустая строка или null — убрать контакт. */
export const CandidateContactInput = z.object({
  contact: z.union([z.literal('').transform(() => null), z.null(), ContactSchema]),
});

export const contactError = CONTACT_ERROR;

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Base62 от счётчика: короткий код без коллизий, пока счётчик монотонный.
export function encode(n) {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError('id must be a non-negative safe integer');
  if (n === 0) return ALPHABET[0];
  let out = '';
  while (n > 0) {
    out = ALPHABET[n % 62] + out;
    n = Math.floor(n / 62);
  }
  return out;
}

export function decode(code) {
  let n = 0;
  for (const ch of code) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) return null;
    n = n * 62 + i;
  }
  return Number.isSafeInteger(n) ? n : null;
}

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

/*
 * Small crypto helpers for the Google Calendar connection. Pure functions, unit tested.
 *
 *  - Refresh tokens are stored ENCRYPTED (AES-256-GCM). Anyone who reads the
 *    database alone cannot use them.
 *  - The OAuth "state" parameter is SIGNED (HMAC-SHA256) and expires, so the
 *    Google callback can trust which AgiliX user started the connection and a
 *    forged or replayed callback is refused (CSRF protection).
 */

const STATE_TTL_MS = 10 * 60_000;

/** 32-byte key from a secret (CALENDAR_TOKEN_KEY, or JWT_SECRET as a fallback). */
export function deriveKey(secret: string, purpose: string): Buffer {
  return createHash('sha256').update(`agilix:${purpose}:${secret}`).digest();
}

/** "v1.<iv>.<tag>.<ciphertext>" in base64url. */
export function encryptToken(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), data.toString('base64url')].join('.');
}

/** Throws if the value was changed or encrypted with another key. */
export function decryptToken(sealed: string, key: Buffer): string {
  const [version, iv, tag, data] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unknown token format');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

/** Signed, expiring state that names the AgiliX user: "<userId>.<expiresAt>.<nonce>.<signature>". */
export function signState(userId: string, key: Buffer, now = Date.now()): string {
  const body = `${userId}.${now + STATE_TTL_MS}.${randomBytes(9).toString('base64url')}`;
  return `${body}.${hmac(body, key)}`;
}

/** The user id from a valid state, or null when it is forged, malformed or expired. */
export function verifyState(state: string, key: Buffer, now = Date.now()): string | null {
  const parts = (state ?? '').split('.');
  if (parts.length !== 4) return null;
  const [userId, expiresAt, nonce, signature] = parts;
  const expected = hmac(`${userId}.${expiresAt}.${nonce}`, key);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (!/^[a-f\d]{24}$/i.test(userId)) return null;
  if (!(Number(expiresAt) > now)) return null;
  return userId;
}

function hmac(value: string, key: Buffer): string {
  return createHmac('sha256', key).update(value).digest('base64url');
}

/** The email inside a Google id_token (we got it straight from Google over TLS, so no signature check is needed). */
export function emailFromIdToken(idToken: string | undefined): string | null {
  const payload = idToken?.split('.')[1];
  if (!payload) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { email?: unknown };
    return typeof data.email === 'string' ? data.email : null;
  } catch {
    return null;
  }
}

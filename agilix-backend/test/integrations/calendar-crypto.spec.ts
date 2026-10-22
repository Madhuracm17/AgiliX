import {
  decryptToken,
  deriveKey,
  emailFromIdToken,
  encryptToken,
  signState,
  verifyState,
} from '../../src/integrations/google-calendar/calendar-crypto';

const SECRET = 'a-test-secret-that-is-long-enough-123456';
const TOKEN_KEY = deriveKey(SECRET, 'calendar-token');
const STATE_KEY = deriveKey(SECRET, 'calendar-state');
const USER = '64b7f0c2a1b2c3d4e5f60718';

describe('refresh token encryption', () => {
  it('round-trips and never stores the token in plain text', () => {
    const sealed = encryptToken('1//refresh-token', TOKEN_KEY);
    expect(sealed).not.toContain('refresh-token');
    expect(decryptToken(sealed, TOKEN_KEY)).toBe('1//refresh-token');
  });

  it('uses a fresh IV each time', () => {
    expect(encryptToken('same', TOKEN_KEY)).not.toBe(encryptToken('same', TOKEN_KEY));
  });

  it('refuses a tampered value or the wrong key', () => {
    const sealed = encryptToken('1//refresh-token', TOKEN_KEY);
    const parts = sealed.split('.');
    const flipped = parts[3][0] === 'A' ? 'B' : 'A';
    const tampered = [...parts.slice(0, 3), flipped + parts[3].slice(1)].join('.');
    expect(() => decryptToken(tampered, TOKEN_KEY)).toThrow();
    expect(() => decryptToken(sealed, deriveKey('another-secret-another-secret-123', 'calendar-token'))).toThrow();
    expect(() => decryptToken('not-a-token', TOKEN_KEY)).toThrow();
  });

  it('derives different keys for different purposes', () => {
    expect(TOKEN_KEY.equals(STATE_KEY)).toBe(false);
  });
});

describe('OAuth state', () => {
  const now = Date.parse('2026-10-21T10:00:00Z');

  it('returns the user id for a valid state', () => {
    expect(verifyState(signState(USER, STATE_KEY, now), STATE_KEY, now + 60_000)).toBe(USER);
  });

  it('refuses an expired state (older than 10 minutes)', () => {
    expect(verifyState(signState(USER, STATE_KEY, now), STATE_KEY, now + 11 * 60_000)).toBeNull();
  });

  it('refuses a state where the user id was swapped (CSRF / account takeover)', () => {
    const [, ...rest] = signState(USER, STATE_KEY, now).split('.');
    const forged = ['64b7f0c2a1b2c3d4e5f60799', ...rest].join('.');
    expect(verifyState(forged, STATE_KEY, now)).toBeNull();
  });

  it('refuses a state signed with another key, and garbage', () => {
    const other = deriveKey('another-secret-another-secret-123', 'calendar-state');
    expect(verifyState(signState(USER, other, now), STATE_KEY, now)).toBeNull();
    expect(verifyState('', STATE_KEY, now)).toBeNull();
    expect(verifyState('a.b.c', STATE_KEY, now)).toBeNull();
  });
});

describe('emailFromIdToken', () => {
  it('reads the email claim', () => {
    const payload = Buffer.from(JSON.stringify({ email: 'lekha@example.com' })).toString('base64url');
    expect(emailFromIdToken(`header.${payload}.signature`)).toBe('lekha@example.com');
  });

  it('returns null for a missing or broken token', () => {
    expect(emailFromIdToken(undefined)).toBeNull();
    expect(emailFromIdToken('broken')).toBeNull();
    expect(emailFromIdToken('a.not-json.c')).toBeNull();
  });
});

// The login token is kept in the browser so a page refresh does not log the user out.
// Only the token is stored; who the user is always comes from the backend (/auth/me).
const TOKEN_KEY = "agilix.token";

type Listener = () => void;
const expiredListeners = new Set<Listener>();

// In-memory copy, so login still works (until refresh) if the browser blocks storage.
let currentToken: string | null = readStoredToken();

/** The saved login token, or null when nobody is logged in. */
export function getToken(): string | null {
  return currentToken;
}

export function saveToken(token: string): void {
  currentToken = token;
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Storage unavailable (e.g. private mode): the in-memory copy is used.
  }
}

export function clearToken(): void {
  currentToken = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Runs `listener` when the backend rejects the saved token. Returns an unsubscribe function. */
export function onSessionExpired(listener: Listener): () => void {
  expiredListeners.add(listener);
  return () => {
    expiredListeners.delete(listener);
  };
}

/** Clears the saved login and tells the app to show the login page. */
export function expireSession(): void {
  clearToken();
  expiredListeners.forEach((listener) => listener());
}

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
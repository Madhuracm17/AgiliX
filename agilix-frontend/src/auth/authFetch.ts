import { expireSession, getToken } from "./session";

// Same backend address the rest of the app uses (App.tsx and api/client.ts).
const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:3000").replace(/\/+$/, "");

let installed = false;

/**
 * Adds the login token to every request sent to the AgiliX backend:
 *   Authorization: Bearer <token>
 *
 * It wraps the browser's fetch once at startup, so existing pages (and teammates'
 * new code) get the token automatically without changing any fetch call.
 * Requests to other websites are left untouched, so the token never leaks elsewhere.
 *
 * If the backend answers 401 for a request that carried the token, the token is
 * expired or invalid: the saved login is cleared and the login page is shown.
 */
export function installAuthFetch(): void {
  if (installed) return;
  installed = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const token = getToken();
    const url = requestUrl(input);

    if (!token || !isBackendUrl(url)) {
      return originalFetch(input, init);
    }

    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    if (!headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    const response = await originalFetch(input, { ...init, headers });

    // Only react if this token is still the current one (not already logged out / replaced).
    if (response.status === 401 && !isLoginUrl(url) && getToken() === token) {
      expireSession();
    }

    return response;
  };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function isBackendUrl(url: string): boolean {
  return url === API_URL || url.startsWith(`${API_URL}/`) || url.startsWith(`${API_URL}?`);
}

function isLoginUrl(url: string): boolean {
  return url.startsWith(`${API_URL}/auth/login`);
}
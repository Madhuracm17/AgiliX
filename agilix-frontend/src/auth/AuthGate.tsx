import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { getMe } from "../api/auth";
import type { User } from "../api/users";
import { AuthContext, type AuthContextValue } from "./auth-context";
import LoginPage from "./LoginPage";
import { clearToken, getToken, onSessionExpired, saveToken } from "./session";
import "./auth.css";

type Status = "checking" | "logged-out" | "logged-in" | "offline";

/**
 * Shows the login page until someone is logged in, then shows the app.
 *
 * On startup, a saved token is checked with GET /auth/me:
 *  - valid        → the app is shown for that user
 *  - rejected     → the saved token is cleared and the login page is shown
 *  - server down  → a "can't reach the server" message with Retry
 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<Status>(() =>
    getToken() ? "checking" : "logged-out",
  );
  // Incremented by "Retry" to re-run the startup check.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!getToken()) return;

    let cancelled = false;
    getMe()
      .then((me) => {
        if (cancelled) return;
        setUser(me);
        setStatus("logged-in");
      })
      .catch(() => {
        if (cancelled) return;
        // authFetch clears the token when the backend rejects it (401).
        setStatus(getToken() ? "offline" : "logged-out");
      });

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // The backend rejected the token later on (e.g. it expired): back to the login page.
  useEffect(
    () =>
      onSessionExpired(() => {
        setUser(null);
        setStatus("logged-out");
      }),
    [],
  );

  const handleLoggedIn = useCallback((token: string, loggedInUser: User) => {
    saveToken(token);
    setUser(loggedInUser);
    setStatus("logged-in");
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
    setStatus("logged-out");
  }, []);

  const retry = () => {
    setStatus("checking");
    setAttempt((value) => value + 1);
  };

  const contextValue = useMemo<AuthContextValue | null>(
    () => (user ? { user, logout } : null),
    [user, logout],
  );

  if (status === "logged-in" && contextValue) {
    return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
  }

  if (status === "checking") {
    return (
      <div className="auth-page">
        <p className="auth-status">Checking your login…</p>
      </div>
    );
  }

  if (status === "offline") {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>Can't reach the server</h1>
          <p className="auth-subtitle">
            Make sure the AgiliX backend is running, then try again.
          </p>
          <div className="auth-actions">
            <button type="button" className="secondary-button" onClick={logout}>
              Log out
            </button>
            <button type="button" className="primary-button" onClick={retry}>
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <LoginPage onLoggedIn={handleLoggedIn} />;
}
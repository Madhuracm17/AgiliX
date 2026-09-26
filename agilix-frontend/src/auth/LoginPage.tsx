import { useState, type FormEvent } from "react";
import { login, register } from "../api/auth";
import type { User } from "../api/users";

type Mode = "login" | "register";

interface LoginPageProps {
  /** Called after a successful login (or sign-up + login). */
  onLoggedIn: (token: string, user: User) => void;
}

/** Must match the backend's CreateUserDto (@MinLength(6)). */
const MIN_PASSWORD_LENGTH = 6;

export default function LoginPage({ onLoggedIn }: LoginPageProps) {
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const isRegister = mode === "register";

  const switchMode = (next: Mode) => {
    setMode(next);
    setError("");
    setPassword("");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const trimmedEmail = email.trim();
    const trimmedName = name.trim();

    if (!trimmedEmail || !password || (isRegister && !trimmedName)) {
      setError("Please fill in all fields.");
      return;
    }
    if (isRegister && password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      if (isRegister) {
        await register({ name: trimmedName, email: trimmedEmail, password });
      }
      const result = await login(trimmedEmail, password);
      onLoggedIn(result.accessToken, result.user);
    } catch (err) {
      setError(
        readError(err, isRegister ? "Could not create the account." : "Login failed."),
      );
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit} noValidate>
        <div className="auth-logo">
          <div className="logo-mark">A</div>
          <span>AgiliX</span>
        </div>

        <h1>{isRegister ? "Create your account" : "Log in"}</h1>
        <p className="auth-subtitle">
          {isRegister
            ? "Join your team's AgiliX workspace."
            : "Welcome back. Log in to your workspace."}
        </p>

        {isRegister && (
          <>
            <label htmlFor="auth-name">Name</label>
            <input
              id="auth-name"
              type="text"
              autoComplete="name"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </>
        )}

        <label htmlFor="auth-email">Email</label>
        <input
          id="auth-email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label htmlFor="auth-password">Password</label>
        <input
          id="auth-password"
          type="password"
          autoComplete={isRegister ? "new-password" : "current-password"}
          placeholder={isRegister ? `At least ${MIN_PASSWORD_LENGTH} characters` : "Your password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="primary-button auth-submit" disabled={submitting}>
          {submitting
            ? isRegister
              ? "Creating account…"
              : "Logging in…"
            : isRegister
              ? "Create account"
              : "Log in"}
        </button>

        <p className="auth-switch">
          {isRegister ? "Already have an account?" : "New to AgiliX?"}{" "}
          <button
            type="button"
            className="auth-link"
            onClick={() => switchMode(isRegister ? "login" : "register")}
            disabled={submitting}
          >
            {isRegister ? "Log in" : "Create an account"}
          </button>
        </p>
      </form>
    </div>
  );
}

/** Turns api() errors (Nest JSON bodies) into a readable message. */
function readError(err: unknown, fallback: string): string {
  if (!(err instanceof Error) || !err.message) return fallback;

  try {
    const body = JSON.parse(err.message) as { message?: unknown };
    const message = Array.isArray(body.message) ? body.message.join(", ") : body.message;
    return typeof message === "string" && message ? message : fallback;
  } catch {
    // Not JSON: usually "Failed to fetch" when the backend is not running.
    return err.message === "Failed to fetch"
      ? "Can't reach the server. Make sure the backend is running."
      : err.message;
  }
}
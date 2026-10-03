import { useState, type FormEvent } from "react";
import { forgotPassword, login, register, resetPassword } from "../api/auth";
import type { User } from "../api/users";
import { PASSWORD_HINT, passwordProblem } from "./passwordPolicy";

type Mode = "login" | "register" | "forgot" | "reset";
type SignUpRole = "developer" | "tester" | "manager" | "admin";

interface LoginPageProps {
  /** Called after a successful login (or sign-up + login). */
  onLoggedIn: (token: string, user: User) => void;
}

export default function LoginPage({ onLoggedIn }: LoginPageProps) {
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState<SignUpRole>("developer");
  const [accessCode, setAccessCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  // A friendly confirmation shown above the form (for example after a reset).
  const [notice, setNotice] = useState("");

  const isRegister = mode === "register";
  const isForgot = mode === "forgot";
  const isReset = mode === "reset";
  const needsCode = role === "manager" || role === "admin";

  const switchMode = (next: Mode) => {
    setMode(next);
    setError("");
    setNotice("");
    setPassword("");
    setConfirmPassword("");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    // ---- Forgot password: ask for the email, send the link ----
    if (isForgot) {
      if (!email.trim()) {
        setError("Please enter your email.");
        return;
      }
      setSubmitting(true);
      setError("");
      try {
        // The account exists: go on to choosing the new password.
        await forgotPassword(email.trim());
        setPassword("");
        setConfirmPassword("");
        setMode("reset");
        setNotice("Account found. Create a new password.");
      } catch (err) {
        setError(readError(err, "Could not look up this email. Please try again."));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // ---- Reset password: choose a new password from the emailed link ----
    if (isReset) {
      const problem = passwordProblem(password);
      if (problem) {
        setError(problem);
        return;
      }
      if (password !== confirmPassword) {
        setError("The two passwords do not match.");
        return;
      }
      setSubmitting(true);
      setError("");
      try {
        const result = await resetPassword(email.trim(), password);
        setMode("login");
        setPassword("");
        setConfirmPassword("");
        setNotice(result.message);
      } catch (err) {
        setError(readError(err, "Could not reset the password. Please try again."));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // ---- Log in / create account ----
    const trimmedEmail = email.trim();
    const trimmedName = name.trim();

    if (!trimmedEmail || !password || (isRegister && !trimmedName)) {
      setError("Please fill in all fields.");
      return;
    }
    if (isRegister) {
      const problem = passwordProblem(password);
      if (problem) {
        setError(problem);
        return;
      }
    }

    if (isRegister && needsCode && !accessCode.trim()) {
      setError("Please enter the access code for this role.");
      return;
    }

    setSubmitting(true);
    setError("");
    setNotice("");

    try {
      if (isRegister) {
        await register({
          name: trimmedName,
          email: trimmedEmail,
          password,
          role,
          accessCode: needsCode ? accessCode.trim() : undefined,
        });
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

  const title = isRegister
    ? "Create your account"
    : isForgot
      ? "Forgot your password?"
      : isReset
        ? "Choose a new password"
        : "Log in";

  const subtitle = isRegister
    ? "Join your team's AgiliX workspace."
    : isForgot
      ? "Enter your email and we will check that your account exists."
      : isReset
        ? `Choose a new password for ${email.trim()}.`
        : "Welcome back.\nLog in to your workspace.";

  const buttonText = submitting
    ? isRegister
      ? "Creating account…"
      : isForgot
        ? "Checking…"
        : isReset
          ? "Saving…"
          : "Logging in…"
    : isRegister
      ? "Create account"
      : isForgot
        ? "Continue"
        : isReset
          ? "Save new password"
          : "Log in";

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit} noValidate>
        <div className="auth-logo">
          <div className="logo-mark">A</div>
          <span>AgiliX</span>
        </div>

        <h1>{title}</h1>
        <p className="auth-subtitle">{subtitle}</p>

        {notice && (
          <p className="auth-success" role="status">
            {notice}
          </p>
        )}

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

        {!isReset && (
          <>
            <label htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </>
        )}

        {isRegister && (
          <>
            <label htmlFor="auth-role">I am a</label>
            <select
              id="auth-role"
              value={role}
              onChange={(e) => setRole(e.target.value as SignUpRole)}
            >
              <option value="developer">Developer</option>
              <option value="tester">Tester</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </select>
            {needsCode && (
              <>
                <label htmlFor="auth-code">Access code</label>
                <input
                  id="auth-code"
                  type="password"
                  autoComplete="off"
                  placeholder="Given by your organisation"
                  value={accessCode}
                  onChange={(e) => setAccessCode(e.target.value)}
                />
              </>
            )}
          </>
        )}

        {!isForgot && (
          <>
            <label htmlFor="auth-password">{isReset ? "New password" : "Password"}</label>
            <input
              id="auth-password"
              type="password"
              autoComplete={isRegister || isReset ? "new-password" : "current-password"}
              placeholder={isRegister || isReset ? PASSWORD_HINT : "Your password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {(isRegister || isReset) && <p className="auth-hint">{PASSWORD_HINT}</p>}
          </>
        )}

        {isReset && (
          <>
            <label htmlFor="auth-confirm">Confirm new password</label>
            <input
              id="auth-confirm"
              type="password"
              autoComplete="new-password"
              placeholder="Type it again"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </>
        )}

        {mode === "login" && (
          <p className="auth-forgot">
            <button
              type="button"
              className="auth-link"
              onClick={() => switchMode("forgot")}
              disabled={submitting}
            >
              Forgot password?
            </button>
          </p>
        )}

        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="primary-button auth-submit" disabled={submitting}>
          {buttonText}
        </button>

        {(isForgot || isReset) && (
          <p className="auth-switch">
            <button
              type="button"
              className="auth-link"
              onClick={() => {
                switchMode("login");
              }}
              disabled={submitting}
            >
              Back to log in
            </button>
          </p>
        )}

        {isForgot && (
          <p className="auth-switch">
            New to AgiliX?{" "}
            <button
              type="button"
              className="auth-link"
              onClick={() => switchMode("register")}
              disabled={submitting}
            >
              Create an account
            </button>
          </p>
        )}

        {(mode === "login" || isRegister) && (
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
        )}
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

import { createContext, useContext } from "react";
import type { User } from "../api/users";

export interface AuthContextValue {
  /** The logged-in user. */
  user: User;
  /** Forgets the saved login and shows the login page. */
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

/** Who is logged in. Only works inside <AuthGate> (i.e. anywhere in the app after login). */
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth() must be used inside <AuthGate>");
  }
  return value;
}

/** First letter of a name, for avatars. */
export function initialOf(name: string | undefined): string {
  return name?.trim().charAt(0).toUpperCase() || "?";
}
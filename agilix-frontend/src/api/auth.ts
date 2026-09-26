import { api } from "./client";
import type { User } from "./users";

export interface LoginResponse {
  accessToken: string;
  tokenType: "Bearer";
  /** How long the token lasts, e.g. "1d". */
  expiresIn: string;
  user: User;
}

export interface RegisterData {
  name: string;
  email: string;
  password: string;
}

/** Email + password → login token and the user's details. */
export function login(email: string, password: string) {
  return api<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

/** The logged-in user (the token is added automatically by authFetch). */
export function getMe() {
  return api<User>("/auth/me");
}

/** Creates an account. No role is sent, so the backend makes it a developer. */
export function register(data: RegisterData) {
  return api<User>("/users", {
    method: "POST",
    body: JSON.stringify(data),
  });
}
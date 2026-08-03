"use client";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("mo_token");
}

export function setSession(token: string, user: unknown) {
  localStorage.setItem("mo_token", token);
  localStorage.setItem("mo_user", JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem("mo_token");
  localStorage.removeItem("mo_user");
}

export function getUser(): {
  id: string;
  authAddress: string;
  username: string | null;
  role: string;
} | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("mo_user");
  return raw ? JSON.parse(raw) : null;
}

/** Short "0x1234…abcd" form for display when there's no username. */
export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export async function api<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return body as T;
}

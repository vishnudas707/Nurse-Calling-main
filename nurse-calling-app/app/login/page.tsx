"use client";

import { DarkThemeToggle } from "flowbite-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveUserSession, getPostLoginPath } from "../lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      if (!email || !password) {
        setError("Please enter both email and password.");
        setIsLoading(false);
        return;
      }

      if (!email.includes("@")) {
        setError("Please enter a valid email address.");
        setIsLoading(false);
        return;
      }

      const apiBase = (process.env.NEXT_PUBLIC_API_URL as string) || "http://20.163.9.187:5001";

      const resp = await fetch(`${apiBase}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        // handle common status codes
        if (resp.status === 401) setError(data.error || "Invalid credentials");
        else if (resp.status === 400) setError(data.error || "Bad request");
        else setError(data.error || "Login failed. Please try again.");
        setIsLoading(false);
        return;
      }

      // success
      const token = data.token;
      const user = data.user;
      if (token) {
        try {
          if (rememberMe) {
            localStorage.setItem("auth_token", token);
            if (user) saveUserSession(user, localStorage);
          } else {
            sessionStorage.setItem("auth_token", token);
            if (user) saveUserSession(user, sessionStorage);
          }
        } catch (storageErr) {
          console.warn("Failed to save token/user to storage", storageErr);

        }
      }

      router.push(getPostLoginPath(user?.role));
    } catch (err) {
      console.error(err);
      setError("Login failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="auth-shell">
      <div className="absolute top-4 right-4 z-10">
        <DarkThemeToggle />
      </div>

      <div className="auth-card">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-700 text-base font-bold text-white shadow-md">
            CC
          </span>
          <h1 className="mt-2 text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">
            Welcome back
          </h1>
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 p-3.5 text-sm text-red-800 dark:bg-red-900/60 dark:text-red-200">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="mb-2 block text-sm font-medium text-gray-900 dark:text-white"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="auth-input"
              placeholder="name@example.com"
              autoComplete="email"
              required
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-2 block text-sm font-medium text-gray-900 dark:text-white"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="auth-input"
              placeholder={"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"}
              autoComplete="current-password"
              required
            />
          </div>

          <button type="submit" disabled={isLoading} className="auth-primary-btn">
            {isLoading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <div className="mt-5 text-center">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Don&apos;t have an account?{" "}
            <Link
              href="/register"
              className="font-semibold text-teal-700 hover:underline dark:text-teal-400"
            >
              Register here
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}

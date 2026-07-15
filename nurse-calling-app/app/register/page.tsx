"use client";

import { DarkThemeToggle } from "flowbite-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveUserSession } from "../lib/auth";

export default function RegisterPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    organisationId: "",
    password: "",
    confirmPassword: "",
  });
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (formData.password !== formData.confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (formData.password.length < 8) {
      setError("Password must be at least 8 characters long");
      return;
    }

    const organisationId = formData.organisationId.trim();
    if (!organisationId) {
      setError("Organisation ID is required");
      return;
    }

    if (!formData.email.includes("@")) {
      setError("Please enter a valid email address");
      return;
    }

    setIsLoading(true);

    try {
      const apiBase =
        (process.env.NEXT_PUBLIC_API_URL as string) || "http://20.163.9.187:5001";
      const name = `${formData.firstName.trim()} ${formData.lastName.trim()}`.trim();
      const id = `USER_${Date.now()}`;

      const resp = await fetch(`${apiBase}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          organisationId,
          name,
          email: formData.email.trim(),
          password: formData.password,
          role: "user",
        }),
      });

      const data = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        if (resp.status === 409) {
          setError(data.error || "An account with this email already exists");
        } else if (resp.status === 400) {
          setError(data.error || "Please check all required fields");
        } else {
          setError(data.error || "Registration failed. Please try again.");
        }
        return;
      }

      const token = data.token;
      const registered = data.data;
      if (token && registered) {
        const user = {
          id: registered.id,
          name: registered.name,
          email: registered.email,
          role: registered.role,
          organisationId: registered.organisationId,
        };
        try {
          sessionStorage.setItem("auth_token", token);
          saveUserSession(user, sessionStorage);
        } catch (storageErr) {
          console.warn("Failed to save registration session", storageErr);
        }
      }

      router.push("/dashboard");
    } catch (err) {
      console.error(err);
      setError("Registration failed. Please try again.");
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
                Create account
              </h1>
            </div>

            {error && (
              <div className="mb-4 rounded-xl bg-red-50 p-3.5 text-sm text-red-800 dark:bg-red-900/60 dark:text-red-200">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="firstName"
                    className="mb-2 block text-sm font-medium text-gray-900 dark:text-white"
                  >
                    First Name
                  </label>
                  <input
                    id="firstName"
                    type="text"
                    name="firstName"
                    value={formData.firstName}
                    onChange={handleChange}
                    className="auth-input"
                    placeholder="John"
                    required
                  />
                </div>

                <div>
                  <label
                    htmlFor="lastName"
                    className="mb-2 block text-sm font-medium text-gray-900 dark:text-white"
                  >
                    Last Name
                  </label>
                  <input
                    id="lastName"
                    type="text"
                    name="lastName"
                    value={formData.lastName}
                    onChange={handleChange}
                    className="auth-input"
                    placeholder="Doe"
                    required
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="organisationId"
                  className="mb-2 block text-sm font-medium text-gray-900 dark:text-white"
                >
                  Organisation ID
                </label>
                <input
                  id="organisationId"
                  type="text"
                  name="organisationId"
                  value={formData.organisationId}
                  onChange={handleChange}
                  className="auth-input"
                  placeholder="e.g. ORG001"
                  required
                />
              </div>

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
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  className="auth-input"
                  placeholder="name@example.com"
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
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  className="auth-input"
                  placeholder="••••••••"
                  required
                />
                <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                  At least 8 characters
                </p>
              </div>

              <div>
                <label
                  htmlFor="confirmPassword"
                  className="mb-2 block text-sm font-medium text-gray-900 dark:text-white"
                >
                  Confirm Password
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  name="confirmPassword"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  className="auth-input"
                  placeholder="••••••••"
                  required
                />
              </div>

              <button type="submit" disabled={isLoading} className="auth-primary-btn">
                {isLoading ? "Creating account..." : "Create Account"}
              </button>
            </form>

            <div className="mt-5 text-center">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Already have an account?{" "}
                <Link
                  href="/login"
                  className="font-semibold text-teal-700 hover:underline dark:text-teal-400"
                >
                  Sign in here
                </Link>
              </p>
            </div>
      </div>
    </main>
  );
}

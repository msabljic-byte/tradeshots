"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type AuthMode = "login" | "signup";

export default function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [needsConfirmationResend, setNeedsConfirmationResend] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState<
    { type: "success" | "error"; text: string } | null
  >(null);
  const [loading, setLoading] = useState(false);

  const isSignup = mode === "signup";

  function isEmailNotConfirmed(message: string) {
    const m = message.toLowerCase();
    return (
      // Supabase wording depends on your configuration, but "not confirmed"
      // is the key phrase we care about.
      m.includes("not confirmed")
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNeedsConfirmationResend(false);
    setResendLoading(false);
    setResendMessage(null);

    if (!email || !password || (isSignup && !confirmPassword)) {
      setError("Please fill out all required fields.");
      return;
    }

    if (isSignup && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      if (isSignup) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });

        if (error) {
          if (isEmailNotConfirmed(error.message)) {
            setNeedsConfirmationResend(true);
          } else {
            setError(error.message);
          }
          return;
        }

        // If your Supabase is set to auto-login after signup, redirect now.
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session) router.replace("/dashboard");
        else setError("Signup successful. Please check your email to confirm.");
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        if (isEmailNotConfirmed(error.message)) setNeedsConfirmationResend(true);
        else setError(error.message);
        return;
      }

      router.replace("/dashboard");
    } finally {
      setLoading(false);
    }
  }

  async function handleResendEmail() {
    if (!email) return;

    setResendLoading(true);
    setResendMessage(null);
    setError(null);
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email,
      });

      if (resendError) {
        setResendMessage({ type: "error", text: resendError.message });
        return;
      }

      setResendMessage({
        type: "success",
        text: "Confirmation email resent. Please check your inbox.",
      });
    } finally {
      setResendLoading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-md">
        <h1 className="mb-6 text-3xl font-semibold text-gray-900">
          {isSignup ? "Create your account" : "Welcome back"}
        </h1>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 placeholder-gray-500 outline-none focus:ring-2 focus:ring-black"
              placeholder="you@example.com"
              required
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              className="text-sm font-medium text-gray-700"
              htmlFor="password"
            >
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete={isSignup ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 w-full rounded-lg border border-gray-300 bg-white px-4 py-2 pr-12 text-sm text-gray-900 placeholder-gray-500 outline-none focus:ring-2 focus:ring-black"
                placeholder="Your password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 transition hover:text-gray-700"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    className="h-5 w-5"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.27-2.943-9.543-7a9.956 9.956 0 012.223-3.592M6.1 6.1A9.956 9.956 0 0112 5c4.478 0 8.27 2.943 9.543 7a9.965 9.965 0 01-4.132 5.411M15 12a3 3 0 00-3-3m0 0a3 3 0 00-3 3m3-3v3m0 0v3m0-3h3m-3 0H9"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 3l18 18"
                    />
                  </svg>
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    className="h-5 w-5"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                    />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {!isSignup && (
            <div className="mt-1 flex justify-end">
              <Link
                href="/reset-password"
                className="text-sm text-gray-600 hover:text-black"
              >
                Forgot password?
              </Link>
            </div>
          )}

          {isSignup && (
            <div className="flex flex-col gap-1">
              <label
                className="text-sm font-medium text-gray-700"
                htmlFor="confirmPassword"
              >
                Confirm password
              </label>
              <div className="relative">
                <input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="h-11 w-full rounded-lg border border-gray-300 bg-white px-4 py-2 pr-12 text-sm text-gray-900 placeholder-gray-500 outline-none focus:ring-2 focus:ring-black"
                  placeholder="Re-enter your password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 transition hover:text-gray-700"
                  aria-label={
                    showConfirmPassword ? "Hide confirm password" : "Show confirm password"
                  }
                >
                  {showConfirmPassword ? (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      className="h-5 w-5"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.27-2.943-9.543-7a9.956 9.956 0 012.223-3.592M6.1 6.1A9.956 9.956 0 0112 5c4.478 0 8.27 2.943 9.543 7a9.965 9.965 0 01-4.132 5.411M15 12a3 3 0 00-3-3m0 0a3 3 0 00-3 3m3-3v3m0 0v3m0-3h3m-3 0H9"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 3l18 18"
                      />
                    </svg>
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      className="h-5 w-5"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                      />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          )}

          {needsConfirmationResend ? (
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm">
              <p className="font-medium text-yellow-900">
                Email not confirmed. Resend confirmation email?
              </p>

              <button
                type="button"
                disabled={resendLoading}
                onClick={handleResendEmail}
                className="mt-3 inline-flex h-10 items-center justify-center rounded-lg bg-black px-4 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-60"
              >
                {resendLoading ? "Resending..." : "Resend email"}
              </button>

              {resendMessage && (
                <p
                  className={`mt-3 text-sm ${
                    resendMessage.type === "success"
                      ? "text-green-800"
                      : "text-red-800"
                  }`}
                >
                  {resendMessage.text}
                </p>
              )}
            </div>
          ) : (
            error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
                {error}
              </div>
            )
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 h-11 rounded-lg bg-black px-4 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-60"
          >
            {loading ? "Please wait..." : isSignup ? "Sign up" : "Log in"}
          </button>
        </form>
      </div>
    </div>
  );
}


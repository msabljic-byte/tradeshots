"use client";

/**
 * Shared email/password form for login and signup. Handles confirmation flows (resend email) and
 * routes to `/dashboard` on successful password sign-in or auto-confirmed signup.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { Eye, EyeOff } from "lucide-react";

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
      <div className="rounded-2xl border border-default bg-surface p-8 shadow-md">
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
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 transition-colors hover:text-black"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <EyeOff className="h-5 w-5" aria-hidden />
                ) : (
                  <Eye className="h-5 w-5" aria-hidden />
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
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 transition-colors hover:text-black"
                  aria-label={
                    showConfirmPassword ? "Hide confirm password" : "Show confirm password"
                  }
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-5 w-5" aria-hidden />
                  ) : (
                    <Eye className="h-5 w-5" aria-hidden />
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


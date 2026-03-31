"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasSession, setHasSession] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadSession() {
      setCheckingSession(true);
      setError(null);

      const { data } = await supabase.auth.getSession();
      if (!mounted) return;

      setHasSession(Boolean(data.session));
      setCheckingSession(false);
    }

    loadSession();

    return () => {
      mounted = false;
    };
  }, []);

  const canSubmit = useMemo(() => {
    if (!hasSession) return false;
    if (!newPassword || !confirmPassword) return false;
    return true;
  }, [confirmPassword, hasSession, newPassword]);

  async function handleUpdatePassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!newPassword || !confirmPassword) {
      setError("Please fill out all required fields.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (!hasSession) {
      setError("Invalid or expired link");
      return;
    }

    setUpdating(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        setError(error.message);
        return;
      }

      setSuccess("Password updated successfully. You are now logged in.");
      setTimeout(() => {
        router.replace("/dashboard");
      }, 1500);
    } finally {
      setUpdating(false);
    }
  }

  if (checkingSession) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6 font-sans">
        <div className="w-full max-w-md rounded-xl border border-default bg-surface p-6 shadow-sm">
          <p className="text-sm text-zinc-600">Checking your session...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 font-sans">
      <div className="mx-auto w-full max-w-md">
        <div className="rounded-2xl border border-default bg-surface p-8 shadow-md">
          <h1 className="mb-6 text-2xl font-bold text-gray-900">
            Update password
          </h1>

          {!hasSession && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              Invalid or expired link
            </div>
          )}

          <form className="flex flex-col gap-4" onSubmit={handleUpdatePassword}>
            <div className="flex flex-col gap-1">
              <label
                className="text-sm font-medium text-gray-700"
                htmlFor="newPassword"
              >
                New password
              </label>
              <input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="h-11 w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 placeholder-gray-500 outline-none focus:ring-2 focus:ring-black"
                placeholder="Enter a new password"
                required
              />
            </div>

            <div className="flex flex-col gap-1">
              <label
                className="text-sm font-medium text-gray-700"
                htmlFor="confirmPassword"
              >
                Confirm password
              </label>
              <input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="h-11 w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 placeholder-gray-500 outline-none focus:ring-2 focus:ring-black"
                placeholder="Re-enter your new password"
                required
              />
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
                {error}
              </div>
            )}

            {success && (
              <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
                {success}
              </div>
            )}

            <button
              type="submit"
              disabled={!canSubmit || updating}
              className="mt-2 h-11 rounded-lg bg-black px-4 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-60"
            >
              {updating ? "Updating..." : "Update password"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}


"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function DashboardPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadSession() {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/login");
        return;
      }

      setEmail(session.user.email ?? null);
    }

    loadSession().finally(() => setCheckingSession(false));
  }, [router]);

  const logoutLabel = useMemo(
    () => (signingOut ? "Signing out..." : "Log out"),
    [signingOut]
  );

  async function handleLogout() {
    setSigningOut(true);
    setError(null);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        setError(error.message);
        return;
      }
      router.replace("/login");
    } finally {
      setSigningOut(false);
    }
  }

  if (checkingSession) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-50 p-6 font-sans">
        <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-zinc-600">Checking your session...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 p-6 font-sans">
      <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h1 className="mb-2 text-2xl font-semibold">You are logged in</h1>
        <p className="mb-6 text-sm text-zinc-600">
          Signed in as:{" "}
          <span className="font-medium text-zinc-900">{email ?? "unknown"}</span>
        </p>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          onClick={handleLogout}
          disabled={signingOut}
          className="h-11 w-full rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60"
        >
          {logoutLabel}
        </button>
      </div>
    </main>
  );
}


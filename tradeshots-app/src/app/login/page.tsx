"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Globe } from "lucide-react";
import AuthForm from "@/components/auth/AuthForm";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const router = useRouter();
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function redirectIfLoggedIn() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session && isMounted) router.replace("/dashboard");
    }

    redirectIfLoggedIn();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session) router.replace("/dashboard");
      }
    );

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [router]);

  async function handleGoogleLogin() {
    setOauthError(null);
    setOauthLoading(true);
    try {
      const redirectTo = `${window.location.origin}/dashboard`;

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });

      if (error) setOauthError(error.message);
    } finally {
      setOauthLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6 font-sans">
      <div className="flex w-full max-w-md flex-col items-center gap-4">
        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={oauthLoading}
          className="group flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-900 transition hover:bg-gray-100 disabled:opacity-60"
        >
          <span aria-hidden="true" className="inline-flex h-5 w-5 items-center justify-center">
            <Globe className="h-5 w-5 text-gray-600 transition-colors group-hover:text-black" aria-hidden />
          </span>
          {oauthLoading ? "Starting..." : "Continue with Google"}
        </button>

        {oauthError && (
          <div className="w-full rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
            {oauthError}
          </div>
        )}

        <AuthForm mode="login" />

        <p className="text-center text-sm text-gray-600">
          Don&apos;t have an account?{" "}
          <Link
            className="font-medium text-gray-900 underline underline-offset-4 hover:text-gray-700"
            href="/signup"
          >
            Sign up
          </Link>
        </p>
      </div>
    </main>
  );
}


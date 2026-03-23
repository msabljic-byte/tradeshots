"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
          className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-900 transition hover:bg-gray-100 disabled:opacity-60"
        >
          <span aria-hidden="true" className="inline-flex h-5 w-5 items-center justify-center">
            {/* Simple Google "G" mark (inline SVG keeps dependencies minimal). */}
            <svg
              width="20"
              height="20"
              viewBox="0 0 48 48"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M44.5 20H24V28.5H35.3C34 33.2 29.7 36.5 24 36.5C17 36.5 11.3 30.8 11.3 23.8C11.3 16.8 17 11.1 24 11.1C27.5 11.1 30.7 12.5 33 14.7L39.2 8.5C35 4.5 29.6 2 24 2C12.9 2 4 10.9 4 22C4 33.1 12.9 42 24 42C35.1 42 44 33.1 44 22C44 21.3 44.4 20 44.5 20Z"
                fill="#4285F4"
              />
              <path
                d="M6.6 14.8L13.4 20.2C15.2 15.9 19.4 12.9 24 12.9C27.5 12.9 30.7 14.2 33 16.5L39.2 10.3C35 6.3 29.6 3.8 24 3.8C17.2 3.8 11.2 7.7 6.6 14.8Z"
                fill="#34A853"
              />
              <path
                d="M24 42C29.6 42 35 39.5 39.2 35.5L32.9 29.2C30.7 31.5 27.5 32.8 24 32.8C18.4 32.8 13.9 29.5 12.1 24.7L5.2 30.1C9.7 37.3 15.9 42 24 42Z"
                fill="#FBBC05"
              />
              <path
                d="M12.1 24.7C11.6 23.3 11.3 21.8 11.3 20.2C11.3 18.6 11.6 17.1 12.1 15.7L5.2 10.3C4.4 11.9 4 13.9 4 16C4 20.1 4.4 21.8 5.2 23.9L12.1 24.7Z"
                fill="#EA4335"
              />
            </svg>
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


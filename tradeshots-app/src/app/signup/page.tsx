"use client";

/**
 * Sign-up page: email/password via `AuthForm`; redirects to `/dashboard` when a session exists.
 *
 * `useEffect` (see `// useEffect:`): same redirect pattern as login — session check + `onAuthStateChange`.
 */
import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthForm from "@/components/auth/AuthForm";
import { Logo } from "@/components/brand/Logo";
import { supabase } from "@/lib/supabaseClient";

export default function SignupPage() {
  const router = useRouter();

  // useEffect: redirect authenticated users away from signup; cleanup auth subscription on unmount.
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

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 font-sans">
      <div className="flex w-full max-w-md flex-col items-center gap-4">
        <Logo variant="stacked" sealSize="lg" />
        <AuthForm mode="signup" />

        <p className="app-body text-center">
          Already registered?{" "}
          <Link
            className="text-label text-muted hover:text-foreground"
            href="/login"
          >
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}


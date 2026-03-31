"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthForm from "@/components/auth/AuthForm";
import { supabase } from "@/lib/supabaseClient";

export default function SignupPage() {
  const router = useRouter();

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
        <AuthForm mode="signup" />

        <p className="text-center text-sm text-gray-600">
          Already have an account?{" "}
          <Link
            className="font-medium text-gray-900 underline underline-offset-4 hover:text-gray-700"
            href="/login"
          >
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}


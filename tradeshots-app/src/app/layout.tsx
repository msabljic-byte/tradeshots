/**
 * Root layout for the Tradeshots Next.js app (App Router).
 * - Loads Shirumi typography fonts and global CSS.
 * - Injects a tiny inline script before paint to set `data-theme` from localStorage or system preference,
 *   avoiding a flash of wrong theme on hard reload (pairs with `src/lib/theme.ts` and `globals.css`).
 */
import type { Metadata } from "next";
import { Fraunces, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const shirumiSerif = Fraunces({
  variable: "--font-shirumi-serif",
  subsets: ["latin"],
});

const shirumiMono = JetBrains_Mono({
  variable: "--font-shirumi-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Shirumi",
  description: "A private study of your trading patterns.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${shirumiSerif.variable} ${shirumiMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(() => {
              try {
                const stored = localStorage.getItem("shirumi-theme") ?? localStorage.getItem("theme");
                if (stored === "light" || stored === "dark") {
                  document.documentElement.setAttribute("data-theme", stored);
                } else {
                  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
                  document.documentElement.setAttribute("data-theme", prefersDark ? "dark" : "light");
                }
              } catch {}
            })();`,
          }}
        />
      </head>
      <body
        className="min-h-full flex flex-col bg-background text-foreground font-sans text-sm leading-6"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}

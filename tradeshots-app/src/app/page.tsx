/**
 * Marketing / placeholder home route (default Create Next App content).
 * Authenticated work happens under `/dashboard`; this page is not the main product entry.
 */
import Image from "next/image";

export default function Home() {
  return (
    <div className="flex flex-1 items-center justify-center bg-background px-6 py-16">
      <main className="w-full max-w-3xl rounded-2xl border border-default bg-surface p-10 shadow-sm">
        <Image
          className="dark:invert"
          src="/next.svg"
          alt="Next.js logo"
          width={100}
          height={20}
          priority
        />
        <div className="mt-8 flex flex-col gap-4">
          <h1 className="app-page-title">
            To get started, edit the page.tsx file.
          </h1>
          <p className="app-body max-w-2xl">
            Looking for a starting point or more instructions? Head over to{" "}
            <a
              href="https://vercel.com/templates?framework=next.js&utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
              className="app-button-text text-gray-900 dark:text-gray-100"
            >
              Templates
            </a>{" "}
            or the{" "}
            <a
              href="https://nextjs.org/learn?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
              className="app-button-text text-gray-900 dark:text-gray-100"
            >
              Learning
            </a>{" "}
            center.
          </p>
        </div>
        <div className="mt-8 flex flex-col gap-4 sm:flex-row">
          <a
            className="app-button-text flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-black px-5 text-white transition hover:bg-gray-800 md:w-[170px]"
            href="https://vercel.com/new?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Image
              className="dark:invert"
              src="/vercel.svg"
              alt="Vercel logomark"
              width={16}
              height={16}
            />
            Deploy Now
          </a>
          <a
            className="app-button-text flex h-11 w-full items-center justify-center rounded-lg border border-gray-300 bg-white px-5 text-gray-700 transition hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 md:w-[170px]"
            href="https://nextjs.org/docs?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
            target="_blank"
            rel="noopener noreferrer"
          >
            Documentation
          </a>
        </div>
      </main>
    </div>
  );
}

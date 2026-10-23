import Link from 'next/link';

// Phase 0 placeholder. The real discovery experience (search, categories, assistant cards)
// ships in Phase 1 — see docs/ROADMAP.md. No search UI is shown until it actually works.
export default function HomePage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
        Get your time back.
      </h1>
      <p className="mt-4 max-w-xl text-lg text-ink-muted">
        Qyou connects you with trusted people who wait in line or run eligible errands for you. The
        marketplace is under construction.
      </p>
      <Link
        href="/status"
        className="mt-8 inline-flex h-11 items-center rounded-full bg-brand-600 px-6 font-semibold text-white hover:bg-brand-700"
      >
        System status
      </Link>
    </main>
  );
}

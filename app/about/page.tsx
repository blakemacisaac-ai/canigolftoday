import Link from "next/link";

const STRIPE_PAYMENT_LINK =
  process.env.NEXT_PUBLIC_STRIPE_COFFEE_LINK || "https://buy.stripe.com/REPLACE_ME";

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-[#0b0f14] text-white">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-3xl font-semibold tracking-tight">About</h1>
          <Link
            href="/"
            className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-semibold text-white/90 ring-1 ring-white/10 hover:bg-white/15 transition"
          >
            ← Back
          </Link>
        </div>

        <p className="mt-6 text-white/75 leading-relaxed">
          CanIGolfToday helps you quickly figure out whether the weather is good enough to get out for a round,
          and what the best window is.
        </p>

        <section className="mt-10 rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
          <h2 className="text-lg font-semibold">Support the site</h2>
          <p className="mt-2 text-sm text-white/70">
            If this saved you time (or a wasted drive), you can chip in to help cover hosting + API costs.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <a
              href={STRIPE_PAYMENT_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-black hover:opacity-90"
            >
              ☕ Buy me a coffee
            </a>
            <span className="text-xs text-white/50">
              Secure checkout via Stripe • Opens in a new tab
            </span>
          </div>
        </section>

        <section className="mt-8 rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
          <h2 className="text-lg font-semibold">Contact</h2>
          <p className="mt-2 text-sm text-white/70">
            Want to report a bug, request a feature, suggest a course source — or inquire about advertising opportunities?
          </p>

          <div className="mt-4 space-y-2 text-sm">
            <div>
              <span className="text-white/60">Email:</span>{" "}
              <a className="underline underline-offset-4 hover:text-white" href="mailto:blakemacisaac@gmail.com">
                blakemacisaac@gmail.com
              </a>
            </div>
          </div>
        </section>

        <div className="mt-10 text-center text-xs text-white/45">
          Built for golfers who just want the answer: can I golf today?
        </div>
      </div>
    </main>
  );
}

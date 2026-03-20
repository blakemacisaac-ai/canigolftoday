import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About",
  description: "About CanIGolfToday — how it works, how conditions are scored, and how to get in touch.",
};

const STRIPE_PAYMENT_LINK =
  process.env.NEXT_PUBLIC_STRIPE_COFFEE_LINK || "https://donate.stripe.com/5kQdR82REh2195c8R23wQ01";

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
            Back
          </Link>
        </div>

        <p className="mt-6 text-white/75 leading-relaxed">
          I built this because I kept checking three different weather apps before a round and still
          showing up to a soaked fairway. CanIGolfToday gives you one number — a 0–100 conditions
          score — and tells you the best 3-hour window to tee off. That is it.
        </p>

        <section className="mt-8 rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
          <h2 className="text-lg font-semibold">What the score means</h2>
          <div className="mt-4 space-y-3">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 text-lg">🟢</span>
              <div>
                <div className="text-sm font-semibold text-white/90">80–100 · Book it</div>
                <div className="text-sm text-white/55">Great conditions. Book it.</div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 text-lg">🟡</span>
              <div>
                <div className="text-sm font-semibold text-white/90">60–79 · Playable</div>
                <div className="text-sm text-white/55">Worth going if you catch the right window.</div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 text-lg">🔴</span>
              <div>
                <div className="text-sm font-semibold text-white/90">Below 60 · Tough day</div>
                <div className="text-sm text-white/55">Probably not worth it. Check the next few days.</div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 text-lg">⛔</span>
              <div>
                <div className="text-sm font-semibold text-white/90">Off-season · Not golfable</div>
                <div className="text-sm text-white/55">Courses are likely closed or under snow. No score shown.</div>
              </div>
            </div>
          </div>
          <p className="mt-4 text-sm text-white/40 border-t border-white/10 pt-4">
            Scores weigh temperature, wind, precipitation, humidity, and daylight.
            The best window is the highest-scoring 3-hour stretch within golfing hours.
            In off-season regions (Nov–Mar for northern latitudes), no score is shown.
          </p>
        </section>

        <section className="mt-6 rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
          <h2 className="text-lg font-semibold">Support the project</h2>
          <p className="mt-2 text-sm text-white/70">
            CanIGolfToday is free and has no ads. If it has saved you a wasted trip, a coffee goes a
            long way toward keeping the lights on.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <a
              href={STRIPE_PAYMENT_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-black hover:opacity-90 transition"
            >
              Buy me a coffee
            </a>
            <span className="text-xs text-white/40">via Stripe · opens in new tab</span>
          </div>
        </section>

        <section className="mt-6 rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
          <h2 className="text-lg font-semibold">Get in touch</h2>
          <p className="mt-2 text-sm text-white/70">
            Found a bug? Have a course you want added? Just want to talk golf?
          </p>
          <div className="mt-3 text-sm">
            <a
              href="mailto:blakemacisaac@gmail.com"
              className="text-white/80 underline underline-offset-4 hover:text-white transition"
            >
              blakemacisaac@gmail.com
            </a>
          </div>
        </section>

        <section className="mt-6 rounded-2xl bg-white/5 p-6 ring-1 ring-white/10" id="privacy">
          <h2 className="text-lg font-semibold">Privacy Policy</h2>
          <p className="mt-1 text-xs text-white/40">Last updated: March 2026</p>
          <div className="mt-4 space-y-4 text-sm text-white/70 leading-relaxed">
            <p>
              CanIGolfToday is committed to protecting your privacy. This policy explains
              what information we collect and how we use it.
            </p>
            <div>
              <div className="font-semibold text-white/90 mb-1">Location Data</div>
              <p>
                When you tap "Use my location", we request your device's GPS coordinates solely to
                fetch local weather and find nearby golf courses. Your location is sent directly to
                our weather and mapping APIs to generate your conditions score. We do not store your
                location on our servers and do not share it with third parties for advertising or
                any other purpose.
              </p>
            </div>
            <div>
              <div className="font-semibold text-white/90 mb-1">Data We Collect</div>
              <p>
                We collect an anonymized visitor count to understand how many golfers use the app
                each week. No personal information is associated with this count. We do not collect
                names, email addresses, or any account information.
              </p>
            </div>
            <div>
              <div className="font-semibold text-white/90 mb-1">Third-Party Services</div>
              <p>
                CanIGolfToday uses OpenWeatherMap (weather data), Google Places API (course search
                and location resolution), and Upstash Redis (anonymous visitor counting). Each
                service operates under its own privacy policy.
              </p>
            </div>
            <div>
              <div className="font-semibold text-white/90 mb-1">Children's Privacy</div>
              <p>
                This app is intended for users 18 and older. We do not knowingly collect
                information from children under 13.
              </p>
            </div>
            <div>
              <div className="font-semibold text-white/90 mb-1">Contact</div>
              <p>
                Questions about this policy? Email us at{" "}
                <a
                  href="mailto:blakemacisaac@gmail.com"
                  className="text-white/80 underline underline-offset-4 hover:text-white transition"
                >
                  blakemacisaac@gmail.com
                </a>
              </p>
            </div>
          </div>
        </section>

        <div className="mt-10 text-center text-xs text-white/35">
          Built by a golfer, for golfers. No fluff — just the forecast.
        </div>

      </div>
    </main>
  );
}

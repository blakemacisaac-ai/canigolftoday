import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — CanIGolfToday",
  description: "Privacy policy for the CanIGolfToday web app and mobile app.",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#0b0f14] text-white">
      <div className="mx-auto max-w-3xl px-6 py-12">

        <div className="flex items-start justify-between gap-4">
          <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
          <Link
            href="/"
            className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-semibold text-white/90 ring-1 ring-white/10 hover:bg-white/15 transition"
          >
            Back
          </Link>
        </div>

        <p className="mt-2 text-sm text-white/40">Last updated: March 2026</p>

        <div className="mt-8 space-y-8 text-sm text-white/70 leading-relaxed">

          <p>
            CanIGolfToday is committed to protecting your privacy. This policy explains what
            information we collect, how we use it, and your rights regarding that information.
            This policy applies to both the CanIGolfToday website and mobile app.
          </p>

          <section>
            <h2 className="text-base font-semibold text-white/90 mb-2">Location Data</h2>
            <p>
              When you tap "Use my location", we request your device's GPS coordinates solely
              to fetch local weather conditions and find nearby golf courses. Your location is
              transmitted directly to our weather and mapping API providers to generate your
              conditions score and course list. We do not store your precise location on our
              servers. We do not share your location with third parties for advertising,
              analytics, or any purpose beyond delivering the core app functionality.
            </p>
            <p className="mt-3">
              You may also search by city name instead of sharing your location — no GPS
              permission is required for this.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white/90 mb-2">Data We Collect</h2>
            <p>
              We collect an anonymized visitor count to understand how many golfers use the
              app each week. This count is not linked to any personal information, device
              identifier, or IP address. We do not collect names, email addresses, payment
              information, or account credentials.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white/90 mb-2">Third-Party Services</h2>
            <p>CanIGolfToday relies on the following third-party services:</p>
            <ul className="mt-3 space-y-2 list-disc list-inside text-white/60">
              <li>
                <span className="text-white/80 font-medium">OpenWeatherMap</span>
                {" — weather forecast data"}
              </li>
              <li>
                <span className="text-white/80 font-medium">Google Places API</span>
                {" — golf course search and location resolution"}
              </li>
              <li>
                <span className="text-white/80 font-medium">Upstash Redis</span>
                {" — anonymous visitor count storage"}
              </li>
              <li>
                <span className="text-white/80 font-medium">Vercel</span>
                {" — app hosting and serverless API functions"}
              </li>
            </ul>
            <p className="mt-3">
              Each of these services operates under its own privacy policy.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white/90 mb-2">Cookies and Tracking</h2>
            <p>
              CanIGolfToday does not use advertising cookies, tracking pixels, or any
              cross-site tracking technology. We do not run ads.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white/90 mb-2">Children's Privacy</h2>
            <p>
              This app is intended for users 18 years of age and older. We do not knowingly
              collect personal information from children under 13.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white/90 mb-2">Changes to This Policy</h2>
            <p>
              We may update this policy from time to time. Any changes will be posted on this
              page with an updated date. Continued use of the app after changes constitutes
              acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white/90 mb-2">Contact</h2>
            <p>
              {"Questions or concerns? Reach us at "}
              <a
                href="mailto:blakemacisaac@gmail.com"
                className="text-white/80 underline underline-offset-4 hover:text-white transition"
              >
                blakemacisaac@gmail.com
              </a>
            </p>
          </section>

        </div>

        <div className="mt-12 text-center text-xs text-white/35">
          CanIGolfToday · Built by a golfer, for golfers.
        </div>

      </div>
    </main>
  );
}

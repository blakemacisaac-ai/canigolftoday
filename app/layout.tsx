import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const BASE_URL = "https://canigolftoday.com";

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: "Can I Golf Today? | Tee-Time Weather Forecast",
    template: "%s | CanIGolfToday.com",
  },
  description:
    "Instant golf weather forecast for any city or course. We score conditions 0–100 and find the best 3-hour tee-time window — so you know exactly when to book.",
  keywords: [
    "golf weather", "can i golf today", "golf forecast",
    "best time to golf", "tee time weather", "golf conditions today",
    "golf course weather forecast",
  ],
  authors: [{ name: "CanIGolfToday.com", url: BASE_URL }],
  creator: "CanIGolfToday.com",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: BASE_URL,
    siteName: "CanIGolfToday.com",
    title: "Can I Golf Today? | Tee-Time Weather Forecast",
    description:
      "Score your golf conditions 0–100 and find the best 3-hour window to tee off — for any city or course, any day this week.",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "CanIGolfToday — Your tee-time forecast" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Can I Golf Today? | Tee-Time Weather Forecast",
    description: "Score your golf conditions 0–100 and find the best 3-hour window to tee off.",
    images: ["/og-image.png"],
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  manifest: "/manifest.json",
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0f14",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebApplication",
              name: "CanIGolfToday",
              url: BASE_URL,
              description: "Golf weather forecast that scores conditions 0–100 and finds the best 3-hour tee-time window.",
              applicationCategory: "SportsApplication",
              operatingSystem: "Web",
              offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
            }),
          }}
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";

type Props = { params: Promise<{ slug: string }> };

function slugToName(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const name = slugToName(slug);
  return {
    title: `Golf Weather in ${name}`,
    description: `Can you golf in ${name} today? Instant conditions score (0–100) and the best 3-hour tee-time window for ${name}.`,
    alternates: { canonical: `/city/${slug}` },
    openGraph: {
      title: `Golf Weather in ${name} | CanIGolfToday.com`,
      description: `Instant golf forecast for ${name} — conditions scored 0–100 with the best tee-time window.`,
      url: `/city/${slug}`,
    },
    twitter: {
      title: `Golf Weather in ${name}`,
      description: `Can you golf in ${name} today? Conditions scored 0–100.`,
    },
  };
}

export default async function CityPage({ params }: Props) {
  const { slug } = await params;
  if (!slug?.trim()) redirect("/");
  redirect(`/?q=${encodeURIComponent(slug.trim())}`);
}

import { redirect } from "next/navigation";

export default async function CityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!slug?.trim()) redirect("/");

  // City landing pages simply hydrate the home search.
  // Example: /city/toronto -> /?q=toronto
  redirect(`/?q=${encodeURIComponent(slug.trim())}`);
}

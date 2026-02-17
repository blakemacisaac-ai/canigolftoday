import { redirect } from "next/navigation";

export default function CityPage({ params }: { params: { slug: string } }) {
  const slug = (params?.slug || "").trim();
  if (!slug) redirect("/");

  // City landing pages simply hydrate the home search.
  // Example: /city/toronto -> /?q=toronto
  redirect(`/?q=${encodeURIComponent(slug)}`);
}

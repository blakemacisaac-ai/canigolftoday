import { NextResponse } from "next/server";

const includeNameRegex = /(simulator|indoor|virtual|golf|trackman|sports bar|golf house|next golf)/i;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");

  if (!lat || !lon) {
    return NextResponse.json({ error: "Missing lat/lon" }, { status: 400 });
  }

  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "Missing GOOGLE_PLACES_API_KEY" }, { status: 500 });
  }

  const url =
    `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
    `?location=${encodeURIComponent(`${lat},${lon}`)}` +
    `&rankby=distance` +
    `&type=establishment` +
    `&keyword=${encodeURIComponent("golf simulator indoor golf")}` +
    `&key=${encodeURIComponent(key)}`;

  const res = await fetch(url);
  const data = await res.json();

  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    return NextResponse.json(
      {
        error: "Places error",
        googleStatus: data.status,
        googleError: data.error_message ?? null,
      },
      { status: 502 }
    );
  }

  const raw = data.results ?? [];

  // Keep simulator-ish entries
  const sims = raw
    .filter((p: any) => includeNameRegex.test(String(p?.name ?? "")))
    .slice(0, 10)
    .map((p: any) => ({
      placeId: p.place_id,
      name: p.name,
      rating: p.rating ?? null,
      userRatingsTotal: p.user_ratings_total ?? null,
      address: p.vicinity ?? p.formatted_address ?? null,
      openNow: p.opening_hours?.open_now ?? null,
      mapsUrl: p.place_id
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
            p.name
          )}&query_place_id=${encodeURIComponent(p.place_id)}`
        : null,
    }));

  return NextResponse.json({ simulators: sims });
}

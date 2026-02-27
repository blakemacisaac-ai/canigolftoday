import { NextResponse } from "next/server";

/**
 * Simulators API - Migrated to Places API (New)
 * Uses searchNearby with field masking to minimize billing cost.
 */

const INCLUDE_NAME_REGEX =
  /(simulator|indoor|virtual|golf|trackman|sports bar|golf house|next golf)/i;

// Only request fields we actually use — Basic tier ($17/1000)
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.rating",
  "places.userRatingCount",
  "places.currentOpeningHours",
].join(",");

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

  const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({
      // "establishment" doesn't exist in the new API — use broader types
      includedTypes: ["sports_complex", "sports_club", "entertainment_and_recreation"],
      maxResultCount: 20,
      locationRestriction: {
        circle: {
          center: {
            latitude: parseFloat(lat),
            longitude: parseFloat(lon),
          },
          radius: 20000,
        },
      },
      rankPreference: "DISTANCE",
    }),
    cache: "no-store",
  });

  const data = await res.json();

  if (!res.ok) {
    return NextResponse.json(
      { error: "Places error", google: data },
      { status: 502 }
    );
  }

  const raw: any[] = Array.isArray(data?.places) ? data.places : [];

  const simulators = raw
    .filter((p: any) => INCLUDE_NAME_REGEX.test(String(p?.displayName?.text ?? "")))
    .slice(0, 10)
    .map((p: any) => ({
      placeId: p.id,
      name: p.displayName?.text ?? null,
      rating: p.rating ?? null,
      userRatingsTotal: p.userRatingCount ?? null,
      address: p.formattedAddress ?? null,
      openNow: p.currentOpeningHours?.openNow ?? null,
      mapsUrl: p.id
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
            p.displayName?.text ?? ""
          )}&query_place_id=${encodeURIComponent(p.id)}`
        : null,
    }));

  return NextResponse.json({ simulators });
}

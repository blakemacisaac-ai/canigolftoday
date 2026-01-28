import { NextResponse } from "next/server";

// --- Filtering helpers (to keep simulators/bars out) ---
const includeType = new Set(["golf_course"]);

const excludeType = new Set([
  "bar",
  "restaurant",
  "night_club",
  "lodging",
  "gym",
  "school",
  "store",
  "cafe",
]);

const excludeNameRegex =
  /(simulator|indoor|virtual|sports bar|bar|academy|lessons?|fitting|driving range|range|mini golf|putt|topgolf)/i;

const fallbackGolfNameRegex = /(golf|country club|golf club|links|fairways|greens)/i;

function isRealCourse(p: any) {
  const types: string[] = Array.isArray(p?.types) ? p.types : [];
  const name: string = String(p?.name ?? "");

  // Hard exclude by name
  if (excludeNameRegex.test(name)) return false;

  // If Google explicitly says it's a golf course, accept it
  if (types.some((t) => includeType.has(t))) return true;

  // If it contains obvious non-course types, reject it
  if (types.some((t) => excludeType.has(t))) return false;

  // Fallback: accept golf-ish names (last resort)
  return fallbackGolfNameRegex.test(name);
}

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

  // Most reliable approach: rankby=distance + keyword, then filter results
  // NOTE: rankby=distance cannot be combined with radius (Google rule)
  const url =
    `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
    `?location=${encodeURIComponent(`${lat},${lon}`)}` +
    `&rankby=distance` +
    `&type=establishment` +
    `&keyword=${encodeURIComponent("golf course")}` +
    `&key=${encodeURIComponent(key)}`;

  const res = await fetch(url);
  const data = await res.json();

  // Surface Google errors clearly
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

  // Filter out simulators/bars/etc
  const filtered = raw.filter(isRealCourse);

  // If filtering gets too aggressive, fall back to raw results,
  // but still remove obvious excluded names
  const finalList =
    filtered.length >= 5
      ? filtered
      : raw.filter((p: any) => !excludeNameRegex.test(String(p?.name ?? "")));

  const courses = finalList.slice(0, 10).map((p: any) => ({
    placeId: p.place_id,
    name: p.name,
    rating: p.rating ?? null,
    userRatingsTotal: p.user_ratings_total ?? null,
    address: p.vicinity ?? p.formatted_address ?? null,
    openNow: p.opening_hours?.open_now ?? null,
    types: p.types ?? [],
    mapsUrl: p.place_id
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          p.name
        )}&query_place_id=${encodeURIComponent(p.place_id)}`
      : null,
  }));

  return NextResponse.json({ courses });
}

import { NextResponse } from "next/server";

/**
 * Courses API v1.1:
 * 1) Try Nearby Search with type=golf_course (cleanest)
 * 2) If that returns too few, fallback to radius-based keyword search
 * 3) Filter hard to remove sims / ranges / random businesses
 */

const INCLUDE_TYPE = new Set(["golf_course"]);

const EXCLUDE_TYPES = new Set([
  // Food / nightlife
  "bar",
  "restaurant",
  "night_club",
  "cafe",

  // Retail / services
  "store",
  "convenience_store",
  "supermarket",
  "department_store",
  "clothing_store",
  "shoe_store",
  "electronics_store",
  "hardware_store",
  "home_goods_store",
  "furniture_store",
  "jewelry_store",
  "book_store",
  "bicycle_store",
  "pet_store",

  // Health
  "pharmacy",
  "drugstore",
  "doctor",
  "dentist",
  "hospital",

  // Other common non-courses
  "bank",
  "atm",
  "gas_station",
  "lodging",
  "school",
  "gym",
]);

// Strong “not a real course” signals (name OR address)
const EXCLUDE_HAYSTACK =
  /(simulator|simulators|indoor|virtual|golf lounge|lounge|sports bar|\bbar\b|academy|lessons?|instruction|fitting|clubfitting|trackman|foresight|golfzon|x-?golf|topgolf|driving range|\brange\b|mini golf|mini-golf|putt|putting|virtual golf)/i;

// Strong “this is a real course” wording (fallback only)
const STRICT_COURSE_WORDING = /(golf course|golf club|country club|\blinks\b|g&cc|\bgc\b)/i;

function normTypes(p: any): string[] {
  return Array.isArray(p?.types) ? p.types.map((t: any) => String(t).toLowerCase()) : [];
}

function isRealCourse(p: any) {
  const types = normTypes(p);
  const name = String(p?.name ?? "");
  const addr = String(p?.vicinity ?? p?.formatted_address ?? "");
  const hay = `${name} ${addr}`.toLowerCase();

  // Exclude obvious sims/ranges/mini-golf etc
  if (EXCLUDE_HAYSTACK.test(hay)) return false;

  // If Google explicitly says golf_course, trust it
  if (types.some((t) => INCLUDE_TYPE.has(t))) return true;

  // If Google says it's clearly retail/food/etc, reject
  if (types.some((t) => EXCLUDE_TYPES.has(t))) return false;

  // Fallback: only accept if it reads like a real course/club/links
  return STRICT_COURSE_WORDING.test(hay);
}

async function fetchPlaces(url: string) {
  const res = await fetch(url);
  const data = await res.json();
  return { res, data };
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

  // 1) Best: nearby search constrained by type=golf_course
  // rankby=distance cannot be combined with radius (Google rule)
  const url1 =
    `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
    `?location=${encodeURIComponent(`${lat},${lon}`)}` +
    `&rankby=distance` +
    `&type=${encodeURIComponent("golf_course")}` +
    `&key=${encodeURIComponent(key)}`;

  const { data: data1 } = await fetchPlaces(url1);

  if (data1.status !== "OK" && data1.status !== "ZERO_RESULTS") {
    return NextResponse.json(
      {
        error: "Places error",
        googleStatus: data1.status,
        googleError: data1.error_message ?? null,
      },
      { status: 502 }
    );
  }

  const raw1 = Array.isArray(data1?.results) ? data1.results : [];
  const filtered1 = raw1.filter(isRealCourse);

  // If we have enough, ship it
  if (filtered1.length >= 4) {
    const courses = filtered1.slice(0, 10).map((p: any) => ({
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

  // 2) Fallback: radius-based keyword search (wider net)
  // NOTE: max radius for Nearby Search is 50,000 meters
  const radius = 20000;

  const url2 =
    `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
    `?location=${encodeURIComponent(`${lat},${lon}`)}` +
    `&radius=${radius}` +
    `&keyword=${encodeURIComponent("golf course OR golf club OR country club OR links")}` +
    `&key=${encodeURIComponent(key)}`;

  const { data: data2 } = await fetchPlaces(url2);

  if (data2.status !== "OK" && data2.status !== "ZERO_RESULTS") {
    return NextResponse.json(
      {
        error: "Places error (fallback)",
        googleStatus: data2.status,
        googleError: data2.error_message ?? null,
      },
      { status: 502 }
    );
  }

  const raw2 = Array.isArray(data2?.results) ? data2.results : [];
  const filtered2 = raw2.filter(isRealCourse);

  // Merge (unique by place_id), keep type=golf_course results first
  const seen = new Set<string>();
  const merged: any[] = [];

  for (const p of [...filtered1, ...filtered2]) {
    const id = String(p?.place_id ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(p);
  }

  const courses = merged.slice(0, 10).map((p: any) => ({
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

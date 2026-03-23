import { NextResponse } from "next/server";
import { rateLimit, getIp } from "@/lib/rateLimit";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const EXCLUDE_HAYSTACK =
  /(simulator|simulators|indoor|virtual|golf lounge|lounge|sports bar|\bbar\b|academy|lessons?|instruction|fitting|clubfitting|trackman|foresight|golfzon|x-?golf|topgolf|driving range|\brange\b|mini golf|mini-golf|putt|putting|virtual golf)/i;

const STRICT_COURSE_WORDING = /(golf course|golf club|country club|\blinks\b|g&cc|\bgc\b)/i;

function isRealCourse(place: any): boolean {
  const name = String(place?.displayName?.text ?? "");
  const addr = String(place?.formattedAddress ?? "");
  const hay = `${name} ${addr}`;
  if (EXCLUDE_HAYSTACK.test(hay)) return false;
  const types: string[] = Array.isArray(place?.types)
    ? place.types.map((t: any) => String(t).toLowerCase())
    : [];
  if (types.includes("golf_course")) return true;
  return STRICT_COURSE_WORDING.test(hay);
}

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.rating",
  "places.userRatingCount",
  "places.currentOpeningHours",
  "places.types",
  "places.location",
].join(",");

async function searchNearby(body: object, key: string) {
  const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return res.json();
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: Request) {
  const { allowed, remaining, resetAt } = rateLimit(getIp(req), { limit: 10, windowMs: 60_000 });
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests — slow down." },
      {
        status: 429,
        headers: {
          ...CORS_HEADERS,
          "Retry-After": String(Math.ceil((resetAt - Date.now()) / 1000)),
          "X-RateLimit-Remaining": "0",
        },
      }
    );
  }

  const { searchParams } = new URL(req.url);
  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");

  if (!lat || !lon) {
    return NextResponse.json({ error: "Missing lat/lon" }, { status: 400, headers: CORS_HEADERS });
  }

  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "Missing GOOGLE_PLACES_API_KEY" }, { status: 500, headers: CORS_HEADERS });
  }

  const center = { latitude: parseFloat(lat), longitude: parseFloat(lon) };

  const data1 = await searchNearby(
    { includedTypes: ["golf_course"], maxResultCount: 10, locationRestriction: { circle: { center, radius: 20000 } }, rankPreference: "DISTANCE" },
    key
  );

  const raw1: any[] = Array.isArray(data1?.places) ? data1.places : [];
  const filtered1 = raw1.filter(isRealCourse);

  if (filtered1.length >= 4) {
    return NextResponse.json({ courses: formatCourses(filtered1.slice(0, 10)) }, { headers: CORS_HEADERS });
  }

  const data2 = await searchNearby(
    { includedTypes: ["golf_course"], maxResultCount: 20, locationRestriction: { circle: { center, radius: 50000 } }, rankPreference: "DISTANCE" },
    key
  );

  const raw2: any[] = Array.isArray(data2?.places) ? data2.places : [];
  const filtered2 = raw2.filter(isRealCourse);

  const seen = new Set<string>();
  const merged: any[] = [];
  for (const p of [...filtered1, ...filtered2]) {
    const id = String(p?.id ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(p);
  }

  return NextResponse.json({ courses: formatCourses(merged.slice(0, 10)) }, { headers: CORS_HEADERS });
}

function formatCourses(places: any[]) {
  return places.map((p: any) => ({
    placeId: p.id,
    name: p.displayName?.text ?? null,
    rating: p.rating ?? null,
    userRatingsTotal: p.userRatingCount ?? null,
    address: p.formattedAddress ?? null,
    openNow: p.currentOpeningHours?.openNow ?? null,
    types: p.types ?? [],
    mapsUrl: p.id
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.displayName?.text ?? "")}&query_place_id=${encodeURIComponent(p.id)}`
      : null,
  }));
}

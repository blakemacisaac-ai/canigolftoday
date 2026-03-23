
import { NextResponse } from "next/server";
import { rateLimit, getIp } from "@/lib/rateLimit";

/**
 * Search/Autocomplete API - Migrated to Places API (New)
 * Cities: uses Autocomplete v1 (new)
 * Courses: uses searchText v1 (new) with field masking
 *
 * Cost tip: debounce this on the frontend (300-500ms) to avoid
 * firing on every keystroke — each call hits 2 APIs simultaneously.
 */

type Kind = "city" | "course";

type Prediction = {
  kind: Kind;
  placeId: string;
  description: string;
  name?: string | null;
  address?: string | null;
};

const BUSINESS_KEYWORDS = [
  "tire", "walmart", "costco", "home depot", "shoppers", "tim horton",
  "mcdonald", "subway", "starbucks", "gas+", "pharmacy", "bank", "hotel",
  "motel", "inn ", "mall", "plaza", "store", "shop", "market", "grocery",
  "liquor", "beer store", "pizza", "station", "depot", "auto",
];

function looksLikeBusiness(description: string): boolean {
  const lower = description.toLowerCase();
  return BUSINESS_KEYWORDS.some((kw) => lower.includes(kw));
}

function looksLikeCity(description: string): boolean {
  if (!description.includes(",")) return false;
  if (/^\d/.test(description.trim())) return false;
  if (looksLikeBusiness(description)) return false;
  return true;
}

// Only request fields we use — Basic tier pricing
const COURSE_FIELD_MASK = "places.id,places.displayName,places.formattedAddress";

export async function GET(req: Request) {
  const { allowed, remaining, resetAt } = rateLimit(getIp(req), { limit: 20, windowMs: 60_000 });
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests — slow down." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((resetAt - Date.now()) / 1000)),
          "X-RateLimit-Remaining": "0",
        },
      }
    );
  }

  const { searchParams } = new URL(req.url);
  const input = (searchParams.get("q") || "").trim();

  if (!input || input.length < 2) {
    return NextResponse.json({ predictions: [] as Prediction[] });
  }

  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "Missing GOOGLE_PLACES_API_KEY" }, { status: 500 });
  }

  // 1) Cities autocomplete — New Autocomplete API
  const citiesPromise = fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
    },
    body: JSON.stringify({
      input,
      includedPrimaryTypes: ["locality", "sublocality", "administrative_area_level_3"],
    }),
    cache: "no-store",
  }).then((r) => r.json());

  // 2) Golf courses — New searchText API with field masking
  const coursesPromise = fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": COURSE_FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: `${input} golf course`,
      includedType: "golf_course",
      maxResultCount: 5,
    }),
    cache: "no-store",
  }).then((r) => r.json());

  const [citiesData, coursesData] = await Promise.all([citiesPromise, coursesPromise]);

  // Cities
  const cityPreds: Prediction[] = (citiesData?.suggestions ?? [])
    .filter((s: any) => {
      const desc = String(s?.placePrediction?.text?.text ?? "");
      return looksLikeCity(desc);
    })
    .slice(0, 4)
    .map((s: any) => ({
      kind: "city" as Kind,
      placeId: String(s?.placePrediction?.placeId ?? ""),
      description: String(s?.placePrediction?.text?.text ?? ""),
    }));

  // Courses
  const coursePreds: Prediction[] = (coursesData?.places ?? []).slice(0, 5).map((r: any) => ({
    kind: "course" as Kind,
    placeId: String(r?.id ?? ""),
    description: `${r?.displayName?.text ?? "Course"}${
      r?.formattedAddress ? ` — ${r.formattedAddress}` : ""
    }`,
    name: r?.displayName?.text ?? null,
    address: r?.formattedAddress ?? null,
  }));

  // Merge: courses first, then cities — dedupe by placeId
  const seen = new Set<string>();
  const merged = [...coursePreds, ...cityPreds].filter((p) => {
    if (!p.placeId || !p.description) return false;
    if (seen.has(p.placeId)) return false;
    seen.add(p.placeId);
    return true;
  });

  return NextResponse.json({ predictions: merged.slice(0, 8) });
}

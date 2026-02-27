import { NextResponse } from "next/server";

type Kind = "city" | "course";

type Prediction = {
  kind: Kind;
  placeId: string;
  description: string;
  name?: string | null;
  address?: string | null;
};

// Business/store keywords — if a "city" result contains these it's not a city
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

// A valid city result should have at least a country component
// Google city predictions look like "Toronto, ON, Canada" or "Paris, France"
// Business results look like "Canadian Tire — 950 Tower St S, Fergus, ON"
function looksLikeCity(description: string): boolean {
  // Must contain a comma (city, region or city, country)
  if (!description.includes(",")) return false;
  // Must NOT look like a street address (contains a number at the start)
  if (/^\d/.test(description.trim())) return false;
  // Must NOT look like a business
  if (looksLikeBusiness(description)) return false;
  return true;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const input = (searchParams.get("q") || "").trim();

  if (!input || input.length < 2) {
    return NextResponse.json({ predictions: [] as Prediction[] });
  }

  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "Missing GOOGLE_PLACES_API_KEY" }, { status: 500 });
  }

  // 1) Cities-only autocomplete — restricted to locality/sublocality types
  const citiesUrl =
    `https://maps.googleapis.com/maps/api/place/autocomplete/json` +
    `?input=${encodeURIComponent(input)}` +
    `&types=(cities)` +
    `&key=${encodeURIComponent(key)}`;

  // 2) Golf courses (Places Text Search)
  const coursesUrl =
    `https://maps.googleapis.com/maps/api/place/textsearch/json` +
    `?query=${encodeURIComponent(input + " golf course")}` +
    `&type=golf_course` +
    `&key=${encodeURIComponent(key)}`;

  const [citiesRes, coursesRes] = await Promise.all([fetch(citiesUrl), fetch(coursesUrl)]);
  const citiesData = await citiesRes.json();
  const coursesData = await coursesRes.json();

  // ---- Cities response handling ----
  if (citiesData.status !== "OK" && citiesData.status !== "ZERO_RESULTS") {
    return NextResponse.json(
      {
        error: "Places autocomplete (cities) error",
        googleStatus: citiesData.status,
        googleError: citiesData.error_message ?? null,
      },
      { status: 502 }
    );
  }

  // ---- Courses response handling ----
  if (coursesData.status !== "OK" && coursesData.status !== "ZERO_RESULTS") {
    return NextResponse.json(
      {
        error: "Places textsearch (golf_course) error",
        googleStatus: coursesData.status,
        googleError: coursesData.error_message ?? null,
      },
      { status: 502 }
    );
  }

  const cityPreds: Prediction[] = (citiesData.predictions ?? [])
    .filter((p: any) => {
      const desc = String(p?.description ?? "");
      // Only include results that look like real cities
      return looksLikeCity(desc);
    })
    .slice(0, 4)
    .map((p: any) => ({
      kind: "city" as Kind,
      placeId: String(p?.place_id ?? ""),
      description: String(p?.description ?? ""),
    }));

  const coursePreds: Prediction[] = (coursesData.results ?? []).slice(0, 5).map((r: any) => ({
    kind: "course" as Kind,
    placeId: String(r?.place_id ?? ""),
    description: `${r?.name ?? "Course"}${r?.formatted_address ? ` — ${r.formatted_address}` : ""}`,
    name: r?.name ?? null,
    address: r?.formatted_address ?? null,
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

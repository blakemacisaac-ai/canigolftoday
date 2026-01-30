import { NextResponse } from "next/server";

type Kind = "city" | "course";

type Prediction = {
  kind: Kind;
  placeId: string;
  description: string;
  name?: string | null;
  address?: string | null;
};

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

  // 1) Cities-only autocomplete (legacy Places Autocomplete endpoint)
  const citiesUrl =
    `https://maps.googleapis.com/maps/api/place/autocomplete/json` +
    `?input=${encodeURIComponent(input)}` +
    `&types=(cities)` +
    `&key=${encodeURIComponent(key)}`;

  // 2) Courses (Places Text Search)
  // Text Search is better for named course lookup (Torrey Pines, Glen Abbey, etc.)
  const coursesUrl =
    `https://maps.googleapis.com/maps/api/place/textsearch/json` +
    `?query=${encodeURIComponent(input)}` +
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

  const cityPreds: Prediction[] = (citiesData.predictions ?? []).slice(0, 5).map((p: any) => ({
    kind: "city",
    placeId: String(p?.place_id ?? ""),
    description: String(p?.description ?? ""),
  }));

  const coursePreds: Prediction[] = (coursesData.results ?? []).slice(0, 5).map((r: any) => ({
    kind: "course",
    placeId: String(r?.place_id ?? ""),
    description: `${r?.name ?? "Course"}${r?.formatted_address ? ` — ${r.formatted_address}` : ""}`,
    name: r?.name ?? null,
    address: r?.formatted_address ?? null,
  }));

  // Merge + dedupe by placeId (and drop any empties)
  const seen = new Set<string>();
  const merged = [...coursePreds, ...cityPreds].filter((p) => {
    if (!p.placeId || !p.description) return false;
    if (seen.has(p.placeId)) return false;
    seen.add(p.placeId);
    return true;
  });

  return NextResponse.json({ predictions: merged.slice(0, 8) });
}

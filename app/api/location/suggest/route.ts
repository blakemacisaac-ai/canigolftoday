import { NextResponse } from "next/server";

type Kind = "city" | "course";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const input = (searchParams.get("q") || "").trim();

  if (!input || input.length < 2) {
    return NextResponse.json({ predictions: [] });
  }

  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "Missing GOOGLE_PLACES_API_KEY" }, { status: 500 });
  }

  // 1) Cities-only autocomplete
  const citiesUrl =
    `https://maps.googleapis.com/maps/api/place/autocomplete/json` +
    `?input=${encodeURIComponent(input)}` +
    `&types=(cities)` +
    `&key=${encodeURIComponent(key)}`;

  // 2) Courses search (Text Search) — better for named course lookup
  // Uses Places "type=golf_course" and query that includes the user input.
  const coursesUrl =
    `https://maps.googleapis.com/maps/api/place/textsearch/json` +
    `?query=${encodeURIComponent(input)}` +
    `&type=golf_course` +
    `&key=${encodeURIComponent(key)}`;

  const [citiesRes, coursesRes] = await Promise.all([fetch(citiesUrl), fetch(coursesUrl)]);
  const citiesData = await citiesRes.json();
  const coursesData = await coursesRes.json();

  // --- Handle city autocomplete response ---
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

  // --- Handle course textsearch response ---
  // Textsearch uses: OK, ZERO_RESULTS, OVER_QUERY_LIMIT, REQUEST_DENIED, INVALID_REQUEST, UNKNOWN_ERROR
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

  const cityPreds = (citiesData.predictions ?? []).slice(0, 5).map((p: any) => ({
    kind: "city" as Kind,
    placeId: p.place_id,
    description: p.description,
  }));

  const coursePreds = (coursesData.results ?? []).slice(0, 5).map((r: any) => ({
    kind: "course" as Kind,
    placeId: r.place_id,
    // Keep this readable and helpful
    description: `${r.name}${r.formatted_address ? ` — ${r.formatted_address}` : ""}`,
    name: r.name ?? null,
    address: r.formatted_address ?? null,
  }));

  // Merge with a little dedupe by placeId
  const seen = new Set<string>();
  const merged = [...coursePreds, ...cityPreds].filter((p: any) => {
    if (!p?.placeId) return false;
    if (seen.has(p.placeId)) return false;
    seen.add(p.placeId);
    return true;
  });

  // Keep dropdown tight
  return NextResponse.json({ predictions: merged.slice(0, 8) });
}

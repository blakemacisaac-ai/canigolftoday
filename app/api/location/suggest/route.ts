import { NextResponse } from "next/server";

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

  // Cities-only autocomplete
  const url =
    `https://maps.googleapis.com/maps/api/place/autocomplete/json` +
    `?input=${encodeURIComponent(input)}` +
    `&types=(cities)` +
    `&key=${encodeURIComponent(key)}`;

  const res = await fetch(url);
  const data = await res.json();

  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    return NextResponse.json(
      {
        error: "Places autocomplete error",
        googleStatus: data.status,
        googleError: data.error_message ?? null,
      },
      { status: 502 }
    );
  }

  const predictions = (data.predictions ?? []).slice(0, 6).map((p: any) => ({
    placeId: p.place_id,
    description: p.description,
  }));

  return NextResponse.json({ predictions });
}

import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const placeId = searchParams.get("placeId");

  if (!placeId) {
    return NextResponse.json({ error: "Missing placeId" }, { status: 400 });
  }

  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "Missing GOOGLE_PLACES_API_KEY" }, { status: 500 });
  }

  const url =
    `https://maps.googleapis.com/maps/api/place/details/json` +
    `?place_id=${encodeURIComponent(placeId)}` +
    `&fields=${encodeURIComponent("geometry,name,formatted_address")}` +
    `&key=${encodeURIComponent(key)}`;

  const res = await fetch(url);
  const data = await res.json();

  if (data.status !== "OK") {
    return NextResponse.json(
      {
        error: "Places details error",
        googleStatus: data.status,
        googleError: data.error_message ?? null,
      },
      { status: 502 }
    );
  }

  const loc = data?.result?.geometry?.location;
  if (!loc?.lat || !loc?.lng) {
    return NextResponse.json({ error: "No geometry returned for placeId" }, { status: 502 });
  }

  return NextResponse.json({
    name: data?.result?.name ?? null,
    address: data?.result?.formatted_address ?? null,
    lat: Number(loc.lat),
    lon: Number(loc.lng),
  });
}

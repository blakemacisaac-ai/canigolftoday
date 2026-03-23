import { NextResponse } from "next/server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const placeId = (searchParams.get("placeId") || searchParams.get("place_id") || "").trim();

    if (!placeId) {
      return NextResponse.json({ error: "Missing placeId" }, { status: 400, headers: CORS_HEADERS });
    }

    const key = process.env.GOOGLE_PLACES_API_KEY;
    if (!key) {
      return NextResponse.json({ error: "Missing GOOGLE_PLACES_API_KEY" }, { status: 500, headers: CORS_HEADERS });
    }

    const url = "https://places.googleapis.com/v1/places/" + encodeURIComponent(placeId);

    const r = await fetch(url, {
      headers: {
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "location,formattedAddress,displayName",
      },
      cache: "no-store",
    });

    const data = await r.json();

    if (!r.ok) {
      return NextResponse.json(
        { error: "Place details lookup failed", status: r.status, google: data },
        { status: 502, headers: CORS_HEADERS }
      );
    }

    const lat = data?.location?.latitude;
    const lon = data?.location?.longitude;

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return NextResponse.json(
        { error: "No coordinates returned for placeId", google: data },
        { status: 502, headers: CORS_HEADERS }
      );
    }

    const address = data?.formattedAddress || data?.displayName?.text || null;

    return NextResponse.json({ lat, lon, address, placeId }, { headers: CORS_HEADERS });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Resolve route crashed", detail: e?.message || String(e) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

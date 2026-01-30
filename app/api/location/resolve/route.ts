import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    // Accept either param name
    const placeId =
      (searchParams.get("placeId") || searchParams.get("place_id") || "").trim();

    if (!placeId) {
      return NextResponse.json({ error: "Missing placeId" }, { status: 400 });
    }

    const key = process.env.GOOGLE_PLACES_API_KEY;
    if (!key) {
      return NextResponse.json({ error: "Missing GOOGLE_PLACES_API_KEY" }, { status: 500 });
    }

    // Place Details API (v1)
    // NOTE: This is the correct way to resolve an autocomplete place_id to coordinates.
    const url =
      "https://places.googleapis.com/v1/places/" +
      encodeURIComponent(placeId) +
      "?fields=location,formattedAddress,displayName";

    const r = await fetch(url, {
      headers: {
        "X-Goog-Api-Key": key,
        // (optional) for quota attribution if you have one
        // "X-Goog-FieldMask": "location,formattedAddress,displayName",
      },
      cache: "no-store",
    });

    const data = await r.json();

    if (!r.ok) {
      return NextResponse.json(
        {
          error: "Place details lookup failed",
          status: r.status,
          google: data,
        },
        { status: 502 }
      );
    }

    const lat = data?.location?.latitude;
    const lon = data?.location?.longitude;

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return NextResponse.json(
        { error: "No coordinates returned for placeId", google: data },
        { status: 502 }
      );
    }

    const address =
      data?.formattedAddress ||
      data?.displayName?.text ||
      data?.displayName ||
      null;

    return NextResponse.json({
      lat,
      lon,
      address,
      placeId,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Resolve route crashed", detail: e?.message || String(e) },
      { status: 500 }
    );
  }
}

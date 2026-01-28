import { NextResponse } from "next/server";
import { golfabilityScore } from "@/lib/golfability";

function msToKph(ms: number) {
  return ms * 3.6;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");

  if (!lat || !lon) {
    return NextResponse.json({ error: "Missing lat/lon" }, { status: 400 });
  }

  const key = process.env.OPENWEATHER_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "Missing OPENWEATHER_API_KEY" }, { status: 500 });
  }

  const latEnc = encodeURIComponent(lat);
  const lonEnc = encodeURIComponent(lon);
  const keyEnc = encodeURIComponent(key);

  // 1) Current weather (free-tier friendly)
  const currentUrl =
    `https://api.openweathermap.org/data/2.5/weather` +
    `?lat=${latEnc}&lon=${lonEnc}&units=metric&appid=${keyEnc}`;

  // 2) 5 day / 3 hour forecast (free-tier friendly)
  const forecastUrl =
    `https://api.openweathermap.org/data/2.5/forecast` +
    `?lat=${latEnc}&lon=${lonEnc}&units=metric&appid=${keyEnc}`;

  const [curRes, fcRes] = await Promise.all([fetch(currentUrl), fetch(forecastUrl)]);
  const [cur, fc] = await Promise.all([curRes.json(), fcRes.json()]);

  if (!curRes.ok) {
    return NextResponse.json(
      {
        error: "OpenWeather current failed",
        statusCode: cur?.cod ?? curRes.status,
        message: cur?.message ?? "Unknown",
      },
      { status: 502 }
    );
  }

  if (!fcRes.ok) {
    return NextResponse.json(
      {
        error: "OpenWeather forecast failed",
        statusCode: fc?.cod ?? fcRes.status,
        message: fc?.message ?? "Unknown",
      },
      { status: 502 }
    );
  }

  // Forecast is 3-hour blocks. We'll look at next 2 blocks (~6 hours)
  const blocks = (fc?.list ?? []).slice(0, 2);

  // Rain “risk” estimate: if any of the next blocks includes rain/snow OR weather group indicates rain/thunder
  let rainRisk = 0; // 0..1
  let precipMm = 0;

  for (const b of blocks) {
    const weatherMain = b?.weather?.[0]?.main ?? ""; // "Rain", "Snow", "Thunderstorm", etc.
    const hasRain = Boolean(b?.rain?.["3h"]);
    const hasSnow = Boolean(b?.snow?.["3h"]);
    const isRainyGroup = /rain|thunderstorm|drizzle|snow/i.test(weatherMain);

    if (hasRain || hasSnow || isRainyGroup) {
      rainRisk = Math.max(rainRisk, 0.6);
    }

    precipMm += Number(b?.rain?.["3h"] ?? 0) + Number(b?.snow?.["3h"] ?? 0);
  }

  // If it's actively rainy/snowy now, bump risk
  const currentMain: string | null = cur?.weather?.[0]?.main ?? null;
  if (currentMain && /rain|thunderstorm|drizzle|snow/i.test(currentMain)) {
    rainRisk = Math.max(rainRisk, 0.8);
  }

  const windKph = msToKph(Number(cur?.wind?.speed ?? 0));
  const gustKph = msToKph(Number(cur?.wind?.gust ?? 0));

  // Season-aware inputs
  const nowMonth = new Date().getMonth(); // 0..11

  const golf = golfabilityScore({
    tempC: Number(cur?.main?.temp ?? 0),
    feelsLikeC: Number(cur?.main?.feels_like ?? cur?.main?.temp ?? 0),
    windKph,
    gustKph,
    pop: rainRisk,
    precipMm,
    hasAlert: false, // 2.5 endpoints don't include alerts
    conditions: currentMain,
    lat: Number(lat),
    month: nowMonth,
  });

  return NextResponse.json({
    current: {
      temp: cur?.main?.temp ?? null,
      feels: cur?.main?.feels_like ?? null,
      windKph: Math.round(windKph),
      gustKph: Math.round(gustKph),
      conditions: currentMain,
    },
    forecast: blocks.map((b: any) => ({
      dt: b.dt,
      temp: b?.main?.temp ?? null,
      windKph: Math.round(msToKph(Number(b?.wind?.speed ?? 0))),
      conditions: b?.weather?.[0]?.main ?? null,
      precipMm: Number(b?.rain?.["3h"] ?? 0) + Number(b?.snow?.["3h"] ?? 0),
    })),
    golf,
  });
}

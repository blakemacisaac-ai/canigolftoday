import { NextResponse } from "next/server";
import { golfabilityScore } from "@/lib/golfability";

type GolfVerdict = "GREEN" | "YELLOW" | "RED";

type GolfScore = {
  score: number;
  verdict: GolfVerdict;
  reason: string;
};

type ForecastBlock = {
  dt: number;
  label: string;
  dayKey: string;
  dayLabel: string;
  temp: number;
  feels: number;
  windKph: number;
  gustKph: number;
  precipMm: number;
  conditions: string | null;
  inDaylight: boolean;
  golf: GolfScore;
};

function msToKph(ms: number) {
  return ms * 3.6;
}

function formatTime(dt: number, tzOffsetSec = 0) {
  // OpenWeather timestamps are unix seconds in UTC.
  // tzOffsetSec is the location's UTC offset in seconds.
  // We shift the timestamp and then format in UTC so we don't accidentally use the server/user timezone.
  return new Date((dt + tzOffsetSec) * 1000).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

function formatDay(dt: number, tzOffsetSec = 0) {
  return new Date((dt + tzOffsetSec) * 1000).toLocaleDateString([], {
    weekday: "short",
    timeZone: "UTC",
  });
}

function dayKey(dt: number, tzOffsetSec = 0) {
  return new Date((dt + tzOffsetSec) * 1000).toISOString().split("T")[0];
}

function localHour(dt: number, tzOffsetSec = 0) {
  return new Date((dt + tzOffsetSec) * 1000).getUTCHours();
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");

  if (!lat || !lon) {
    return NextResponse.json({ error: "Missing lat/lon" }, { status: 400 });
  }

  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing API key" }, { status: 500 });
  }

  const weatherUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${apiKey}`;
  const forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=metric&appid=${apiKey}`;

  const [curRes, fcRes] = await Promise.all([fetch(weatherUrl), fetch(forecastUrl)]);
  const current = await curRes.json();
  const forecast = await fcRes.json();

  if (!curRes.ok || !fcRes.ok) {
    return NextResponse.json({ error: "Weather fetch failed" }, { status: 502 });
  }

  // Sunrise/sunset from current conditions (unix seconds)
  const sunrise = Number(current.sys?.sunrise ?? 0);
  const sunset = Number(current.sys?.sunset ?? 0);


  const tzOffsetSec = Number(forecast.city?.timezone ?? current.timezone ?? 0);
  // Month-based season logic used by golfabilityScore (use location-local date)
  const nowMonth = new Date((Date.now() / 1000 + tzOffsetSec) * 1000).getUTCMonth();

  // "Golf daylight": 1 hour after sunrise to 1 hour before sunset
  const daylightStart = sunrise + 60 * 60;
  const daylightEnd = sunset - 60 * 60;

  const blocks: ForecastBlock[] = (forecast.list ?? []).slice(0, 40).map((b: any) => {
    const wind = msToKph(b.wind?.speed ?? 0);
    const gust = msToKph(b.wind?.gust ?? 0);
    const precipRaw =
      Number(b?.rain?.["3h"] ?? 0) + Number(b?.snow?.["3h"] ?? 0);
    const precipMm = Math.round(precipRaw * 10) / 10;

    const golf = golfabilityScore({
      tempC: b.main.temp,
      feelsLikeC: b.main.feels_like,
      windKph: wind,
      gustKph: gust,
      pop: precipMm > 0 ? 0.7 : 0.1,
      precipMm,
      hasAlert: false,
      conditions: b.weather?.[0]?.main,
      lat: Number(lat),
      month: nowMonth,
    }) as GolfScore;

    const dt = Number(b.dt);

    return {
      dt,
      label: formatTime(dt, tzOffsetSec),
      dayKey: dayKey(dt, tzOffsetSec),
      dayLabel: formatDay(dt, tzOffsetSec),
      temp: Math.round(b.main.temp),
      feels: Math.round(b.main.feels_like),
      windKph: Math.round(wind),
      gustKph: Math.round(gust),
      precipMm,
      conditions: b.weather?.[0]?.main ?? null,
      inDaylight: dt >= daylightStart && dt <= daylightEnd,
      golf,
    };
  });

  // ---------- TODAY: best daylight block + best daylight window ----------
  const todayKey = dayKey(Date.now() / 1000, tzOffsetSec);
  const todayAll = blocks.filter((b) => b.dayKey === todayKey);
  const todayDaylight = todayAll.filter((b) => b.inDaylight);

  // Tee-time window constraints (local server time):
  // show a 3-hour "best window" that STARTS between 6am and 3pm,
  // so the window ends by 6pm.
  const isInTeeWindow = (dt: number) => {
    const hr = localHour(dt, tzOffsetSec);
    return hr >= 6 && hr <= 15;
  };

  const todayTeeBlocks = (todayDaylight.length > 0 ? todayDaylight : todayAll).filter((b) =>
    isInTeeWindow(b.dt)
  );

  const bestTodayBlock =
    todayTeeBlocks.length > 0
      ? todayTeeBlocks.reduce((a, b) => (b.golf.score > a.golf.score ? b : a))
      : null;

  // Best 3-hour window (single OpenWeather 3h block) between 6am and 6pm.
  // If there are no eligible blocks, keep it null.
  const bestWindow = bestTodayBlock
    ? {
        startLabel: bestTodayBlock.label,
        endLabel: formatTime(bestTodayBlock.dt + 3 * 60 * 60, tzOffsetSec),
        avgScore: bestTodayBlock.golf.score,
      }
    : null;

  // ---------- GROUP into days (next 5 unique day keys) ----------
  const grouped: Record<string, ForecastBlock[]> = {};
  for (const b of blocks) {
    if (!grouped[b.dayKey]) grouped[b.dayKey] = [];
    grouped[b.dayKey].push(b);
  }

  const dayKeys = Object.keys(grouped).slice(0, 5);

  const daily = dayKeys.map((key) => {
    const dayBlocks = grouped[key];

    const minTemp = Math.min(...dayBlocks.map((b) => b.temp));
    const maxTemp = Math.max(...dayBlocks.map((b) => b.temp));
    const windMax = Math.max(...dayBlocks.map((b) => b.windKph));
    const precipTotal = dayBlocks.reduce((sum, b) => sum + (b.precipMm ?? 0), 0);

    const rep = dayBlocks[Math.floor(dayBlocks.length / 2)];
    const conditions = rep?.conditions ?? null;

    // Score the day using ONLY daylight blocks if there are any; else use all blocks
    const dayDaylight = dayBlocks.filter((b) => b.inDaylight);
    const scoreBlocks = dayDaylight.length > 0 ? dayDaylight : dayBlocks;

    const avg =
      scoreBlocks.length > 0
        ? Math.round(scoreBlocks.reduce((sum, b) => sum + (b.golf?.score ?? 0), 0) / scoreBlocks.length)
        : 0;

    const verdict: GolfVerdict = avg >= 80 ? "GREEN" : avg >= 55 ? "YELLOW" : "RED";

    // Best window for THIS day: 3-hour block between 6am and 6pm.
    const teeBlocks = scoreBlocks.filter((b) => isInTeeWindow(b.dt));
    const dayBestBlock =
      teeBlocks.length > 0 ? teeBlocks.reduce((a, b) => (b.golf.score > a.golf.score ? b : a)) : null;
    const dayBestWindow = dayBestBlock
      ? {
          startLabel: dayBestBlock.label,
          endLabel: formatTime(dayBestBlock.dt + 3 * 60 * 60, tzOffsetSec),
          avgScore: dayBestBlock.golf.score,
        }
      : null;

    return {
      dateKey: key,
      dayLabel: dayBlocks[0]?.dayLabel ?? key,
      minTemp: Number.isFinite(minTemp) ? minTemp : null,
      maxTemp: Number.isFinite(maxTemp) ? maxTemp : null,
      windMax: Number.isFinite(windMax) ? windMax : null,
      precipTotalMm: Math.round(precipTotal * 10) / 10,
      conditions,
      golf: {
        score: avg,
        verdict,
        reason:
          verdict === "GREEN"
            ? "Great golf day"
            : verdict === "YELLOW"
              ? "Playable, not perfect"
              : "Not golfable",
      },
      bestWindow: verdict === "RED" ? null : dayBestWindow,

      // blocks for tee-time scoring + reason chips
      blocks: dayBlocks.map((b) => ({
        dt: b.dt,
        label: b.label,
        temp: b.temp,
        feels: b.feels,
        windKph: b.windKph,
        gustKph: b.gustKph,
        precipMm: b.precipMm,
        conditions: b.conditions,
        inDaylight: b.inDaylight,
        score: b.golf.score,
        verdict: b.golf.verdict,
        reason: b.golf.reason,
      })),
    };
  });

  return NextResponse.json({
    current: {
      temp: Math.round(current.main.temp),
      feels: Math.round(current.main.feels_like),
      windKph: Math.round(msToKph(current.wind?.speed ?? 0)),
      gustKph: Math.round(msToKph(current.wind?.gust ?? 0)),
      conditions: current.weather?.[0]?.main ?? null,
    },

    golf: bestTodayBlock?.golf ?? null,

    bestTime: {
      bestBlock: bestTodayBlock,
      bestWindow,
    },

    daylight: {
      sunrise,
      sunset,
      sunriseLabel: formatTime(sunrise, tzOffsetSec),
      sunsetLabel: formatTime(sunset, tzOffsetSec),
      daylightStartLabel: formatTime(daylightStart, tzOffsetSec),
      daylightEndLabel: formatTime(daylightEnd, tzOffsetSec),
    },

    forecast: blocks,
    daily,
  });
}

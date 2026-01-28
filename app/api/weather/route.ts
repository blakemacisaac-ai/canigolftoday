import { NextResponse } from "next/server";
import { golfabilityScore } from "@/lib/golfability";

function msToKph(ms: number) {
  return ms * 3.6;
}

function formatTime(dt: number) {
  return new Date(dt * 1000).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDay(dt: number) {
  return new Date(dt * 1000).toLocaleDateString([], {
    weekday: "short",
  });
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

  // Sunrise/sunset from current conditions (local to that city)
  const sunrise = Number(current.sys?.sunrise ?? 0);
  const sunset = Number(current.sys?.sunset ?? 0);

  // Month-based season logic used by golfabilityScore
  const nowMonth = new Date().getMonth();

  // "Golf daylight": 1 hour after sunrise to 1 hour before sunset
  const daylightStart = sunrise + 60 * 60;
  const daylightEnd = sunset - 60 * 60;

  const blocks = forecast.list.slice(0, 40).map((b: any) => {
    const wind = msToKph(b.wind?.speed ?? 0);
    const gust = msToKph(b.wind?.gust ?? 0);
    const precipMm =
      Number(b?.rain?.["3h"] ?? 0) + Number(b?.snow?.["3h"] ?? 0);

    const score = golfabilityScore({
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
    });

    return {
      dt: b.dt,
      label: formatTime(b.dt),
      dayKey: new Date(b.dt * 1000).toISOString().split("T")[0],
      dayLabel: formatDay(b.dt),
      temp: Math.round(b.main.temp),
      feels: Math.round(b.main.feels_like),
      windKph: Math.round(wind),
      gustKph: Math.round(gust),
      precipMm: Math.round(precipMm * 10) / 10,
      conditions: b.weather?.[0]?.main ?? null,
      inDaylight: b.dt >= daylightStart && b.dt <= daylightEnd,
      golf: score,
    };
  });

  // ---------- TODAY: best daylight block + best daylight window ----------
  const todayKey = new Date().toISOString().split("T")[0];
  const todayAll = blocks.filter((b) => b.dayKey === todayKey);
  const todayDaylight = todayAll.filter((b) => b.inDaylight);

  const bestTodayBlock =
    todayDaylight.reduce((a, b) => (b.golf.score > a.golf.score ? b : a), todayDaylight[0]) ??
    null;

  let bestWindow: any = null;
  for (let i = 0; i < todayDaylight.length - 1; i++) {
    const a = todayDaylight[i];
    const b = todayDaylight[i + 1];
    const avg = Math.round((a.golf.score + b.golf.score) / 2);

    if (!bestWindow || avg > bestWindow.avgScore) {
      bestWindow = {
        startLabel: a.label,
        endLabel: b.label,
        avgScore: avg,
      };
    }
  }

  // ---------- GROUP into days (next 5 unique day keys) ----------
  const grouped: Record<string, any[]> = {};
  for (const b of blocks) {
    if (!grouped[b.dayKey]) grouped[b.dayKey] = [];
    grouped[b.dayKey].push(b);
  }

  const dayKeys = Object.keys(grouped).slice(0, 5);

  const daily = dayKeys.map((key) => {
    const dayBlocks = grouped[key];

    // Summary stats
    const minTemp = Math.min(...dayBlocks.map((b) => b.temp));
    const maxTemp = Math.max(...dayBlocks.map((b) => b.temp));
    const windMax = Math.max(...dayBlocks.map((b) => b.windKph));
    const precipTotal = dayBlocks.reduce((sum, b) => sum + (b.precipMm ?? 0), 0);

    // Representative conditions: use the block with most ratings or middle block
    const rep = dayBlocks[Math.floor(dayBlocks.length / 2)];
    const conditions = rep?.conditions ?? null;

    // Score the day using ONLY daylight blocks if there are any; else use all blocks
    const dayDaylight = dayBlocks.filter((b) => b.inDaylight);
    const scoreBlocks = dayDaylight.length > 0 ? dayDaylight : dayBlocks;

    const avg =
      scoreBlocks.length > 0
        ? Math.round(
            scoreBlocks.reduce((sum, b) => sum + (b.golf?.score ?? 0), 0) / scoreBlocks.length
          )
        : 0;

    const verdict = avg >= 80 ? "GREEN" : avg >= 55 ? "YELLOW" : "RED";

    // Best window for THIS day (daylight only)
    let dayBestWindow: any = null;
    const windowBlocks = scoreBlocks; // daylight-only when possible
    for (let i = 0; i < windowBlocks.length - 1; i++) {
      const a = windowBlocks[i];
      const b = windowBlocks[i + 1];
      const windowAvg = Math.round(((a.golf?.score ?? 0) + (b.golf?.score ?? 0)) / 2);

      if (!dayBestWindow || windowAvg > dayBestWindow.avgScore) {
        dayBestWindow = {
          startLabel: a.label,
          endLabel: b.label,
          avgScore: windowAvg,
        };
      }
    }

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

      // ✅ EXPANDED BLOCKS FOR UI (tee-time + chips)
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
        score: b.golf?.score,
        verdict: b.golf?.verdict,
        reason: b.golf?.reason,
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

    // Today’s overall verdict uses the best daylight block (or null)
    golf: bestTodayBlock?.golf ?? null,

    bestTime: {
      bestBlock: bestTodayBlock,
      bestWindow,
    },

    daylight: {
      sunrise,
      sunset,
      sunriseLabel: formatTime(sunrise),
      sunsetLabel: formatTime(sunset),
      daylightStartLabel: formatTime(daylightStart),
      daylightEndLabel: formatTime(daylightEnd),
    },

    // Full forecast blocks (next ~5 days in 3-hour increments)
    forecast: blocks,

    // Daily summary + blocks for tee-time and chips
    daily,
  });
}

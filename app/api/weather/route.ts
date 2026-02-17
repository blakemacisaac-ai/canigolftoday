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

type GroundSignals = {
  past24hPrecipMm: number | null;
  past48hPrecipMm: number | null;
  // For future days (or when recent-history is unavailable) we may include a
  // forecast-based 48h wetness proxy. For today, this is usually null.
  forecast48hWetnessMm?: number | null;
  greensSpeed: {
    key: "SLOW" | "MEDIUM" | "QUICK";
    label: string;
    detail: string;
    confidence: "LOW" | "MEDIUM" | "HIGH";
  };
  fairwayRollout: {
    key: "LOW" | "MEDIUM" | "HIGH";
    label: string;
    detail: string;
    confidence: "LOW" | "MEDIUM" | "HIGH";
  };
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

async function getPastPrecipMm(lat: number, lon: number): Promise<{ past24: number | null; past48: number | null }> {
  // OpenWeather's free endpoints don't expose a clean "past 48h precip".
  // We use Open‑Meteo (no key) strictly for recent precipitation totals.
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=precipitation&past_days=3&forecast_days=1&timezone=UTC`;
    const r = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!r.ok) return { past24: null, past48: null };
    const j: any = await r.json();
    const times: string[] = j?.hourly?.time ?? [];
    const precip: number[] = j?.hourly?.precipitation ?? [];
    if (!Array.isArray(times) || !Array.isArray(precip) || times.length !== precip.length || times.length === 0) {
      return { past24: null, past48: null };
    }

    const nowMs = Date.now();
    let sum24 = 0;
    let sum48 = 0;
    let has24 = false;
    let has48 = false;

    for (let i = 0; i < times.length; i++) {
      const tMs = Date.parse(times[i] + "Z");
      if (!Number.isFinite(tMs)) continue;
      const mm = Number(precip[i] ?? 0) || 0;
      const ageHrs = (nowMs - tMs) / (1000 * 60 * 60);
      if (ageHrs >= 0 && ageHrs <= 24) {
        sum24 += mm;
        has24 = true;
      }
      if (ageHrs >= 0 && ageHrs <= 48) {
        sum48 += mm;
        has48 = true;
      }
    }

    const round1 = (n: number) => Math.round(n * 10) / 10;
    return {
      past24: has24 ? round1(sum24) : null,
      past48: has48 ? round1(sum48) : null,
    };
  } catch {
    return { past24: null, past48: null };
  }
}

function computeGroundSignals(args: {
  past24: number | null;
  past48: number | null;
  todayBlocks: ForecastBlock[];
}): GroundSignals {
  const { past24, past48, todayBlocks } = args;

  // Use daylight blocks (or fall back to all) to estimate drying.
  const daylight = todayBlocks.filter((b) => b.inDaylight);
  const src = daylight.length > 0 ? daylight : todayBlocks;

  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const avgTemp = Math.round(avg(src.map((b) => b.temp)));
  const avgWind = Math.round(avg(src.map((b) => b.windKph)));

  // Drying proxy: heat + wind.
  const heat = Math.max(0, Math.min(1.5, (avgTemp - 8) / 12)); // 0 around 8C, ~1 at 20C
  const wind = Math.max(0, Math.min(1.0, (avgWind - 5) / 20)); // 0 around 5kph, ~1 at 25kph
  const drying = heat + wind;

  // --- Greens speed proxy (NOT stimp; just likely slow/normal/quick) ---
  // Logic: recent rain slows greens; drying + warm can bring them back.
  let greensKey: GroundSignals["greensSpeed"]["key"] = "MEDIUM";
  let greensDetail = "Typical pace for public courses.";
  let greensConf: GroundSignals["greensSpeed"]["confidence"] = "MEDIUM";

  if (past48 == null) {
    greensConf = "LOW";
    greensDetail = "Using forecast-only signal (recent rain data unavailable).";
  } else {
    if (past48 >= 10 && drying < 1.0) {
      greensKey = "SLOW";
      greensDetail = `Likely slower: ${past48}mm in last 48h and limited drying.`;
    } else if (past48 >= 6 && drying < 0.8) {
      greensKey = "SLOW";
      greensDetail = `Leaning slow: ${past48}mm in last 48h, cool/wet feel.`;
    } else if (past48 <= 2 && avgTemp >= 14 && drying >= 1.0) {
      greensKey = "QUICK";
      greensDetail = `Likely quicker: dry last 48h (${past48}mm) with decent drying.`;
    } else {
      greensKey = "MEDIUM";
      greensDetail = `Normal-ish: ${past48}mm in last 48h with some drying.`;
    }
  }

  const greensLabel =
    greensKey === "SLOW" ? "Greens speed: 🟢 Slow" : greensKey === "QUICK" ? "Greens speed: 🔴 Quick" : "Greens speed: 🟡 Medium";

  // --- Fairway rollout proxy ---
  let rollKey: GroundSignals["fairwayRollout"]["key"] = "MEDIUM";
  let rollDetail = "Some rollout, but not summer-firm.";
  let rollConf: GroundSignals["fairwayRollout"]["confidence"] = past48 == null ? "LOW" : "MEDIUM";

  if (past48 != null) {
    if (past48 >= 12) {
      rollKey = "LOW";
      rollDetail = `Low rollout / plug risk up: ${past48}mm in last 48h.`;
    } else if (past48 <= 2 && avgTemp >= 10 && drying >= 1.0) {
      rollKey = "HIGH";
      rollDetail = `More rollout likely: dry last 48h (${past48}mm) + drying breeze.`;
    } else {
      rollKey = "MEDIUM";
      rollDetail = `Moderate rollout: ${past48}mm last 48h.`;
    }
  }

  const rollLabel =
    rollKey === "LOW" ? "Fairway rollout: 🟢 Low" : rollKey === "HIGH" ? "Fairway rollout: 🔴 High" : "Fairway rollout: 🟡 Medium";

  return {
    past24hPrecipMm: past24,
    past48hPrecipMm: past48,
    forecast48hWetnessMm: null,
    greensSpeed: {
      key: greensKey,
      label: greensLabel,
      detail: greensDetail,
      confidence: greensConf,
    },
    fairwayRollout: {
      key: rollKey,
      label: rollLabel,
      detail: rollDetail,
      confidence: rollConf,
    },
  };
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function computeForecastGroundSignals(args: {
  wetness48hMm: number;
  dayBlocks: ForecastBlock[];
}): GroundSignals {
  const { wetness48hMm, dayBlocks } = args;

  const daylight = dayBlocks.filter((b) => b.inDaylight);
  const src = daylight.length > 0 ? daylight : dayBlocks;
  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const avgTemp = Math.round(avg(src.map((b) => b.temp)));
  const avgWind = Math.round(avg(src.map((b) => b.windKph)));

  const heat = Math.max(0, Math.min(1.5, (avgTemp - 8) / 12));
  const wind = Math.max(0, Math.min(1.0, (avgWind - 5) / 20));
  const drying = heat + wind;

  // Lower confidence: this is a forecast proxy.
  let greensKey: GroundSignals["greensSpeed"]["key"] = "MEDIUM";
  let greensDetail = `Forecast proxy: ~${round1(wetness48hMm)}mm in the previous 48h window.`;
  let greensConf: GroundSignals["greensSpeed"]["confidence"] = "LOW";

  if (wetness48hMm >= 10 && drying < 1.0) {
    greensKey = "SLOW";
    greensDetail = `Leaning slow: ~${round1(wetness48hMm)}mm in the prior 48h + limited drying.`;
  } else if (wetness48hMm <= 2 && avgTemp >= 14 && drying >= 1.0) {
    greensKey = "QUICK";
    greensDetail = `Leaning quicker: ~${round1(wetness48hMm)}mm prior 48h with good drying.`;
  } else {
    greensKey = "MEDIUM";
    greensDetail = `Normal-ish: ~${round1(wetness48hMm)}mm prior 48h with some drying.`;
  }

  const greensLabel =
    greensKey === "SLOW"
      ? "Greens speed: 🟢 Slow"
      : greensKey === "QUICK"
        ? "Greens speed: 🔴 Quick"
        : "Greens speed: 🟡 Medium";

  let rollKey: GroundSignals["fairwayRollout"]["key"] = "MEDIUM";
  let rollDetail = `Forecast proxy: ~${round1(wetness48hMm)}mm prior 48h.`;
  let rollConf: GroundSignals["fairwayRollout"]["confidence"] = "LOW";

  if (wetness48hMm >= 12) {
    rollKey = "LOW";
    rollDetail = `Low rollout likely: ~${round1(wetness48hMm)}mm prior 48h (plug risk).`;
  } else if (wetness48hMm <= 2 && avgTemp >= 10 && drying >= 1.0) {
    rollKey = "HIGH";
    rollDetail = `More rollout likely: ~${round1(wetness48hMm)}mm prior 48h + drying breeze.`;
  } else {
    rollKey = "MEDIUM";
    rollDetail = `Moderate rollout: ~${round1(wetness48hMm)}mm prior 48h.`;
  }

  const rollLabel =
    rollKey === "LOW"
      ? "Fairway rollout: 🟢 Low"
      : rollKey === "HIGH"
        ? "Fairway rollout: 🔴 High"
        : "Fairway rollout: 🟡 Medium";

  return {
    past24hPrecipMm: null,
    past48hPrecipMm: null,
    forecast48hWetnessMm: round1(wetness48hMm),
    greensSpeed: { key: greensKey, label: greensLabel, detail: greensDetail, confidence: greensConf },
    fairwayRollout: { key: rollKey, label: rollLabel, detail: rollDetail, confidence: rollConf },
  };
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

  // 3-hour best window must finish by our daylightEnd
  const WINDOW_SEC = 3 * 60 * 60;
  const latestStart = daylightEnd - WINDOW_SEC;

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

  // Recent ground wetness (past 24/48h precip) + drying proxy -> greens speed / fairway rollout.
  const { past24, past48 } = await getPastPrecipMm(Number(lat), Number(lon));
  const ground = computeGroundSignals({ past24, past48, todayBlocks: todayAll });

  // Tee-time window constraints (local server time):
  // show a 3-hour "best window" that STARTS between 6am and 3pm,
  // so the window ends by 6pm.
  const isInTeeWindow = (dt: number) => {
    const hr = localHour(dt, tzOffsetSec);
    return hr >= 6 && hr <= 15;
  };

  const todayTeeBlocks = (todayDaylight.length > 0 ? todayDaylight : todayAll).filter((b) =>
    isInTeeWindow(b.dt) && b.dt <= latestStart
  );

  const bestTodayBlock =
    todayTeeBlocks.length > 0
      ? todayTeeBlocks.reduce((a, b) => (b.golf.score > a.golf.score ? b : a))
      : null;

  // Best 3-hour window (single OpenWeather 3h block) between 6am and 6pm.
  // If there are no eligible blocks, keep it null.
  const bestWindow = bestTodayBlock
    ? {
        startDt: bestTodayBlock.dt,
        startLabel: bestTodayBlock.label,
        endDt: bestTodayBlock.dt + WINDOW_SEC,
        endLabel: formatTime(bestTodayBlock.dt + WINDOW_SEC, tzOffsetSec),
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
    const gustMax = Math.max(...dayBlocks.map((b) => b.gustKph));
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
          startDt: dayBestBlock.dt,
          startLabel: dayBestBlock.label,
          endDt: dayBestBlock.dt + 3 * 60 * 60,
          endLabel: formatTime(dayBestBlock.dt + 3 * 60 * 60, tzOffsetSec),
          avgScore: dayBestBlock.golf.score,
        }
      : null;

    // Forecast wetness proxy: sum precip in the 48h window leading into mid-day.
    const noonBlock = dayBlocks.reduce((best, b) => {
      const hr = localHour(b.dt, tzOffsetSec);
      const dist = Math.abs(hr - 12);
      if (!best) return { b, dist };
      return dist < best.dist ? { b, dist } : best;
    }, null as null | { b: ForecastBlock; dist: number })?.b;

    const endDt = noonBlock?.dt ?? dayBlocks[Math.floor(dayBlocks.length / 2)]?.dt ?? dayBlocks[0]?.dt;
    const startDt = endDt - 48 * 60 * 60;
    const wetness48hForecastMm = blocks
      .filter((b) => b.dt >= startDt && b.dt < endDt)
      .reduce((sum, b) => sum + (b.precipMm ?? 0), 0);

    const dayGround = key === todayKey
      ? ground
      : computeForecastGroundSignals({ wetness48hMm: wetness48hForecastMm, dayBlocks });

    return {
      dateKey: key,
      dayLabel: dayBlocks[0]?.dayLabel ?? key,
      minTemp: Number.isFinite(minTemp) ? minTemp : null,
      maxTemp: Number.isFinite(maxTemp) ? maxTemp : null,
      windMax: Number.isFinite(windMax) ? windMax : null,
      gustMax: Number.isFinite(gustMax) ? gustMax : null,
      precipTotalMm: Math.round(precipTotal * 10) / 10,
      conditions,
      ground: dayGround,
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
    ground,
  });
}


"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type Coords = { lat: number; lon: number };
type Prediction = { kind: "city" | "course"; placeId: string; description: string };


function verdictStyles(verdict?: string) {
  if (verdict === "GREEN") return { dot: "🟢", pill: "bg-emerald-600", ring: "ring-emerald-200" };
  if (verdict === "YELLOW") return { dot: "🟡", pill: "bg-amber-500", ring: "ring-amber-200" };
  if (verdict === "NOT_GOLFABLE") return { dot: "⛔", pill: "bg-slate-600", ring: "ring-slate-400" };
  return { dot: "🔴", pill: "bg-rose-600", ring: "ring-rose-200" };
}

// Semantic color for greens/rollout badges
// "Quick" / "High" rollout = good for firm, fast conditions = neutral/amber (informational, not bad)
// "Slow" / "Low" rollout = soft/wet = blue-ish neutral
function groundBadgeStyle(label: string | null): React.CSSProperties {
  if (!label) return { background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.7)" };
  const l = label.toLowerCase();
  if (l.includes("quick") || l.includes("fast")) 
    return { background: "rgba(245,158,11,0.2)", color: "rgb(252,211,77)" };
  if (l.includes("slow"))  
    return { background: "rgba(14,165,233,0.2)", color: "rgb(125,211,252)" };
  if (l.includes("high"))  
    return { background: "rgba(245,158,11,0.2)", color: "rgb(252,211,77)" };
  if (l.includes("low"))   
    return { background: "rgba(14,165,233,0.2)", color: "rgb(125,211,252)" };
  return { background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.7)" };
}

// Extract just the text word from a label like "Quick" stripping any leading emoji/dots
function cleanGroundLabel(label: string | null): string {
  if (!label) return "";
  return label
    .replace(/^Greens speed:\s*/i, "")
    .replace(/^Fairway rollout:\s*/i, "")
    .replace(/\p{Emoji}/gu, "")
    .replace(/[●•·\s]+/g, " ")
    .trim();
}

// Convert wind degree to compass direction
function windDirFromDeg(deg: number | null | undefined): string {
  if (deg == null || !Number.isFinite(deg)) return "";
  const normalized = ((deg % 360) + 360) % 360;
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const arrows = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];
  const index = Math.round(normalized / 45) % 8;
  return `${arrows[index]} ${dirs[index]}`;
}

function cleanCityLabel(address: string): string {
  if (!address) return address;
  if (/^\d/.test(address.trim())) {
    const parts = address.split(",").map((s: string) => s.trim());
    if (parts.length >= 3) {
      const city = parts[1];
      const stateZip = parts[2].replace(/\s\d{5}(-\d{4})?/, "").trim();
      return `${city}, ${stateZip}`;
    }
  }
  return address;
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/80">
      {children}
    </span>
  );
}

/* ---------- Greens firmness (today-only, v1.2-ish signal) ---------- */
function getNum(v: any): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}


function asTimeLabel(v: any): string | null {
  if (v == null) return null;

  // Already a readable label like "7:12 AM" or "07:12"
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;

    // If it's an ISO string, try to format
    if (s.includes("T")) {
      const d = new Date(s);
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      }
    }

    // Otherwise assume it's already a label
    return s;
  }

  // Unix epoch seconds or ms
  if (typeof v === "number" && Number.isFinite(v)) {
    const ms = v > 1e12 ? v : v * 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }
  }

  return null;
}


/* ---------- Yardage estimate (carry change) ---------- */
function estimateCarryChangeYards({
  tempC,
  verdict,
}: {
  tempC?: number | null;
  verdict?: "GREEN" | "YELLOW" | "RED" | string | null;
}): { minYds: number; maxYds: number } | null {
  // Don't show on RED days
  if (verdict === "RED") return null;

  const BASE_TEMP_C = 20;
  if (tempC == null) return null;

  const deltaC = tempC - BASE_TEMP_C;

  // Simple, golfer-friendly rule of thumb:
  // ~1–2 yards per 5°C change in temperature (carry estimate).
  const a = (deltaC / 5) * 1;
  const b = (deltaC / 5) * 2;

  const r = (n: number) => Math.round(n);
  const minYds = r(Math.min(a, b));
  const maxYds = r(Math.max(a, b));

  // Hide tiny/noisy changes
  if (Math.max(Math.abs(minYds), Math.abs(maxYds)) < 2) return null;

  return { minYds, maxYds };
}

function computeGreensFirmness(weather: any) {
  const d0 = weather?.daily?.[0] ?? null;
  const d1 = weather?.daily?.[1] ?? null;
  const d2 = weather?.daily?.[2] ?? null;

  // --- Wet load (how much water is likely sitting in the surface/upper profile) ---
  // Providers vary in naming, so we defensively try a few.
  const p0 =
    getNum(d0?.precipMm) ??
    getNum(d0?.precipTotal) ??
    getNum(d0?.rainMm) ??
    getNum(d0?.precip) ??
    0;

  const p1 =
    getNum(d1?.precipMm) ??
    getNum(d1?.precipTotal) ??
    getNum(d1?.rainMm) ??
    getNum(d1?.precip) ??
    0;

  const p2 =
    getNum(d2?.precipMm) ??
    getNum(d2?.precipTotal) ??
    getNum(d2?.rainMm) ??
    getNum(d2?.precip) ??
    0;

  // Weighted: today matters most, tomorrow matters some (ongoing wetness),
  // day+2 is a light signal.
  const wetLoadMm = p0 + 0.5 * p1 + 0.25 * p2;

  // --- Drying power (sun/heat proxy + wind proxy) ---
  const nightLow =
    getNum(d0?.minTempC) ??
    getNum(d0?.tempMinC) ??
    getNum(d0?.minTemp) ??
    getNum(d0?.tempMin) ??
    null;

  const dayHigh =
    getNum(d0?.maxTempC) ??
    getNum(d0?.tempMaxC) ??
    getNum(d0?.maxTemp) ??
    getNum(d0?.tempMax) ??
    null;

  const windKph =
    getNum(weather?.current?.windKph) ??
    getNum(d0?.windKph) ??
    getNum(d0?.windMaxKph) ??
    getNum(d0?.windMax) ??
    null;

  // Heat drying: 0 at 10C, ramps to ~1 at 20C, ~1.5 at 28C+
  const heatDry =
    dayHigh == null ? 0 : Math.max(0, Math.min(1.5, (dayHigh - 10) / 12));
  // Wind drying: 0 at 5kph, ramps to ~1 at 25kph+
  const windDry =
    windKph == null ? 0 : Math.max(0, Math.min(1.0, (windKph - 5) / 20));
  const dryingPower = heatDry + windDry;

  // Cold/clammy mornings stay softer longer (dew + slow evap)
  const coldPenalty = nightLow != null && nightLow <= 3 ? 0.5 : 0;

  // Softness index: higher = softer, lower = firmer
  // Scale wet load so ~10mm feels meaningfully soft unless dryingPower is high.
  const softnessIndex = wetLoadMm / 6 + coldPenalty - dryingPower;

  // Edge case: near/below freezing tends to be firm/frozen early.
  if (dayHigh != null && nightLow != null && nightLow <= -1 && dayHigh <= 2) {
    return {
      key: "FIRM",
      label: "Greens: 🔴 Firm",
      detail: "Cold/frozen surfaces possible early (check for frost delays)",
    };
  }

  if (softnessIndex >= 2.0) {
    return {
      key: "SOFT",
      label: "Greens: 🟢 Soft",
      detail: "Approaches should hold (more moisture)",
    };
  }
  if (softnessIndex <= 0.4) {
    return {
      key: "FIRM",
      label: "Greens: 🔴 Firm",
      detail: "Some bounce & rollout — plan for release",
    };
  }
  return {
    key: "NORMAL",
    label: "Greens: 🟡 Normal",
    detail: "Typical bounce & rollout",
  };
}

/** v1.1: Courses — curate the list (less is more) */
function scoreCourse(c: any) {
  // Higher is better
  const rating = typeof c?.rating === "number" ? c.rating : 0;
  const ratingsCount = typeof c?.userRatingsTotal === "number" ? c.userRatingsTotal : 0;

  // Prefer open-now slightly
  const openBoost = c?.openNow === true ? 20 : c?.openNow === false ? -10 : 0;

  // Weak signal: more ratings = more trustworthy, capped
  const countBoost = Math.min(10, Math.floor(ratingsCount / 50)); // caps at +10

  return rating * 10 + countBoost + openBoost;
}

function pickTopCourses(all: any[], limit = 4) {
  return [...all]
    .filter((c) => c?.mapsUrl) // only actionable
    .sort((a, b) => scoreCourse(b) - scoreCourse(a))
    .slice(0, limit);
}

function CourseCard({ c }: { c: any }) {
  const ratingText =
    typeof c?.rating === "number"
      ? `⭐ ${c.rating.toFixed(1)}${c?.userRatingsTotal ? ` (${c.userRatingsTotal})` : ""}`
      : "No rating yet";

  const openText = c?.openNow === true ? "Open now" : c?.openNow === false ? "Closed" : null;

  // Affiliate link - replace with your actual affiliate ID once approved
  const GOLFNOW_AFFILIATE_ID = process.env.NEXT_PUBLIC_GOLFNOW_AFFILIATE_ID || "";
  const bookingUrl = GOLFNOW_AFFILIATE_ID
    ? `https://www.golfnow.com/tee-times?q=${encodeURIComponent(c.name)}&aff=${GOLFNOW_AFFILIATE_ID}`
    : null;

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="truncate text-base font-semibold">{c.name}</div>

            <div className="inline-flex items-center gap-2">
              <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/80">
                {ratingText}
              </span>

              {openText && (
                <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/70">
                  {openText}
                </span>
              )}
            </div>
          </div>

          {c.address && <div className="mt-2 line-clamp-2 text-sm text-white/65">{c.address}</div>}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <a
              href={c.mapsUrl || "#"}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10 transition"
            >
              Directions →
            </a>

            {bookingUrl && (
              <a
                href={bookingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 transition"
              >
                Book Tee Time
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [geoErr, setGeoErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [weather, setWeather] = useState<any>(null);
  const [courses, setCourses] = useState<any>(null);
  const [simulators, setSimulators] = useState<any>(null);

  // City search
  const [cityQuery, setCityQuery] = useState("");
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [searching, setSearching] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const suppressAutocomplete = useRef(false);
  const daysScrollRef = useRef<HTMLDivElement | null>(null);

  // Selected day (0..4)
  const [selectedDay, setSelectedDay] = useState<number>(0);

  // Optional tee time ("HH:MM")
  const [teeTime, setTeeTime] = useState<string>("");

  // v1.1: “Show all courses” toggle
  const [showAllCourses, setShowAllCourses] = useState(false);
  const [showScoreExplainer, setShowScoreExplainer] = useState(false);

  // Animated social proof counter — real visitor count from API
  const [counterVal, setCounterVal] = useState(0);
  useEffect(() => {
    fetch("/api/visitors", { method: "POST" })
      .then((r) => r.json())
      .then((data) => {
        const target = typeof data.count === "number" ? data.count : 0;
        if (target === 0) return;
        let start: number | null = null;
        const duration = 1800;
        const step = (ts: number) => {
          if (!start) start = ts;
          const progress = Math.min((ts - start) / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          setCounterVal(Math.floor(eased * target));
          if (progress < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      })
      .catch(() => {
        // Silently fail — counter just stays at 0
      });
  }, []);

  // One-time query param bootstrap (supports landing pages like /city/toronto)
  const didBootstrapFromQuery = useRef(false);

  useEffect(() => {
    if (didBootstrapFromQuery.current) return;
    if (typeof window === "undefined") return;

    const q = new URLSearchParams(window.location.search).get("q");
    if (!q) return;

    didBootstrapFromQuery.current = true;

    const label = q.replace(/[-_]+/g, " ").trim();
    if (label && !cityQuery) setCityQuery(label);

    (async () => {
      try {
        const sres = await fetch(`/api/location/suggest?q=${encodeURIComponent(label)}`);
        const sdata = await sres.json();
        const preds = Array.isArray(sdata?.predictions) ? sdata.predictions : [];
        const first = preds[0];
        if (!first?.placeId) return;

        const rres = await fetch(`/api/location/resolve?placeId=${encodeURIComponent(first.placeId)}`);
        const rdata = await rres.json();
        if (rdata?.coords?.lat && rdata?.coords?.lon) {
          setCoords({ lat: rdata.coords.lat, lon: rdata.coords.lon });
          if (rdata?.label) setCityQuery(rdata.label);
          setSelectedDay(0);
        }
      } catch {
        // silent
      }
    })();
  }, [cityQuery]);

  const selectedDaily = useMemo(() => weather?.daily?.[selectedDay] ?? null, [weather, selectedDay]);

  const teeTimeResult = useMemo(() => {
    if (!teeTime || !selectedDaily?.blocks) return null;

    const [hh, mm] = teeTime.split(":").map((n) => Number(n));
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;

    const targetMinutes = hh * 60 + mm;
    const blocks = selectedDaily.blocks as any[];

    let best: any = null;
    let bestDelta = Infinity;

    for (const b of blocks) {
      const d = new Date(b.dt * 1000);
      const m = d.getHours() * 60 + d.getMinutes();
      const delta = Math.abs(m - targetMinutes);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = b;
      }
    }

    if (!best) return null;

    return {
      ...best,
      deltaMinutes: bestDelta,
    };
  }, [teeTime, selectedDaily]);

  // Validate tee time against golfing hours and sunset
  const teeTimeWarning = useMemo(() => {
    if (!teeTime) return null;
    const [hh, mm] = teeTime.split(":").map((n) => Number(n));
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;

    // Check golfing hours (6am-3pm is typical)
    if (hh < 6) return "⚠️ Before typical course hours (6am)";
    if (hh >= 15) return "⚠️ Late tee time — may finish after dark";

    // Check against sunset for today
    if (selectedDay === 0 && weather?.daylight?.sunset) {
      const sunsetDate = new Date(weather.daylight.sunset * 1000);
      const sunsetHour = sunsetDate.getHours();
      const sunsetMin = sunsetDate.getMinutes();
      const teeMin = hh * 60 + mm;
      const sunsetTotalMin = sunsetHour * 60 + sunsetMin;
      
      // Warn if tee time is within 3 hours of sunset (typical round length)
      if (teeMin > sunsetTotalMin - 180) {
        return `⚠️ Less than 3 hours before sunset (${sunsetDate.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})})`;
      }
    }

    return null;
  }, [teeTime, selectedDay, weather?.daylight?.sunset]);

  const showVerdict =
    teeTimeResult?.verdict ?? selectedDaily?.golf?.verdict ?? weather?.golf?.verdict ?? null;

  const verdictLabel = useMemo(() => {
    const v = showVerdict;
    if (!v) return null;
    if (v === "GREEN") return "Book it";
    if (v === "YELLOW") return "Playable";
    if (v === "NOT_GOLFABLE") return "Not golfable";
    return "Not golfable";
  }, [showVerdict]);

  // --- Share summary ---
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(t);
  }, [copied]);

  const windSummaryText = useMemo(() => {
    if (selectedDay === 0) {
      const w = weather?.current?.windKph;
      const g = weather?.current?.gustKph;
      if (w == null) return null;
      return `${w} km/h${g != null ? ` (gust ${g})` : ""}`;
    }
    const w = selectedDaily?.windMax ?? selectedDaily?.windKph ?? null;
    const g = selectedDaily?.gustMax ?? selectedDaily?.gustKph ?? null;
    if (w == null) return null;
    return `${w} km/h${g != null ? ` (gust ${g})` : ""}`;
  }, [selectedDay, selectedDaily, weather]);

  const greensBadgeText = useMemo(() => {
    const g = selectedDay === 0 ? weather?.ground?.greensSpeed?.label : selectedDaily?.ground?.greensSpeed?.label;
    return g ? String(g).replace(/^Greens speed:\s*/i, "") : null;
  }, [selectedDay, selectedDaily, weather]);

  const rolloutBadgeText = useMemo(() => {
    const r = selectedDay === 0 ? weather?.ground?.fairwayRollout?.label : selectedDaily?.ground?.fairwayRollout?.label;
    return r ? String(r).replace(/^Fairway rollout:\s*/i, "") : null;
  }, [selectedDay, selectedDaily, weather]);

  // Infer timezone offset — shared by bestWindowText and playOut.
  // API sometimes omits tzOffsetSec; derive from bestWindow startDt + startLabel when missing.
  const inferredTzOffsetSec = useMemo(() => {
    if (typeof weather?.tzOffsetSec === "number") return weather.tzOffsetSec;
    const bw = weather?.bestTime?.bestWindow ?? weather?.daily?.[0]?.bestWindow ?? null;
    if (bw?.startDt && bw?.startLabel) {
      const match = String(bw.startLabel).match(/(\d+):(\d+)\s*(a\.?m\.?|p\.?m\.?)/i);
      if (match) {
        let h = parseInt(match[1]);
        const m = parseInt(match[2]);
        const ampm = match[3].toLowerCase().replace(/\./g, '');
        if (ampm === 'pm' && h !== 12) h += 12;
        if (ampm === 'am' && h === 12) h = 0;
        const localSecs = h * 3600 + m * 60;
        const utcSecs = bw.startDt % (24 * 3600);
        let offset = localSecs - utcSecs;
        while (offset > 43200) offset -= 86400;
        while (offset < -43200) offset += 86400;
        return offset;
      }
    }
    return 0;
  }, [weather]);

  // Current local hour in the destination timezone — used to dim past buckets
  const nowLocalHour = useMemo(() => {
    if (selectedDay !== 0) return -1; // only relevant for today
    const nowUtc = Math.floor(Date.now() / 1000);
    return new Date((nowUtc + inferredTzOffsetSec) * 1000).getUTCHours();
  }, [selectedDay, inferredTzOffsetSec]);

  const bestWindowText = useMemo(() => {
  const tzOffsetSec = inferredTzOffsetSec;

  // Don't show best window for RED (not golfable) days
  const isToday = selectedDay === 0;
  const dayVerdict = isToday 
    ? (weather?.golf?.verdict ?? weather?.daily?.[0]?.golf?.verdict) 
    : (selectedDaily?.golf?.verdict);
  
  if (dayVerdict === "RED" || dayVerdict === "NOT_GOLFABLE") {
    return null;
  }

  // Format a unix dt in the destination/course timezone (not the viewer's browser timezone).
  const fmt = (dtSec: number) =>
    new Date((dtSec + tzOffsetSec) * 1000).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "UTC",
    });

  // Resolve blocks for the chosen day.
  let rawBlocks: any = isToday 
    ? (weather?.bestTime?.byTime ?? weather?.bestTime?.blocks ?? weather?.bestTime?.byHour ?? weather?.bestTime?.bestBlock ?? null) 
    : (selectedDaily?.blocks ?? null);
  if (rawBlocks && !Array.isArray(rawBlocks) && typeof rawBlocks === "object") rawBlocks = Object.values(rawBlocks);
  const blocks: any[] = Array.isArray(rawBlocks) ? rawBlocks : [];

  // For today: only consider blocks from now onwards
  const nowUtcSec = isToday ? Math.floor(Date.now() / 1000) : null;

  // Sunrise/sunset bounds for TODAY (destination).
  const sunriseDt = isToday && typeof weather?.daylight?.sunrise === "number" ? weather.daylight.sunrise : null;
  const sunsetDt = isToday && typeof weather?.daylight?.sunset === "number" ? weather.daylight.sunset : null;

  const daylightStart = sunriseDt != null ? sunriseDt + 60 * 60 : null; // 1h after sunrise
  const latestStart = sunsetDt != null ? sunsetDt - 3 * 60 * 60 : null;   // so 3h window ends by sunset

  // Extract bestWindow from API (schema-tolerant).
  const apiBw: any = isToday ? (weather?.bestTime?.bestWindow ?? null) : (selectedDaily?.bestWindow ?? null);

  const labelStart: string | null =
    (typeof apiBw?.startLabel === "string" ? apiBw.startLabel : null) ??
    (typeof apiBw?.start === "string" ? apiBw.start : null) ??
    null;

  const labelEnd: string | null =
    (typeof apiBw?.endLabel === "string" ? apiBw.endLabel : null) ??
    (typeof apiBw?.end === "string" ? apiBw.end : null) ??
    null;

  const startDtFromApi: number | null =
    (typeof apiBw?.startDt === "number" ? apiBw.startDt : null) ??
    (typeof apiBw?.start === "number" ? apiBw.start : null) ??
    null;

  const endDtFromApi: number | null =
    (typeof apiBw?.endDt === "number" ? apiBw.endDt : null) ??
    (typeof apiBw?.end === "number" ? apiBw.end : null) ??
    null;

  const avgFromApi: number | null =
    typeof apiBw?.avgScore === "number" ? apiBw.avgScore : (typeof apiBw?.avg === "number" ? apiBw.avg : null);

  // Helper: validate a candidate start dt against golfing hours + daylight.
  const isValidStart = (dt: number) => {
    const hr = new Date((dt + tzOffsetSec) * 1000).getUTCHours();
    
    // Apply golfing hours check for ALL days (6am-3pm in destination timezone)
    if (hr < 6 || hr > 15) {
      return false;
    }
    
    // Apply daylight and sunset checks only for today (since we have that data)
    if (isToday) {
      // Check if dt and the daylight bounds are actually on the same day
      const dtDayInDestination = Math.floor((dt + tzOffsetSec) / (24 * 60 * 60));
      const sunsetDayInDestination = sunsetDt != null ? Math.floor((sunsetDt + tzOffsetSec) / (24 * 60 * 60)) : null;
      
      // Only apply sunset check if they're on the same day
      if (sunsetDt != null && sunsetDayInDestination === dtDayInDestination && dt >= sunsetDt) {
        return false;
      }
      
      if (daylightStart != null) {
        const daylightStartDay = Math.floor((daylightStart + tzOffsetSec) / (24 * 60 * 60));
        if (daylightStartDay === dtDayInDestination && dt < daylightStart) {
          return false;
        }
      }
    }
    
    return true;
  };

  // 1) Try to resolve startDt/endDt from API window.
  //    If it's already in the past (for today), discard it so we recompute.
  let startDt: number | null =
    startDtFromApi != null && nowUtcSec != null && startDtFromApi < nowUtcSec - 1800
      ? null
      : startDtFromApi;
  if (startDt == null && labelStart && blocks.length > 0) {
    const b = blocks.find((x: any) => typeof x?.dt === "number" && (x?.label === labelStart));
    if (typeof b?.dt === "number") startDt = b.dt;
  }

  let endDt: number | null = endDtFromApi;
  if (startDt != null && endDt == null) endDt = startDt + 3 * 60 * 60;

  // 2) If missing or invalid, derive from blocks using destination sunrise/sunset + golfing hours.
  if ((startDt == null || !isValidStart(startDt)) && blocks.length > 0) {
    const pool = blocks
      .filter((b: any) => typeof b?.dt === "number" && typeof b?.score === "number")
      .filter((b: any) => b?.inDaylight !== false)
      .filter((b: any) => isValidStart(b.dt))
      .filter((b: any) => nowUtcSec == null || b.dt >= nowUtcSec - 1800); // only future blocks (30min grace)

    const best = pool.reduce((acc: any, b: any) => (!acc || b.score > acc.score ? b : acc), null);

    if (best && typeof best.dt === "number") {
      startDt = best.dt;
      endDt = best.dt + 3 * 60 * 60;
    } else {
      // No valid pool -> nothing to show
      return null;
    }
  }
  
  // 3) Final fallback: if we still don't have a window, create a window based on best bucket
  if (startDt == null) {
    const nowUtc = Math.floor(Date.now() / 1000);

    // Determine which hour to use based on best bucket from API golf data
    const golf = isToday ? (weather?.golf ?? weather?.daily?.[0]?.golf) : selectedDaily?.golf;
    const bestBucket: string | null = golf?.bestBucket ?? golf?.bestPeriod ?? null;
    
    // Map bucket to a representative start hour in destination local time
    let bestHour = 11; // default: midday
    if (bestBucket === "morning") bestHour = 8;
    else if (bestBucket === "midday") bestHour = 11;
    else if (bestBucket === "late" || bestBucket === "afternoon") bestHour = 15;

    // For today use current date, for future days use the daily date if available
    let dayMidnightUtc: number;
    if (isToday) {
      dayMidnightUtc = Math.floor(nowUtc / (24 * 60 * 60)) * (24 * 60 * 60);
    } else {
      const dateKey = selectedDaily?.dateKey ?? selectedDaily?.date ?? null;
      if (dateKey) {
        const d = new Date(dateKey);
        dayMidnightUtc = Math.floor(d.getTime() / 1000 / (24 * 60 * 60)) * (24 * 60 * 60);
      } else {
        dayMidnightUtc = Math.floor(nowUtc / (24 * 60 * 60)) * (24 * 60 * 60) + selectedDay * 24 * 60 * 60;
      }
    }

    // Try best bucket first, then fall back through options
    const candidates = [bestHour, 11, 8, 15].filter((v, i, a) => a.indexOf(v) === i);
    for (const hour of candidates) {
      const candidate = dayMidnightUtc + (hour * 60 * 60) - tzOffsetSec;
      if (isValidStart(candidate)) {
        startDt = candidate;
        endDt = candidate + 3 * 60 * 60;
        break;
      }
    }
  }

  if (startDt == null || endDt == null) {
    return null;
  }

  // Clamp end to sunset for TODAY (only if sunset is actually today)
  if (isToday && sunsetDt != null) {
    const dtDayInDestination = Math.floor((startDt + tzOffsetSec) / (24 * 60 * 60));
    const sunsetDayInDestination = Math.floor((sunsetDt + tzOffsetSec) / (24 * 60 * 60));
    
    if (dtDayInDestination === sunsetDayInDestination) {
      endDt = Math.min(endDt, sunsetDt);
      if (startDt >= sunsetDt) {
        return null;
      }
    }
  }

  const startStr = fmt(startDt);
  const endStr = fmt(endDt);

  // Prefer API avgScore; otherwise use the start block score if available.
  let avg = avgFromApi;
  if (avg == null && blocks.length > 0) {
    const b = blocks.find((x: any) => typeof x?.dt === "number" && x.dt === startDt && typeof x?.score === "number");
    if (typeof b?.score === "number") avg = b.score;
  }

  const avgSuffix = ""; // avg score removed from display — shown prominently above
  const result = `${startStr} – ${endStr}${avgSuffix}`;
  
  return result;
}, [selectedDaily, selectedDay, weather, inferredTzOffsetSec]);

const shareUrl = useMemo(() => {
    const where = cityQuery?.trim();
    if (!where) return "https://canigolftoday.com";
    const params = new URLSearchParams({ q: where });
    if (selectedDay !== 0) params.set("day", String(selectedDay));
    return `https://canigolftoday.com/?${params.toString()}`;
  }, [cityQuery, selectedDay]);




  const carryChange = useMemo(() => {
    if (showVerdict === "RED" || showVerdict === "NOT_GOLFABLE") return null;

    // For today: prefer current temp, fall back to day0 min/max avg
    // For future days: use average of min/max as a better representative temp than just max
    const t =
      selectedDay === 0
        ? getNum(weather?.current?.temp) ??
          getNum(weather?.current?.feels) ??
          getNum(weather?.daily?.[0]?.minTemp) ??
          null
        : (() => {
            const hi = getNum(selectedDaily?.maxTemp) ?? getNum(selectedDaily?.max);
            const lo = getNum(selectedDaily?.minTemp) ?? getNum(selectedDaily?.min);
            if (hi != null && lo != null) return (hi + lo) / 2;
            return hi ?? lo ?? null;
          })();

    return estimateCarryChangeYards({ tempC: t, verdict: showVerdict });
  }, [showVerdict, selectedDay, selectedDaily, weather]);

  const carryChangeText = useMemo(() => {
    if (!carryChange) return null;
    const min = carryChange.minYds;
    const max = carryChange.maxYds;
    const fmt = (n: number) => `${n > 0 ? "+" : ""}${n}`;
    // If range is the same or within 1 yard, just show single value
    if (min === max || Math.abs(max - min) <= 1) return `${fmt(max)} yds`;
    return `${fmt(min)} to ${fmt(max)} yds`;
  }, [carryChange]);
  
  const bestWindowRange = useMemo(() => {
  const tzOffsetSec = typeof weather?.tzOffsetSec === "number" ? weather.tzOffsetSec : 0;
  const isToday = selectedDay === 0;

  let rawBlocks: any = isToday ? (weather?.bestTime?.byTime ?? weather?.bestTime?.blocks ?? weather?.bestTime?.byHour ?? null) : (selectedDaily?.blocks ?? null);
  if (rawBlocks && !Array.isArray(rawBlocks) && typeof rawBlocks === "object") rawBlocks = Object.values(rawBlocks);
  const blocks: any[] = Array.isArray(rawBlocks) ? rawBlocks : [];

  const sunriseDt = isToday && typeof weather?.daylight?.sunrise === "number" ? weather.daylight.sunrise : null;
  const sunsetDt = isToday && typeof weather?.daylight?.sunset === "number" ? weather.daylight.sunset : null;

  const daylightStart = sunriseDt != null ? sunriseDt + 60 * 60 : null;
  const latestStart = sunsetDt != null ? sunsetDt - 3 * 60 * 60 : null;

  const apiBw: any = isToday ? (weather?.bestTime?.bestWindow ?? null) : (selectedDaily?.bestWindow ?? null);

  const labelStart: string | null =
    (typeof apiBw?.startLabel === "string" ? apiBw.startLabel : null) ??
    (typeof apiBw?.start === "string" ? apiBw.start : null) ??
    null;

  const startDtFromApi: number | null =
    (typeof apiBw?.startDt === "number" ? apiBw.startDt : null) ??
    (typeof apiBw?.start === "number" ? apiBw.start : null) ??
    null;

  const endDtFromApi: number | null =
    (typeof apiBw?.endDt === "number" ? apiBw.endDt : null) ??
    (typeof apiBw?.end === "number" ? apiBw.end : null) ??
    null;

  const isValidStart = (dt: number) => {
    if (isToday) {
      if (daylightStart != null && dt < daylightStart) return false;
      if (latestStart != null && dt > latestStart) return false;
      if (sunsetDt != null && dt >= sunsetDt) return false;
    }
    
    // Apply golfing hours check for ALL days (6am-3pm in destination timezone)
    const hr = new Date((dt + tzOffsetSec) * 1000).getUTCHours();
    if (hr < 6 || hr > 15) return false;
    
    return true;
  };

  let startDt: number | null = startDtFromApi;
  if (startDt == null && labelStart && blocks.length > 0) {
    const b = blocks.find((x: any) => typeof x?.dt === "number" && x?.label === labelStart);
    if (typeof b?.dt === "number") startDt = b.dt;
  }

  let endDt: number | null = endDtFromApi;
  if (startDt != null && endDt == null) endDt = startDt + 3 * 60 * 60;

  if ((startDt == null || !isValidStart(startDt)) && blocks.length > 0) {
    const pool = blocks
      .filter((b: any) => typeof b?.dt === "number" && typeof b?.score === "number")
      .filter((b: any) => b?.inDaylight !== false)
      .filter((b: any) => isValidStart(b.dt));

    const best = pool.reduce((acc: any, b: any) => (!acc || b.score > acc.score ? b : acc), null);

    if (best && typeof best.dt === "number") {
      startDt = best.dt;
      endDt = best.dt + 3 * 60 * 60;
    } else {
      return null;
    }
  }

  if (startDt == null || endDt == null) return null;

  if (isToday && sunsetDt != null) {
    endDt = Math.min(endDt, sunsetDt);
    if (startDt >= sunsetDt) return null;
  }

  return { startDt, endDt };
}, [selectedDaily?.bestWindow, selectedDaily?.blocks, selectedDay, weather?.bestTime?.bestWindow, weather?.bestTime?.byTime, weather?.bestTime?.blocks, weather?.bestTime?.byHour, weather?.daylight?.sunrise, weather?.daylight?.sunset, weather?.tzOffsetSec]);




const sunriseSunsetText = useMemo(() => {
  const sunrise =
    weather?.daylight?.sunriseLabel ??
    (weather?.daylight?.sunrise
      ? new Date(weather.daylight.sunrise * 1000).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        })
      : null);

  const sunset =
    weather?.daylight?.sunsetLabel ??
    (weather?.daylight?.sunset
      ? new Date(weather.daylight.sunset * 1000).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        })
      : null);

  if (!sunrise && !sunset) return null;
  if (sunrise && sunset) return `Sunrise ${sunrise} • Sunset ${sunset}`;
  if (sunrise) return `Sunrise ${sunrise}`;
  return `Sunset ${sunset}`;
}, [weather?.daylight]);

const sunriseText = useMemo(() =>
  weather?.daylight?.sunriseLabel ??
  (weather?.daylight?.sunrise
    ? new Date(weather.daylight.sunrise * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null),
[weather?.daylight]);

const sunsetText = useMemo(() =>
  weather?.daylight?.sunsetLabel ??
  (weather?.daylight?.sunset
    ? new Date(weather.daylight.sunset * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null),
[weather?.daylight]);



  // Ground / greens signals (computed server-side using recent precip history where available)
  // For future days, we use a forecast-based proxy included in each day object.
  const selectedGround = (selectedDay === 0 ? weather?.ground : selectedDaily?.ground) ?? null;
  const greensSpeed = selectedGround?.greensSpeed ?? null;
  const fairwayRollout = selectedGround?.fairwayRollout ?? null;

// How the day plays out (golfer-first): Morning vs Midday vs Late.
// IMPORTANT: "today" data sometimes lives under weather.bestTime.byTime rather than daily[0].blocks,
// so we fall back to those sources.
const playOut = useMemo(() => {
  const WINDOW_SEC = 3 * 60 * 60;

  // 1) Get blocks from the selected day; for today, fall back to bestTime blocks/byTime.
  let raw: any = selectedDaily?.blocks ?? null;

  if ((!Array.isArray(raw) || raw.length === 0) && selectedDay === 0) {
    raw = weather?.bestTime?.byTime ?? weather?.bestTime?.blocks ?? weather?.bestTime?.byHour ?? null;
    // If API returns an object-map, normalize to array
    if (raw && !Array.isArray(raw) && typeof raw === "object") raw = Object.values(raw);
  }

  if (!Array.isArray(raw) || raw.length === 0) return null as null | any;

  const sorted = [...raw]
    .filter((b: any) => typeof b?.dt === "number" && typeof b?.score === "number")
    .sort((a: any, b: any) => (a?.dt ?? 0) - (b?.dt ?? 0));

  if (sorted.length === 0) return null;

  // 2) For today, clamp to daylight explicitly (no after-sunset blocks).
  const sunriseDt =
    selectedDay === 0 && typeof weather?.daylight?.sunrise === "number"
      ? weather.daylight.sunrise
      : null;

  const sunsetDt =
    selectedDay === 0 && typeof weather?.daylight?.sunset === "number"
      ? weather.daylight.sunset
      : null;

  const daylight = (sunriseDt != null || sunsetDt != null)
    ? sorted.filter((b: any) => {
        if (sunriseDt != null && b.dt < sunriseDt) return false;
        if (sunsetDt != null && b.dt >= sunsetDt) return false;
        return true;
      })
    : sorted;

  const pool = daylight.length > 0 ? daylight : sorted;

  // 3) Derive day bounds.
  const inferredStart = pool[0].dt;
  const inferredEnd = pool[pool.length - 1].dt + 60 * 60; // hourly-ish
  const dayStart = sunriseDt != null ? Math.max(inferredStart, sunriseDt) : inferredStart;
  const dayEnd = sunsetDt != null ? Math.min(inferredEnd, sunsetDt) : inferredEnd;

  // 4) Utility: average score in range (returns null if no blocks).
  const avgInRange = (startDt: number, endDt: number) => {
    const xs = pool
      .filter((b: any) => b.dt >= startDt && b.dt < endDt)
      .map((b: any) => b.score);
    if (xs.length === 0) return null;
    const avg = xs.reduce((a: number, n: number) => a + n, 0) / xs.length;
    return Math.round(avg);
  };

  const allAvg = (() => {
    const xs = pool.map((b: any) => b.score);
    if (xs.length === 0) return 0;
    return Math.round(xs.reduce((a: number, n: number) => a + n, 0) / xs.length);
  })();

  // 5) Bucket boundaries (local-time hours):
  // Morning: 6–11, Midday: 11–15, Late: 15–sunset (daylight filtered when available).
  const tzOffsetSec = inferredTzOffsetSec;
  const localHour = (dt: number) => new Date((dt + tzOffsetSec) * 1000).getUTCHours();

  const daylightForBuckets = (() => {
    const xs = pool.filter((b: any) => b?.inDaylight !== false);
    return xs.length > 0 ? xs : pool;
  })();

  const avgByHourRange = (hStart: number, hEnd: number) => {
    const xs = daylightForBuckets
      .filter((b: any) => {
        if (typeof b?.dt !== "number") return false;
        const h = localHour(b.dt);
        return h >= hStart && h < hEnd;
      })
      .map((b: any) => b.score);
    if (xs.length === 0) return null;
    const avg = xs.reduce((a: number, n: number) => a + n, 0) / xs.length;
    return Math.round(avg);
  };

  const morningScore = avgByHourRange(6, 11);
  const middayScore = avgByHourRange(11, 15);
  const lateScore = avgByHourRange(15, 24);

  // Never show blanks: fall back to overall avg if a bucket has no blocks.
  const ms = morningScore ?? allAvg;
  const mds = middayScore ?? allAvg;
  const ls = lateScore ?? allAvg;

  const toVerdict = (score: number) => {
    if (score >= 80) return "GREEN";
    if (score >= 60) return "YELLOW";
    return "RED";
  };

  // 6) Decide which bucket contains the best tee-time window start (authoritative).
  let bestBucket: "morning" | "midday" | "late" | null = null;
  const bwStart = bestWindowRange?.startDt ?? null;

  if (typeof bwStart === "number") {
    const h = localHour(bwStart);
    if (h < 11) bestBucket = "morning";
    else if (h < 15) bestBucket = "midday";
    else bestBucket = "late";
  } else {
    // fallback: highest scoring bucket
    const best = [
      { k: "morning" as const, s: ms },
      { k: "midday" as const, s: mds },
      { k: "late" as const, s: ls },
    ].sort((a, b) => b.s - a.s)[0];
    bestBucket = best?.k ?? null;
  }
return {
    bestBucket,
    segments: [
      { key: "morning", label: "Morning", score: ms, verdict: toVerdict(ms) },
      { key: "midday", label: "Midday", score: mds, verdict: toVerdict(mds) },
      { key: "late", label: "Late", score: ls, verdict: toVerdict(ls) },
    ],
    range: { startDt: dayStart, endDt: dayEnd },
  };
}, [
  selectedDaily?.blocks,
  selectedDay,
  weather?.bestTime,
  weather?.daylight?.sunrise,
  weather?.daylight?.sunset,
  bestWindowRange?.startDt,
  bestWindowRange?.endDt,
  inferredTzOffsetSec,
]);


  const showScore = teeTimeResult?.score ?? selectedDaily?.golf?.score ?? weather?.golf?.score;
  const showReason = teeTimeResult?.reason ?? selectedDaily?.golf?.reason ?? weather?.golf?.reason;

  const style = verdictStyles(showVerdict || "RED");

  const confidenceLine = useMemo(() => {
    const v = showVerdict;
    if (v === "GREEN") return "Perfect conditions.";
    if (v === "YELLOW") return "Playable if you catch the window.";
    if (v === "RED") return "Courses are likely closed or unpleasant.";
    if (v === "NOT_GOLFABLE") return "Off-season — courses are likely closed or under snow.";
    return null;
  }, [showVerdict]);

  const redReasonChips = useMemo(() => {
    if (showVerdict !== "RED") return [];

    const chips: { label: string; weight: number }[] = [];

    const tempC =
      (typeof teeTimeResult?.temp === "number" ? teeTimeResult.temp : null) ??
      (selectedDay === 0 ? weather?.current?.temp : null) ??
      null;

    const windKph =
      (typeof teeTimeResult?.windKph === "number" ? teeTimeResult.windKph : null) ??
      (selectedDay === 0 ? weather?.current?.windKph : null) ??
      (typeof selectedDaily?.windMax === "number" ? selectedDaily.windMax : null) ??
      null;

    const conditions =
      teeTimeResult?.conditions ??
      (selectedDay === 0 ? weather?.current?.conditions : selectedDaily?.conditions) ??
      null;

    const precipMm =
      (typeof teeTimeResult?.precipMm === "number" ? teeTimeResult.precipMm : null) ?? null;

    if (typeof tempC === "number") {
      if (tempC <= 2) chips.push({ label: "❄️ Too cold", weight: 100 });
      else if (tempC <= 6) chips.push({ label: "🥶 Cold", weight: 70 });
    }

    if (typeof windKph === "number") {
      if (windKph >= 35) chips.push({ label: "🌬 Very windy", weight: 90 });
      else if (windKph >= 25) chips.push({ label: "🌬 Windy", weight: 65 });
    }

    const cond = typeof conditions === "string" ? conditions.toLowerCase() : "";
    const precipy =
      (typeof precipMm === "number" && precipMm > 0) ||
      cond.includes("rain") ||
      cond.includes("drizzle") ||
      cond.includes("thunder") ||
      cond.includes("snow");

    if (precipy) {
      if (cond.includes("snow")) chips.push({ label: "🌨 Snow", weight: 95 });
      else chips.push({ label: "🌧 Wet", weight: 80 });
    }

    if (teeTime && teeTimeResult && teeTimeResult.inDaylight === false) {
      chips.push({ label: "🌙 Low light", weight: 60 });
    }

    if (chips.length === 0) chips.push({ label: "🚫 Poor conditions", weight: 50 });

    return chips
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 3)
      .map((c) => c.label);
  }, [showVerdict, teeTime, teeTimeResult, selectedDay, selectedDaily, weather]);

  const yellowReasonChips = useMemo(() => {
    if (showVerdict !== "YELLOW") return [];

    const chips: { label: string; weight: number }[] = [];

    const tempC =
      (typeof teeTimeResult?.temp === "number" ? teeTimeResult.temp : null) ??
      (selectedDay === 0 ? weather?.current?.temp : null) ??
      null;

    const windKph =
      (typeof teeTimeResult?.windKph === "number" ? teeTimeResult.windKph : null) ??
      (selectedDay === 0 ? weather?.current?.windKph : null) ??
      (typeof selectedDaily?.windMax === "number" ? selectedDaily.windMax : null) ??
      null;

    const conditions =
      teeTimeResult?.conditions ??
      (selectedDay === 0 ? weather?.current?.conditions : selectedDaily?.conditions) ??
      null;

    if (typeof tempC === "number") {
      if (tempC >= 30) chips.push({ label: "🌡 Hot", weight: 70 });
      else if (tempC <= 8) chips.push({ label: "🧊 Chilly", weight: 75 });
    }

    if (typeof windKph === "number") {
      if (windKph >= 20) chips.push({ label: "💨 Breezy", weight: 80 });
    }

    const cond = typeof conditions === "string" ? conditions.toLowerCase() : "";
    if (cond.includes("cloud") || cond.includes("overcast")) {
      chips.push({ label: "☁️ Cloudy", weight: 40 });
    }

    if (cond.includes("fog") || cond.includes("mist")) {
      chips.push({ label: "🌫 Foggy", weight: 60 });
    }

    // Analyze playOut to see if specific time blocks are problematic
    if (playOut?.segments) {
      const morning = playOut.segments.find((s: any) => s.key === "morning");
      const midday = playOut.segments.find((s: any) => s.key === "midday");
      const late = playOut.segments.find((s: any) => s.key === "late");

      if (morning && morning.score < 60) chips.push({ label: "⏰ Better later", weight: 65 });
      else if (late && late.score < 60) chips.push({ label: "⏰ Go early", weight: 65 });
      else if (midday && midday.score >= 70 && (morning.score < 65 || late.score < 65)) {
        chips.push({ label: "⏰ Catch midday window", weight: 70 });
      }
    }

    if (chips.length === 0) chips.push({ label: "✓ Playable", weight: 50 });

    return chips
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 3)
      .map((c) => c.label);
  }, [showVerdict, teeTime, teeTimeResult, selectedDay, selectedDaily, weather, playOut]);

  // Limiting factor hint for YELLOW days - explains what's keeping it from green
  const yellowLimitingFactor = useMemo(() => {
    if (showVerdict !== "YELLOW" || showScore == null || showScore >= 80) return null;

    const tempC =
      (typeof teeTimeResult?.temp === "number" ? teeTimeResult.temp : null) ??
      (selectedDay === 0 ? weather?.current?.temp : null) ??
      null;

    const windKph =
      (typeof teeTimeResult?.windKph === "number" ? teeTimeResult.windKph : null) ??
      (selectedDay === 0 ? weather?.current?.windKph : null) ??
      (typeof selectedDaily?.windMax === "number" ? selectedDaily.windMax : null) ??
      null;

    const conditions =
      teeTimeResult?.conditions ??
      (selectedDay === 0 ? weather?.current?.conditions : selectedDaily?.conditions) ??
      null;

    // Find the main factor keeping it from 80+
    const gap = 80 - showScore;
    
    if (typeof windKph === "number" && windKph >= 20) {
      return `💨 Wind ${windKph} km/h is the limiting factor today.`;
    }

    if (typeof tempC === "number") {
      if (tempC <= 8) {
        return `🧊 Temp ${tempC}°C is keeping it from green — dress warm.`;
      }
      if (tempC >= 30) {
        return `🌡 Heat (${tempC}°C) is the limiting factor today.`;
      }
    }

    const cond = typeof conditions === "string" ? conditions.toLowerCase() : "";
    if (cond.includes("cloud") || cond.includes("overcast")) {
      return `☁️ Cloud cover is keeping this from green — otherwise solid.`;
    }

    if (gap <= 5) {
      return `Just ${gap} pts from green — close call.`;
    }

    return null;
  }, [showVerdict, showScore, teeTimeResult, selectedDay, selectedDaily, weather]);

  // Frost delay warning - only for today
  const frostWarning = useMemo(() => {
    if (selectedDay !== 0 || !weather?.daily?.[0]) return null;
    const today = weather.daily[0];
    const minTemp = today?.minTemp ?? today?.minTempC ?? null;
    
    if (minTemp != null && minTemp <= 2) {
      return "❄️ Frost likely — courses may delay opening until mid-morning";
    }
    return null;
  }, [selectedDay, weather]);

  // Rain chance - only show if >20%
  const rainChance = useMemo(() => {
    if (selectedDay === 0) {
      const precipProb = weather?.current?.precipProb ?? weather?.daily?.[0]?.precipProb ?? null;
      if (precipProb != null && precipProb >= 20) {
        return `${Math.round(precipProb)}% chance of rain`;
      }
    } else if (selectedDaily) {
      const precipProb = selectedDaily?.precipProb ?? null;
      if (precipProb != null && precipProb >= 20) {
        return `${Math.round(precipProb)}% chance of rain`;
      }
    }
    return null;
  }, [selectedDay, weather, selectedDaily]);

  // UV index warning - only show if moderate or higher (≥3)
  const uvWarning = useMemo(() => {
    const uv = selectedDay === 0 
      ? (weather?.current?.uvIndex ?? weather?.daily?.[0]?.uvIndex ?? null)
      : (selectedDaily?.uvIndex ?? null);
    
    if (uv == null || uv < 3) return null;
    
    if (uv >= 8) return `☀️ UV ${uv} (Very High) — Sunscreen essential`;
    if (uv >= 6) return `☀️ UV ${uv} (High) — Wear sunscreen`;
    if (uv >= 3) return `☀️ UV ${uv} (Moderate) — Consider sunscreen`;
    return null;
  }, [selectedDay, weather, selectedDaily]);

  async function loadAll(c: Coords) {
    setLoading(true);
    setGeoErr(null);
    setWeather(null);
    setCourses(null);
    setSelectedDay(0);

    const [w, cs] = await Promise.all([
      fetch(`/api/weather?lat=${c.lat}&lon=${c.lon}`).then((r) => r.json()),
      fetch(`/api/courses?lat=${c.lat}&lon=${c.lon}`).then((r) => r.json()),
    ]);

    setWeather(w);
    setCourses(cs);

    setTeeTime("");
    setShowAllCourses(false);

    const day0Verdict = w?.daily?.[0]?.golf?.verdict ?? w?.golf?.verdict;
    if (day0Verdict === "RED" || day0Verdict === "NOT_GOLFABLE") {
      const sims = await fetch(`/api/simulators?lat=${c.lat}&lon=${c.lon}`).then((r) => r.json());
      setSimulators(sims);
    } else {
      setSimulators(null);
    }

    setLoading(false);
  }

  useEffect(() => {
    setTeeTime("");
  }, [selectedDay]);

  useEffect(() => {
    async function maybeLoadSims() {
      if (!coords || !weather?.daily) return;
      const v = weather?.daily?.[selectedDay]?.golf?.verdict;
      if (v === "RED" || v === "NOT_GOLFABLE") {
        const sims = await fetch(`/api/simulators?lat=${coords.lat}&lon=${coords.lon}`).then((r) =>
          r.json()
        );
        setSimulators(sims);
      } else {
        setSimulators(null);
      }
    }
    maybeLoadSims();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDay]);

  function useMyLocation() {
    if (!navigator.geolocation) {
      setGeoErr("Geolocation not supported in this browser.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setCoords(c);
        loadAll(c);
      },
      (err) => setGeoErr(err.message || "Couldn’t get your location."),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  useEffect(() => {
    const q = cityQuery.trim();
    if (q.length < 3) {
      setPredictions([]);
      return;
    }
    if (suppressAutocomplete.current) {
      suppressAutocomplete.current = false;
      return;
    }
    const t = setTimeout(async () => {
      try {
        setSearching(true);
        const res = await fetch(`/api/location/suggest?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setPredictions(Array.isArray(data?.predictions) ? data.predictions : []);
      } catch {
        setPredictions([]);
      } finally {
        setSearching(false);
      }
    }, 350);

    return () => clearTimeout(t);
  }, [cityQuery]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!boxRef.current) return;
      if (!boxRef.current.contains(e.target as Node)) setPredictions([]);
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);

  async function choosePrediction(p: Prediction) {
    try {
      setPredictions([]);
      setGeoErr(null);
      setLoading(true);

      const res = await fetch(`/api/location/resolve?placeId=${encodeURIComponent(p.placeId)}`);
      const data = await res.json();

      if (!res.ok || !Number.isFinite(data?.lat) || !Number.isFinite(data?.lon)) {
        setGeoErr(data?.error || "Couldn’t resolve that city.");
        setLoading(false);
        return;
      }

      setCityQuery(cleanCityLabel(data?.address || p.description));

      const c = { lat: Number(data.lat), lon: Number(data.lon) };
      setCoords(c);
      await loadAll(c);
    } catch {
      setGeoErr("Couldn’t resolve that city.");
      setLoading(false);
    }
  }

  async function searchAndLoad(label: string) {
    try {
      setGeoErr(null);
      setLoading(true);
      setPredictions([]); // prevent dropdown from showing

      const sres = await fetch(`/api/location/suggest?q=${encodeURIComponent(label)}`);
      const sdata = await sres.json();
      const first = Array.isArray(sdata?.predictions) ? sdata.predictions[0] : null;

      if (!first?.placeId) {
        setGeoErr("Couldn't find that location.");
        setLoading(false);
        return;
      }

      const rres = await fetch(`/api/location/resolve?placeId=${encodeURIComponent(first.placeId)}`);
      const rdata = await rres.json();

      if (!rres.ok || !Number.isFinite(rdata?.lat) || !Number.isFinite(rdata?.lon)) {
        setGeoErr(rdata?.error || "Couldn't resolve that city.");
        setLoading(false);
        return;
      }

      // Set city query AFTER resolving to the final address, then clear dropdown
      suppressAutocomplete.current = true;
      setCityQuery(cleanCityLabel(rdata?.address || label));
      setPredictions([]);
      const c = { lat: Number(rdata.lat), lon: Number(rdata.lon) };
      setCoords(c);
      await loadAll(c);
    } catch {
      setGeoErr("Couldn't load that city.");
      setLoading(false);
    }
  }

  /** v1.1: curated courses */
  const allCourses = Array.isArray(courses?.courses) ? courses.courses : [];
  const topCourses = useMemo(() => pickTopCourses(allCourses, 2), [allCourses]);

  const showSims = Array.isArray(simulators?.simulators) ? simulators.simulators : [];

  const restCourses = useMemo(() => {
    if (!allCourses.length) return [];
    if (!topCourses.length) return allCourses;
    const topIds = new Set(topCourses.map((t: any) => t.placeId));
    return allCourses.filter((c: any) => !topIds.has(c.placeId));
  }, [allCourses, topCourses]);

  return (
    <main className="min-h-screen bg-[#0b0f14] text-white">
      <div className="relative">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-35"
          style={{
            backgroundImage:
              "url(https://images.unsplash.com/photo-1520975958225-6b8b2b8d2c1c?auto=format&fit=crop&w=2400&q=80)",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/50 to-[#0b0f14]" />

        <div className="relative mx-auto max-w-5xl px-4 pb-8 pt-8 md:px-6 md:pb-10 md:pt-10">
		{/* About button – safe, non-intrusive */}
  <div className="absolute right-4 top-4 z-50 md:right-6 md:top-6">
    <Link
      href="/about"
      className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-semibold text-white/90 ring-1 ring-white/10 hover:bg-white/15 transition"
    >
      About
    </Link>
  </div>
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl pr-14 md:pr-0">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs text-white/80">
                ⛳ CanIGolfToday.com
              </div>

              <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl md:mt-4 md:text-5xl">
                Your tee-time forecast.
              </h1>
              <p className="mt-2 text-sm text-white/75 md:mt-3 md:text-base">
                Search a city or course — we’ll score the conditions and find the best 3‑hour daylight window.
              </p>

              <div className="mt-3 flex items-center gap-1.5 text-xs text-white/45">
                <span className="text-emerald-400/70">⛳</span>
                <span>Checked by{" "}
                  <span className="font-semibold text-white/60">{counterVal.toLocaleString()}</span>
                  {" "}golfers this week
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={useMyLocation}
                className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-black hover:opacity-90"
              >
                Use my location
              </button>
              {coords && cityQuery && (
                <div className="rounded-2xl bg-white/10 px-4 py-2 text-sm text-white/80">
                  📍 {cityQuery}
                </div>
              )}
            </div>
          </div>

          <section className="mt-8" ref={boxRef}>
            <div className="relative">
              <input
                value={cityQuery}
                onChange={(e) => setCityQuery(e.target.value)}
                placeholder="Search city or course: Guelph, Toronto, Glen Abbey…"
                className="w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/50 outline-none focus:border-white/25"
              />

              {predictions.length > 0 && (
                <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0f1620] shadow-xl">
                  {predictions.map((p) => (
                    <button
                      key={p.placeId}
                      onClick={() => choosePrediction(p)}
                      className="flex items-center gap-3 w-full px-4 py-3 text-left text-sm text-white/90 hover:bg-white/5"
                    >
                      <span className="text-base shrink-0">{p.kind === "course" ? "⛳" : "📍"}</span>
                      <span className="truncate">{p.description}</span>
                    </button>
                  ))}
                </div>
              )}

              {searching && <div className="mt-2 text-xs text-white/60">Searching…</div>}
            </div>

            {/* How scoring works - expandable */}
            <div className="mt-4">
              <button
                onClick={() => setShowScoreExplainer((v) => !v)}
                className="flex items-center gap-2 text-sm text-white/60 hover:text-white/80 transition"
              >
                <span className="text-base">ⓘ</span>
                <span>How we score conditions</span>
                <span className="text-xs">{showScoreExplainer ? "▲" : "▼"}</span>
              </button>

              {showScoreExplainer && (
                <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <span className="text-lg">🟢</span>
                    <div>
                      <div className="text-sm font-semibold text-white/90">80–100 · Book it</div>
                      <div className="text-sm text-white/55">Great conditions. Book it.</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="text-lg">🟡</span>
                    <div>
                      <div className="text-sm font-semibold text-white/90">60–79 · Playable</div>
                      <div className="text-sm text-white/55">Worth going if you catch the right window.</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="text-lg">🔴</span>
                    <div>
                      <div className="text-sm font-semibold text-white/90">Below 60 · Tough day</div>
                      <div className="text-sm text-white/55">Probably not worth it. Check the next few days.</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="text-lg">⛔</span>
                    <div>
                      <div className="text-sm font-semibold text-white/90">Off-season · Not golfable</div>
                      <div className="text-sm text-white/55">Courses are likely closed or under snow. No score shown.</div>
                    </div>
                  </div>
                  <div className="text-sm text-white/40 border-t border-white/10 pt-3">
                    Scores weigh temperature, wind, precipitation, humidity, and daylight. The best window is the
                    highest-scoring 3-hour stretch within golfing hours.
                  </div>
                </div>
              )}
            </div>

            {geoErr && (
              <div className="mt-3 rounded-2xl bg-rose-500/15 p-3 text-sm text-rose-200">
                {geoErr}
              </div>
            )}

          </section>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 pb-12 pt-6 md:px-6 md:pb-16 md:pt-8">
        {!loading && !(weather?.golf || selectedDaily?.golf) && (
          <section>
            <div className="text-sm font-semibold text-white/50 uppercase tracking-wider mb-4">Popular destinations</div>
            <div className="grid gap-2 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {[
                { label: "Scottsdale, AZ", slug: "scottsdale", emoji: "☀️" },
                { label: "Myrtle Beach, SC", slug: "myrtle-beach", emoji: "🏖️" },
                { label: "Pebble Beach, CA", slug: "pebble-beach", emoji: "🌊" },
                { label: "St. Andrews, Scotland", slug: "st-andrews", emoji: "🏴󠁧󠁢󠁳󠁣󠁴󠁿" },
                { label: "Augusta, GA", slug: "augusta", emoji: "🌸" },
                { label: "Bandon, OR", slug: "bandon", emoji: "🌲" },
                { label: "Toronto, ON", slug: "toronto", emoji: "🍁" },
                { label: "Cabot Cliffs, NS", slug: "cabot-cliffs", emoji: "🌬️" },
                { label: "Pinehurst, NC", slug: "pinehurst", emoji: "⛳" },
                { label: "Palm Springs, CA", slug: "palm-springs", emoji: "🌴" },
                { label: "Whistling Straits, WI", slug: "whistling-straits", emoji: "💨" },
                { label: "TPC Sawgrass, FL", slug: "tpc-sawgrass", emoji: "🐊" },
              ].map(({ label, emoji }, idx) => (
                <button
                  key={label}
                  onClick={() => searchAndLoad(label)}
                  className={[
                    "flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/80 hover:bg-white/10 hover:text-white transition text-left",
                    idx >= 6 ? "hidden md:flex" : "",
                  ].join(" ")}
                >
                  <span className="text-lg">{emoji}</span>
                  <span className="font-medium">{label}</span>
                </button>
              ))}
            </div>
          </section>
        )}




        {loading && (
          <section className="rounded-3xl bg-white/5 p-4 ring-1 ring-white/10 animate-pulse md:p-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-white/10" />
              <div className="space-y-2">
                <div className="h-6 w-32 rounded-lg bg-white/10" />
                <div className="h-4 w-48 rounded-lg bg-white/10" />
              </div>
            </div>
            <div className="mt-5 h-12 w-full rounded-2xl bg-white/10" />
            <div className="mt-4 rounded-2xl bg-white/5 p-4 space-y-3">
              <div className="h-4 w-40 rounded bg-white/10" />
              <div className="h-4 w-56 rounded bg-white/10" />
              <div className="h-4 w-52 rounded bg-white/10" />
              <div className="h-4 w-44 rounded bg-white/10" />
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="h-24 rounded-2xl bg-white/10" />
              <div className="h-24 rounded-2xl bg-white/10" />
            </div>
            <div className="mt-6 space-y-2">
              <div className="h-4 w-24 rounded bg-white/10" />
              <div className="mt-3 flex gap-2">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-16 w-28 rounded-2xl bg-white/10" />
                ))}
              </div>
            </div>
          </section>
        )}

        {(weather?.golf || selectedDaily?.golf) && (
          <section className={`rounded-3xl bg-white/5 p-4 shadow-sm ring-1 md:p-6 ${style.ring}`}>
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <div
                    className={`h-10 w-10 rounded-2xl ${style.pill} grid place-items-center text-lg`}
                  >
                    {style.dot}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="text-2xl font-semibold">{verdictLabel}</div>
                      <div className="rounded-full bg-white/10 px-2.5 py-0.5 text-sm text-white/60">
                        {selectedDay === 0 ? "Today" : selectedDaily?.dayLabel ?? ""}
                      </div>
                    </div>
                    {showVerdict === "NOT_GOLFABLE" ? (
                      <div className="mt-1 text-sm text-white/60">
                        {showReason ?? "Off-season — courses closed or unplayable"}
                      </div>
                    ) : (
                    <div className="mt-1 text-sm text-white/70">
                      Score: <span className="font-semibold text-white">{showScore}</span>/100 —{" "}
                      {showReason}
                    </div>
                    )}

                    {showVerdict !== "NOT_GOLFABLE" && yellowLimitingFactor && (
                      <div className="mt-2 text-sm text-white/60 italic">
                        {yellowLimitingFactor}
                      </div>
                    )}

                    {showVerdict !== "NOT_GOLFABLE" && confidenceLine && showVerdict !== "YELLOW" && (
                      <div className="mt-2 text-sm text-white/80">{confidenceLine}</div>
                    )}

                    {showVerdict === "NOT_GOLFABLE" && (
                      <div className="mt-3 rounded-2xl bg-slate-500/15 border border-slate-500/30 px-4 py-3 text-sm text-slate-200">
                        ❄️ It's off-season for golf in this region. Check back in late April or May when courses typically open.
                      </div>
                    )}

                    {showVerdict !== "NOT_GOLFABLE" && carryChangeText && (
                      <div className="mt-3">
                        <Chip>{carryChangeText} carry vs typical</Chip>
                      </div>
                    )}

                    {showVerdict === "RED" && redReasonChips.length > 0 && (
                      <div className="mt-3 flex gap-2 overflow-x-auto pb-2 scrollbar-none">
                        {redReasonChips.map((c) => (
                          <Chip key={c}>{c}</Chip>
                        ))}
                      </div>
                    )}

                    {showVerdict === "YELLOW" && !yellowLimitingFactor && yellowReasonChips.length > 0 && (
                      <div className="mt-3 flex gap-2 overflow-x-auto pb-2 scrollbar-none">
                        {yellowReasonChips.map((c) => (
                          <Chip key={c}>{c}</Chip>
                        ))}
                      </div>
                    )}

                    {/* Frost warning and rain chance - show for all verdicts except NOT_GOLFABLE */}
                    {showVerdict !== "NOT_GOLFABLE" && (frostWarning || rainChance) && (
                      <div className="mt-3 flex gap-2 overflow-x-auto pb-2 scrollbar-none">
                        {frostWarning && (
                          <Chip>{frostWarning}</Chip>
                        )}
                        {rainChance && (
                          <Chip>🌧 {rainChance}</Chip>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                
{showVerdict !== "NOT_GOLFABLE" && (bestWindowText || sunriseSunsetText) && (
  <div className="mt-4 rounded-2xl bg-white/10 px-4 py-3 text-sm">
    {/* Row 1: best window + share */}
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-base">⛳</span>
        <span className="text-white/60">Best window</span>
        {bestWindowText && (
          <span className="font-semibold text-white">{bestWindowText}</span>
        )}
      </div>
      <button
        type="button"
        onClick={async () => {
          try {
            if (navigator.share) {
              await navigator.share({
                title: "Can I Golf Today?",
                text: `Check golf conditions in ${cityQuery?.trim() || "this area"}`,
                url: shareUrl,
              });
            } else {
              await navigator.clipboard.writeText(shareUrl);
              setCopied(true);
            }
          } catch {
            // user cancelled or no-op
          }
        }}
        className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/80 hover:bg-white/15 transition"
        title="Share conditions"
      >
        {copied ? "Copied!" : "Share ↗"}
      </button>
    </div>

    {/* Row 2: sunrise / sunset */}
    {(sunriseText || sunsetText) && (
      <div className="mt-2 flex items-center gap-3 text-xs text-white/50">
        {sunriseText && <span>↑ Sunrise {sunriseText}</span>}
        {sunriseText && sunsetText && <span className="text-white/20">·</span>}
        {sunsetText && <span>↓ Sunset {sunsetText}</span>}
      </div>
    )}
  </div>
)}

                
                {showVerdict !== "NOT_GOLFABLE" && (
                <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="text-xs font-semibold text-white/50 uppercase tracking-wider">Tee time</div>

                    <input
                      type="time"
                      value={teeTime}
                      onChange={(e) => setTeeTime(e.target.value)}
                      className="rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/25"
                    />

                    {teeTime && (
                      <button
                        onClick={() => setTeeTime("")}
                        className="text-sm text-white/60 underline decoration-white/30 hover:text-white"
                      >
                        clear
                      </button>
                    )}
                  </div>

                {showVerdict !== "RED" && playOut?.segments && (
                  <div className="mt-4">
                    <div className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">How the day plays out</div>
                    <div className="flex gap-2 flex-wrap">
                      {[
                        { key: "morning", label: "Morning", endHour: 11 },
                        { key: "midday",  label: "Midday",  endHour: 15 },
                        { key: "late",    label: "Late",    endHour: 24 },
                      ].map(({ key, label, endHour }) => {
                        const s = playOut?.segments?.find((x: any) => x.key === key)?.score;
                        const isBest = playOut?.bestBucket === key;
                        // Dim bucket if we're past its window (today only)
                        const isPast = selectedDay === 0 && nowLocalHour >= endHour;
                        const rating = isBest ? "Best window" : s == null ? "—" : key === "late" ? (s >= 65 ? "Holds up" : "Falls off") : (s >= 80 ? "Excellent" : s >= 60 ? "Decent" : "Challenging");
                        return (
                          <div
                            key={key}
                            className={`flex-1 min-w-[90px] rounded-2xl px-3 py-2.5 text-sm text-center border transition-opacity ${
                              isPast
                                ? "bg-white/3 border-white/5 opacity-40"
                                : isBest
                                ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300"
                                : "bg-white/5 border-white/10 text-white/70"
                            }`}
                          >
                            <div className={`text-xs font-semibold mb-0.5 ${isPast ? "text-white/30" : "text-white/50"}`}>
                              {label}{isPast ? " · done" : ""}
                            </div>
                            <div className={`text-sm font-semibold ${
                              isPast ? "line-through text-white/25" : isBest ? "text-emerald-300" : "text-white/85"
                            }`}>
                              {rating}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {showVerdict !== "RED" && (greensSpeed || fairwayRollout) && (
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {greensSpeed && (
                      <div className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/10">
                        <div className="flex items-start justify-between gap-3">
                          <div className="text-sm font-semibold text-white/90">Greens speed</div>
                          <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold" style={groundBadgeStyle(cleanGroundLabel(greensSpeed.label))}>
                            {cleanGroundLabel(greensSpeed.label)}
                          </span>
                        </div>
                        <div className="mt-1 text-sm text-white/70">{greensSpeed.detail}</div>
                      </div>
                    )}

                    {fairwayRollout && (
                      <div className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/10">
                        <div className="flex items-start justify-between gap-3">
                          <div className="text-sm font-semibold text-white/90">Fairway rollout</div>
                          <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold" style={groundBadgeStyle(cleanGroundLabel(fairwayRollout.label))}>
                            {cleanGroundLabel(fairwayRollout.label)}
                          </span>
                        </div>
                        <div className="mt-1 text-sm text-white/70">{fairwayRollout.detail}</div>
                      </div>
                    )}

                  </div>
                )}



                  {teeTimeWarning && (
                    <div className="mt-3 rounded-2xl bg-amber-500/15 border border-amber-500/30 px-4 py-2.5 text-sm text-amber-200">
                      {teeTimeWarning}
                    </div>
                  )}

                  {teeTimeResult && (
                    <div className={`mt-3 inline-flex items-center gap-3 rounded-2xl px-4 py-2.5 text-sm border ${
                      teeTimeResult.score >= 80 
                        ? "bg-emerald-500/15 border-emerald-500/30" 
                        : teeTimeResult.score >= 60 
                        ? "bg-amber-500/15 border-amber-500/30"
                        : "bg-rose-500/15 border-rose-500/30"
                    }`}>
                      <div className="flex items-center gap-2">
                        <span className="text-white/60 text-xs">At {teeTime}</span>
                        <span className="font-bold text-white text-lg">{teeTimeResult.score}/100</span>
                      </div>
                      <span className="text-white/30">·</span>
                      <span className="text-white/50 text-xs">
                        wind {teeTimeResult.windKph}k · {teeTimeResult.conditions}
                      </span>
                    </div>
                  )}
                </div>
                )} {/* end NOT_GOLFABLE gate */}

                {Array.isArray(weather?.daily) && weather.daily.length > 0 && (
                  <div className="mt-5">
                    <div className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">Next 5 days</div>
                    <div className="relative group/days">
                      {/* Left arrow - desktop only */}
                      <button
                        className="hidden md:flex absolute -left-3 top-1/2 -translate-y-1/2 z-10 h-8 w-8 items-center justify-center rounded-full bg-white/10 border border-white/10 text-white/60 hover:bg-white/20 hover:text-white transition opacity-0 group-hover/days:opacity-100"
                        onClick={() => daysScrollRef.current?.scrollBy({ left: -176, behavior: "smooth" })}
                      >
                        ‹
                      </button>
                      <div ref={daysScrollRef} className="flex gap-2 overflow-x-auto -mx-1 px-1" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                      {weather.daily.slice(0, 5).map((d: any, idx: number) => {
                        const v = d?.golf?.verdict;
                        const dot = v === "GREEN" ? "🟢" : v === "YELLOW" ? "🟡" : v === "NOT_GOLFABLE" ? "⛔" : "🔴";
                        const active = idx === selectedDay;

                        return (
                          <button
                            key={d.dateKey || idx}
                            onClick={() => setSelectedDay(idx)}
                            className={[
                              "flex-shrink-0 w-40 rounded-2xl border px-3 py-3 text-left text-sm transition",
                              active
                                ? "border-white/30 bg-white/10"
                                : "border-white/10 bg-white/5 hover:bg-white/10",
                            ].join(" ")}
                          >
                            <div className="flex items-center gap-2">
                              <span>{dot}</span>
                              <span className="font-semibold">{idx === 0 ? "Today" : d.dayLabel}</span>
                            </div>
                            <div className="mt-1.5 text-xs text-white/65">
                              {d.maxTemp ?? "—"}° / {d.minTemp ?? "—"}°
                            </div>
                            <div className="mt-0.5 text-xs text-white/50">
                              Wind {d.windMax ?? "—"}k
                            </div>
                            {d.pop != null && (
                              <div className="mt-0.5 text-xs text-white/45">
                                🌧 {d.pop}% · 💧 {d.humidity ?? "—"}%
                              </div>
                            )}
                          </button>
                        );
                      })}
                      </div>
                      {/* Right arrow - desktop only */}
                      <button
                        className="hidden md:flex absolute -right-3 top-1/2 -translate-y-1/2 z-10 h-8 w-8 items-center justify-center rounded-full bg-white/10 border border-white/10 text-white/60 hover:bg-white/20 hover:text-white transition opacity-0 group-hover/days:opacity-100"
                        onClick={() => daysScrollRef.current?.scrollBy({ left: 176, behavior: "smooth" })}
                      >
                        ›
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-3xl bg-white/5 p-5 text-sm text-white/80 ring-1 ring-white/10 md:min-w-[240px] md:self-start order-last">
                {selectedDay === 0 ? (
                  <>
                    <div className="flex justify-between gap-6">
                      <span className="text-white/60">Temp</span>
                      <span>
                        {weather?.current?.temp ?? "—"}°C{" "}
                        <span className="text-white/50">
                          (feels {weather?.current?.feels ?? "—"}°C)
                        </span>
                      </span>
                    </div>
                    <div className="mt-2 flex justify-between gap-6">
                      <span className="text-white/60">Wind</span>
                      <span>
                        {weather?.current?.windKph ?? "—"} km/h
                        {weather?.current?.windDeg != null && (
                          <span className="text-white/70"> {windDirFromDeg(weather.current.windDeg)}</span>
                        )}
                        {" "}
                        <span className="text-white/50">
                          (gust {weather?.current?.gustKph ?? "—"})
                        </span>
                      </span>
                    </div>

                    {showVerdict !== "NOT_GOLFABLE" && weather?.current?.conditions && (
                      <div className="mt-2 flex justify-between gap-6">
                        <span className="text-white/60">Conditions</span>
                        <span>{weather.current.conditions}</span>
                      </div>
                    )}

                    {showVerdict !== "NOT_GOLFABLE" && (weather?.current?.uvIndex ?? weather?.daily?.[0]?.uvIndex) != null && (
                      <div className="mt-2 flex justify-between gap-6">
                        <span className="text-white/60">UV Index</span>
                        <span>
                          {Math.round(weather?.current?.uvIndex ?? weather?.daily?.[0]?.uvIndex)}
                          <span className="text-white/50 ml-1.5">
                            {(() => {
                              const uv = weather?.current?.uvIndex ?? weather?.daily?.[0]?.uvIndex;
                              if (uv >= 8) return "Very High";
                              if (uv >= 6) return "High";
                              if (uv >= 3) return "Moderate";
                              return "Low";
                            })()}
                          </span>
                        </span>
                      </div>
                    )}

                    {showVerdict !== "NOT_GOLFABLE" && weather?.current?.humidity != null && (
                      <div className="mt-2 flex justify-between gap-6">
                        <span className="text-white/60">Humidity</span>
                        <span>{weather.current.humidity}%</span>
                      </div>
                    )}

                    {showVerdict !== "NOT_GOLFABLE" && weather?.daily?.[0]?.pop != null && (
                      <div className="mt-2 flex justify-between gap-6">
                        <span className="text-white/60">Rain chance</span>
                        <span>{weather.daily[0].pop}%</span>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex justify-between gap-6">
                      <span className="text-white/60">High / Low</span>
                      <span>
                        {selectedDaily?.maxTemp ?? "—"}° / {selectedDaily?.minTemp ?? "—"}°
                      </span>
                    </div>
                    <div className="mt-2 flex justify-between gap-6">
                      <span className="text-white/60">Max wind</span>
                      <span>
                        {selectedDaily?.windMax ?? "—"} km/h
                        <span className="text-white/50"> (gust {selectedDaily?.gustMax ?? "—"})</span>
                      </span>
                    </div>

                    {showVerdict !== "NOT_GOLFABLE" && selectedDaily?.conditions && (
                      <div className="mt-2 flex justify-between gap-6">
                        <span className="text-white/60">Conditions</span>
                        <span>{selectedDaily.conditions}</span>
                      </div>
                    )}

                    {showVerdict !== "NOT_GOLFABLE" && selectedDaily?.uvIndex != null && (
                      <div className="mt-2 flex justify-between gap-6">
                        <span className="text-white/60">UV Index</span>
                        <span>
                          {Math.round(selectedDaily.uvIndex)}
                          <span className="text-white/50 ml-1.5">
                            {(() => {
                              const uv = selectedDaily.uvIndex;
                              if (uv >= 8) return "Very High";
                              if (uv >= 6) return "High";
                              if (uv >= 3) return "Moderate";
                              return "Low";
                            })()}
                          </span>
                        </span>
                      </div>
                    )}

                    {showVerdict !== "NOT_GOLFABLE" && selectedDaily?.humidity != null && (
                      <div className="mt-2 flex justify-between gap-6">
                        <span className="text-white/60">Humidity</span>
                        <span>{selectedDaily.humidity}%</span>
                      </div>
                    )}

                    {showVerdict !== "NOT_GOLFABLE" && selectedDaily?.pop != null && (
                      <div className="mt-2 flex justify-between gap-6">
                        <span className="text-white/60">Rain chance</span>
                        <span>{selectedDaily.pop}%</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </section>
        )}

        {/* v1.1: curated “Top picks near you” + expandable full list */}
        {(topCourses.length > 0 || allCourses.length > 0) && (
          <section className="mt-8">
            <div className="flex items-end justify-between gap-6">
              <div>
                <h2 className="text-xl font-semibold">Top picks near you</h2>
                <div className="mt-1 text-sm text-white/60">
                  Curated by rating + “open now” (quick list — not a directory).
                </div>
              </div>

              <div className="text-sm text-white/60">
                {showVerdict === "RED" || showVerdict === "NOT_GOLFABLE" ? "Likely closed (try sims)" : "Tap for directions"}
              </div>
            </div>

            {topCourses.length > 0 ? (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {topCourses.map((c: any) => (
                  <CourseCard key={c.placeId} c={c} />
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
                No courses found nearby.
              </div>
            )}

            {restCourses.length > 0 && (
              <div className="mt-4">
                <button
                  onClick={() => setShowAllCourses((v) => !v)}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/85 hover:bg-white/10"
                >
                  {showAllCourses ? "Show less" : `Show ${restCourses.length} more`}
                </button>

                {showAllCourses && (
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {restCourses.map((c: any) => (
                      <CourseCard key={c.placeId} c={c} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {(showVerdict === "RED" || showVerdict === "NOT_GOLFABLE") && showSims.length > 0 && (
          <section className="mt-8">
            <div className="flex items-end justify-between gap-6">
              <h2 className="text-xl font-semibold">Indoor golf / simulators</h2>
              <div className="text-sm text-white/60">{showVerdict === "NOT_GOLFABLE" ? "Off-season? Try a sim." : "Because it’s a red day outside."}</div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {showSims.map((s: any) => (
                <a
                  key={s.placeId}
                  href={s.mapsUrl || "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="group rounded-3xl border border-white/10 bg-white/5 p-5 transition hover:bg-white/10"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold">{s.name}</div>
                      <div className="mt-1 line-clamp-2 text-sm text-white/65">{s.address ?? ""}</div>
                      <div className="mt-3 text-sm text-white/80">
                        {s.rating ? `⭐ ${s.rating} (${s.userRatingsTotal ?? 0})` : "No rating yet"}
                        {s.openNow === true ? " · Open now" : s.openNow === false ? " · Closed" : ""}
                      </div>
                    </div>
                    <div className="rounded-2xl bg-white/10 px-3 py-2 text-xs text-white/70 group-hover:bg-white/15">
                      View
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}

        <div className="mt-14 text-center text-xs text-white/45">
          Built for quick decisions — not perfect predictions. Always check course openings + frost delays.
        </div>
      </div>
    </main>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type Coords = { lat: number; lon: number };
type Prediction = { kind: "city" | "course"; placeId: string; description: string };


function verdictStyles(verdict?: string) {
  if (verdict === "GREEN") return { dot: "🟢", pill: "bg-emerald-600", ring: "ring-emerald-200" };
  if (verdict === "YELLOW") return { dot: "🟡", pill: "bg-amber-500", ring: "ring-amber-200" };
  return { dot: "🔴", pill: "bg-rose-600", ring: "ring-rose-200" };
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

  return (
    <a
      href={c.mapsUrl || "#"}
      target="_blank"
      rel="noreferrer"
      className="group rounded-3xl border border-white/10 bg-white/5 p-5 transition hover:bg-white/10"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
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

          <div className="mt-4 text-sm text-white/70">Tap to open directions</div>
        </div>

        <div className="rounded-2xl bg-white/10 px-3 py-2 text-xs font-semibold text-white/80 group-hover:bg-white/15">
          Maps →
        </div>
      </div>
    </a>
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

  // Selected day (0..4)
  const [selectedDay, setSelectedDay] = useState<number>(0);

  // Optional tee time ("HH:MM")
  const [teeTime, setTeeTime] = useState<string>("");

  // v1.1: “Show all courses” toggle
  const [showAllCourses, setShowAllCourses] = useState(false);

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

  const showVerdict =
    teeTimeResult?.verdict ?? selectedDaily?.golf?.verdict ?? weather?.golf?.verdict ?? null;

  const verdictLabel = useMemo(() => {
    const v = showVerdict;
    if (!v) return null;
    if (v === "GREEN") return "Green light";
    if (v === "YELLOW") return "Playable";
    return "Not golfable";
  }, [showVerdict]);


  const carryChange = useMemo(() => {
    if (showVerdict === "RED") return null;

    // Prefer day-specific values; fall back to current conditions for today
    const t =
      selectedDay === 0
        ? getNum(weather?.current?.temp) ?? getNum(weather?.current?.feels) ?? null
        : getNum(selectedDaily?.maxTemp) ?? getNum(selectedDaily?.max) ?? null;

    return estimateCarryChangeYards({ tempC: t, verdict: showVerdict });
  }, [showVerdict, selectedDay, selectedDaily, weather]);

  const carryChangeText = useMemo(() => {
    if (!carryChange) return null;
    const min = carryChange.minYds;
    const max = carryChange.maxYds;

    const fmt = (n: number) => `${n > 0 ? "+" : ""}${n}`;
    if (min === max) return `${fmt(min)} yds`;
    return `${fmt(min)} to ${fmt(max)} yds`;
  }, [carryChange]);

  const bestWindowText = useMemo(() => {
    const bw = selectedDaily?.bestWindow ?? weather?.bestTime?.bestWindow;
    if (!bw?.startLabel || !bw?.endLabel) return null;
    return `${bw.startLabel} – ${bw.endLabel} (avg ${bw.avgScore}/100)`;
  }, [selectedDaily, weather]);

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



  // ✅ FIX: hook is top-level (not inside another hook)
  const greensFirmness = useMemo(() => computeGreensFirmness(weather), [weather]);

  const showScore = teeTimeResult?.score ?? selectedDaily?.golf?.score ?? weather?.golf?.score;
  const showReason = teeTimeResult?.reason ?? selectedDaily?.golf?.reason ?? weather?.golf?.reason;

  const style = verdictStyles(showVerdict || "RED");

  const confidenceLine = useMemo(() => {
    const v = showVerdict;
    if (v === "GREEN") return "Book it with confidence.";
    if (v === "YELLOW") return "Playable if you catch the window.";
    if (v === "RED") return "Courses are likely closed or unpleasant.";
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

  async function loadAll(c: Coords) {
    setLoading(true);
    setGeoErr(null);

    const [w, cs] = await Promise.all([
      fetch(`/api/weather?lat=${c.lat}&lon=${c.lon}`).then((r) => r.json()),
      fetch(`/api/courses?lat=${c.lat}&lon=${c.lon}`).then((r) => r.json()),
    ]);

    setWeather(w);
    setCourses(cs);

    setSelectedDay(0);
    setTeeTime("");
    setShowAllCourses(false);

    const day0Verdict = w?.daily?.[0]?.golf?.verdict ?? w?.golf?.verdict;
    if (day0Verdict === "RED") {
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
      if (v === "RED") {
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
    if (q.length < 2) {
      setPredictions([]);
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
    }, 250);

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

      setCityQuery(data?.address || p.description);

      const c = { lat: Number(data.lat), lon: Number(data.lon) };
      setCoords(c);
      await loadAll(c);
    } catch {
      setGeoErr("Couldn’t resolve that city.");
      setLoading(false);
    }
  }

  /** v1.1: curated courses */
  const allCourses = Array.isArray(courses?.courses) ? courses.courses : [];
  const topCourses = useMemo(() => pickTopCourses(allCourses, 4), [allCourses]);

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

        <div className="relative mx-auto max-w-5xl px-6 pb-10 pt-10">
		{/* About button – safe, non-intrusive */}
  <div className="absolute right-6 top-6 z-50">
    <Link
      href="/about"
      className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-semibold text-white/90 ring-1 ring-white/10 hover:bg-white/15 transition"
    >
      About
    </Link>
  </div>
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs text-white/80">
                ⛳ CanIGolfToday.com
              </div>

              <h1 className="mt-4 text-4xl font-semibold tracking-tight md:text-5xl">
                Your tee-time forecast.
              </h1>
              <p className="mt-3 text-white/75">
                Search a city or course — we’ll score the conditions and find the best 3‑hour daylight window.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={useMyLocation}
                className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-black hover:opacity-90"
              >
                Use my location
              </button>
              {coords && (
                <div className="rounded-2xl bg-white/10 px-4 py-2 text-sm text-white/80">
                  {coords.lat.toFixed(3)}, {coords.lon.toFixed(3)}
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
                      className="block w-full px-4 py-3 text-left text-sm text-white/90 hover:bg-white/5"
                    >
                      {p.description}
                    </button>
                  ))}
                </div>
              )}

              {searching && <div className="mt-2 text-xs text-white/60">Searching…</div>}

            {/* Quick picks + secondary actions */}
            <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-wrap gap-2">
                {["Toronto", "Myrtle Beach", "Scottsdale", "Pebble Beach", "Cabot Cliffs"].map(
                  (label) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setCityQuery(label)}
                      className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/80 ring-1 ring-white/10 hover:bg-white/15"
                    >
                      {label}
                    </button>
                  )
                )}
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={useMyLocation}
                  className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-semibold text-white/90 ring-1 ring-white/10 hover:bg-white/15 transition"
                >
                  Use my location
                </button>

                {coords && (
                  <div className="rounded-2xl bg-white/5 px-4 py-2 text-sm text-white/70 ring-1 ring-white/10">
                    {coords.lat.toFixed(3)}, {coords.lon.toFixed(3)}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-3 text-xs text-white/50">
              Built for quick decisions — not perfect predictions. Always check course openings + frost delays.
            </div>
            </div>

            {geoErr && (
              <div className="mt-3 rounded-2xl bg-rose-500/15 p-3 text-sm text-rose-200">
                {geoErr}
              </div>
            )}
          </section>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 pb-16 pt-8">
        {!loading && !(weather?.golf || selectedDaily?.golf) && (
          <section className="grid gap-4 md:grid-cols-3">
            <div className="rounded-3xl bg-white/5 p-5 ring-1 ring-white/10">
              <div className="text-sm font-semibold text-white/90">How it works</div>
              <div className="mt-2 text-sm text-white/70">
                We score temperature, wind, precipitation, and daylight to find the best golf window.
              </div>
            </div>

            <div className="rounded-3xl bg-white/5 p-5 ring-1 ring-white/10">
              <div className="text-sm font-semibold text-white/90">What the score means</div>
              <div className="mt-2 text-sm text-white/70">
                Green = ideal. Yellow = playable tradeoffs. Red = tough conditions.
              </div>
            </div>

            <div className="rounded-3xl bg-white/5 p-5 ring-1 ring-white/10">
              <div className="text-sm font-semibold text-white/90">Why it’s simple</div>
              <div className="mt-2 text-sm text-white/70">
                No forecasts overload — just a clear “should I book?”
              </div>
            </div>
          </section>
        )}
        {loading && <div className="text-white/70">Loading…</div>}

        {(weather?.golf || selectedDaily?.golf) && (
          <section className={`rounded-3xl bg-white/5 p-6 shadow-sm ring-1 ${style.ring}`}>
            <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <div
                    className={`h-10 w-10 rounded-2xl ${style.pill} grid place-items-center text-lg`}
                  >
                    {style.dot}
                  </div>
                  <div>
                    <div className="text-2xl font-semibold">{verdictLabel}</div>
                    <div className="mt-1 text-sm text-white/70">
                      Score: <span className="font-semibold text-white">{showScore}</span>/100 —{" "}
                      {showReason}
                    </div>

                    {confidenceLine && (
                      <div className="mt-2 text-sm text-white/80">{confidenceLine}</div>
                    )}

                    {showVerdict === "RED" && redReasonChips.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {redReasonChips.map((c) => (
                          <Chip key={c}>{c}</Chip>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                
{(bestWindowText || sunriseSunsetText) && (
  <div className="mt-4 inline-flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-white/10 px-4 py-2 text-sm text-white/85">
    {bestWindowText && (
      <>
        <span className="text-white/70">Best tee-time window</span>
        <span className="font-semibold">{bestWindowText}</span>
      </>
    )}
    {sunriseSunsetText && (
      <span className="text-white/60">{sunriseSunsetText}</span>
    )}
  </div>
)}

                {selectedDay === 0 && greensFirmness && showVerdict !== "RED" && (
                  <div className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-2 text-sm text-white/85">
                    <span className="font-semibold">{greensFirmness.label}</span>
                    <span className="text-white/60">— {greensFirmness.detail}</span>
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <div className="text-sm text-white/70">Tee time (optional)</div>

                  <input
                    type="time"
                    value={teeTime}
                    onChange={(e) => setTeeTime(e.target.value)}
                    className="rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/25"
                  />

                  {teeTimeResult && (
                    <div className="rounded-2xl bg-white/10 px-4 py-2 text-sm text-white/85">
                      <span className="text-white/60">At {teeTime}:</span>{" "}
                      <span className="font-semibold">{teeTimeResult.score}/100</span>{" "}
                      <span className="text-white/60">
                        (wind {teeTimeResult.windKph}k, {teeTimeResult.conditions})
                      </span>
                    </div>
                  )}

                  {teeTime && (
                    <button
                      onClick={() => setTeeTime("")}
                      className="text-sm text-white/60 underline decoration-white/30 hover:text-white"
                    >
                      clear
                    </button>
                  )}
                </div>

                {Array.isArray(weather?.daily) && weather.daily.length > 0 && (
                  <div className="mt-5">
                    <div className="text-xs font-semibold text-white/60">Next 5 days</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {weather.daily.slice(0, 5).map((d: any, idx: number) => {
                        const v = d?.golf?.verdict;
                        const dot = v === "GREEN" ? "🟢" : v === "YELLOW" ? "🟡" : "🔴";
                        const active = idx === selectedDay;

                        return (
                          <button
                            key={d.dateKey || idx}
                            onClick={() => setSelectedDay(idx)}
                            className={[
                              "rounded-2xl border px-4 py-3 text-left text-sm transition",
                              active
                                ? "border-white/30 bg-white/10"
                                : "border-white/10 bg-white/5 hover:bg-white/10",
                            ].join(" ")}
                          >
                            <div className="flex items-center gap-2">
                              <span>{dot}</span>
                              <span className="font-semibold">{d.dayLabel}</span>
                            </div>
                            <div className="mt-1 text-xs text-white/65">
                              {d.maxTemp ?? "—"}° / {d.minTemp ?? "—"}° · wind{" "}
                              {d.windMax ?? "—"}k
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-3xl bg-white/5 p-5 text-sm text-white/80 ring-1 ring-white/10 md:min-w-[280px]">
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
                        {weather?.current?.windKph ?? "—"} km/h{" "}
                        <span className="text-white/50">
                          (gust {weather?.current?.gustKph ?? "—"})
                        </span>
                      </span>
                    </div>

                    {carryChangeText && (
                      <div className="mt-2 flex justify-between gap-6">
                        <span className="text-white/60">Carry change</span>
                        <span>{carryChangeText}</span>
                      </div>
                    )}

                    {weather?.current?.conditions && (
                      <div className="mt-2 flex justify-between gap-6">
                        <span className="text-white/60">Conditions</span>
                        <span>{weather.current.conditions}</span>
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
                      <span>{selectedDaily?.windMax ?? "—"} km/h</span>
                    </div>

                    {carryChangeText && (
                      <div className="mt-2 flex justify-between gap-6">
                        <span className="text-white/60">Carry change</span>
                        <span>{carryChangeText}</span>
                      </div>
                    )}

                    {selectedDaily?.conditions && (
                      <div className="mt-2 flex justify-between gap-6">
                        <span className="text-white/60">Conditions</span>
                        <span>{selectedDaily.conditions}</span>
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
                {showVerdict === "RED" ? "Likely closed (try sims)" : "Tap for directions"}
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
                No top picks found nearby.
              </div>
            )}

            {allCourses.length > 0 && (
              <div className="mt-5 flex flex-col items-start gap-3">
                <button
                  onClick={() => setShowAllCourses((v) => !v)}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/85 hover:bg-white/10"
                >
                  {showAllCourses ? "Hide all courses" : `Show all ${allCourses.length} courses`}
                </button>

                {showAllCourses && (
                  <div className="w-full">
                    <div className="mb-3 text-sm text-white/60">All nearby courses</div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {restCourses.map((c: any) => (
                        <CourseCard key={c.placeId} c={c} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {showVerdict === "RED" && showSims.length > 0 && (
          <section className="mt-8">
            <div className="flex items-end justify-between gap-6">
              <h2 className="text-xl font-semibold">Indoor golf / simulators</h2>
              <div className="text-sm text-white/60">Because it’s a red day outside.</div>
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

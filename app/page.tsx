"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Coords = { lat: number; lon: number };
type Prediction = { placeId: string; description: string };

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

  const bestWindowText = useMemo(() => {
    const bw = selectedDaily?.bestWindow ?? weather?.bestTime?.bestWindow;
    if (!bw?.startLabel || !bw?.endLabel) return null;
    return `${bw.startLabel} – ${bw.endLabel} (avg ${bw.avgScore}/100)`;
  }, [selectedDaily, weather]);

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

  const showCourses = Array.isArray(courses?.courses) ? courses.courses : [];
  const showSims = Array.isArray(simulators?.simulators) ? simulators.simulators : [];

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
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs text-white/80">
                ⛳ CanIGolfToday.com
              </div>

              <h1 className="mt-4 text-4xl font-semibold tracking-tight md:text-5xl">
                Your tee-time forecast.
              </h1>
              <p className="mt-3 text-white/75">
                Search a city — we’ll score the conditions, find the best daylight window, and show nearby courses.
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
                placeholder="Search city: Guelph, Toronto, Myrtle Beach…"
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
        {loading && <div className="text-white/70">Loading…</div>}

        {(weather?.golf || selectedDaily?.golf) && (
          <section className={`rounded-3xl bg-white/5 p-6 shadow-sm ring-1 ${style.ring}`}>
            <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <div className={`h-10 w-10 rounded-2xl ${style.pill} grid place-items-center text-lg`}>
                    {style.dot}
                  </div>
                  <div>
                    <div className="text-2xl font-semibold">{verdictLabel}</div>
                    <div className="mt-1 text-sm text-white/70">
                      Score: <span className="font-semibold text-white">{showScore}</span>/100 —{" "}
                      {showReason}
                    </div>

                    {confidenceLine && <div className="mt-2 text-sm text-white/80">{confidenceLine}</div>}

                    {showVerdict === "RED" && redReasonChips.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {redReasonChips.map((c) => (
                          <Chip key={c}>{c}</Chip>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {bestWindowText && (
                  <div className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-2 text-sm text-white/85">
                    <span className="text-white/70">Best tee-time window</span>
                    <span className="font-semibold">{bestWindowText}</span>
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
                              active ? "border-white/30 bg-white/10" : "border-white/10 bg-white/5 hover:bg-white/10",
                            ].join(" ")}
                          >
                            <div className="flex items-center gap-2">
                              <span>{dot}</span>
                              <span className="font-semibold">{d.dayLabel}</span>
                            </div>
                            <div className="mt-1 text-xs text-white/65">
                              {d.maxTemp ?? "—"}° / {d.minTemp ?? "—"}° · wind {d.windMax ?? "—"}k
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
                        <span className="text-white/50">(feels {weather?.current?.feels ?? "—"}°C)</span>
                      </span>
                    </div>
                    <div className="mt-2 flex justify-between gap-6">
                      <span className="text-white/60">Wind</span>
                      <span>
                        {weather?.current?.windKph ?? "—"} km/h{" "}
                        <span className="text-white/50">(gust {weather?.current?.gustKph ?? "—"})</span>
                      </span>
                    </div>
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

        {showCourses.length > 0 && (
          <section className="mt-8">
            <div className="flex items-end justify-between gap-6">
              <h2 className="text-xl font-semibold">Nearby courses</h2>
              <div className="text-sm text-white/60">{showVerdict === "RED" ? "Likely closed (try sims)" : "Tap to open in Maps"}</div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {showCourses.map((c: any) => (
                <a
                  key={c.placeId}
                  href={c.mapsUrl || "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="group rounded-3xl border border-white/10 bg-white/5 p-5 transition hover:bg-white/10"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold">{c.name}</div>
                      <div className="mt-1 line-clamp-2 text-sm text-white/65">{c.address ?? ""}</div>
                      <div className="mt-3 text-sm text-white/80">
                        {c.rating ? `⭐ ${c.rating} (${c.userRatingsTotal ?? 0})` : "No rating yet"}
                        {c.openNow === true ? " · Open now" : c.openNow === false ? " · Closed" : ""}
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

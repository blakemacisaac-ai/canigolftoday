"use client";

import { useMemo, useState } from "react";

type Coords = { lat: number; lon: number };

export default function HomePage() {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [geoErr, setGeoErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [weather, setWeather] = useState<any>(null);
  const [courses, setCourses] = useState<any>(null);
  const [simulators, setSimulators] = useState<any>(null);

  const verdictLabel = useMemo(() => {
    const v = weather?.golf?.verdict;
    if (!v) return null;
    if (v === "GREEN") return "✅ Green light";
    if (v === "YELLOW") return "🟡 Playable";
    return "🔴 Not great";
  }, [weather]);

  async function loadAll(c: Coords) {
    setLoading(true);
    setGeoErr(null);

    const [w, cs] = await Promise.all([
      fetch(`/api/weather?lat=${c.lat}&lon=${c.lon}`).then((r) => r.json()),
      fetch(`/api/courses?lat=${c.lat}&lon=${c.lon}`).then((r) => r.json()),
    ]);

    setWeather(w);
    setCourses(cs);

    // Only fetch simulators when verdict is RED
    if (w?.golf?.verdict === "RED") {
      const sims = await fetch(`/api/simulators?lat=${c.lat}&lon=${c.lon}`).then((r) =>
        r.json()
      );
      setSimulators(sims);
    } else {
      setSimulators(null);
    }

    setLoading(false);
  }

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

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-3xl font-bold tracking-tight">Can I Golf Today?</h1>
        <p className="mt-2 text-gray-600">
          We’ll check wind + rain + temp and suggest nearby courses.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            onClick={useMyLocation}
            className="rounded-xl bg-black px-4 py-2 text-white hover:opacity-90"
          >
            Use my location
          </button>

          {coords && (
            <div className="text-sm text-gray-600">
              Lat {coords.lat.toFixed(3)}, Lon {coords.lon.toFixed(3)}
            </div>
          )}
        </div>

        {geoErr && (
          <div className="mt-4 rounded-xl bg-red-50 p-3 text-red-700">{geoErr}</div>
        )}

        {loading && <div className="mt-6 text-gray-600">Loading…</div>}

        {weather?.golf && (
          <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xl font-semibold">{verdictLabel}</div>
                <div className="mt-1 text-sm text-gray-600">
                  Score: <span className="font-medium">{weather.golf.score}</span>/100 —{" "}
                  {weather.golf.reason}
                </div>

                {weather?.golf?.season === "WINTER" && weather?.golf?.verdict === "RED" && (
                  <div className="mt-1 text-xs text-gray-500">
                    Winter conditions — most courses are closed.
                  </div>
                )}
              </div>

              <div className="text-right text-sm text-gray-700">
                <div>
                  Temp: {weather.current?.temp ?? "—"}°C (feels{" "}
                  {weather.current?.feels ?? "—"}°C)
                </div>
                <div>
                  Wind: {weather.current?.windKph ?? "—"} km/h (gust{" "}
                  {weather.current?.gustKph ?? "—"})
                </div>
                {weather.current?.conditions && (
                  <div>Conditions: {weather.current.conditions}</div>
                )}
              </div>
            </div>
          </section>
        )}

        {courses?.courses?.length > 0 && (
          <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">
              Nearby courses
              {weather?.golf?.verdict === "RED" ? " (likely closed)" : ""}
            </h2>

            <div className="mt-3 grid gap-3">
              {courses.courses.map((c: any) => (
                <a
                  key={c.placeId}
                  href={c.mapsUrl || "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border border-gray-100 p-4 hover:bg-gray-50"
                >
                  <div className="font-semibold">{c.name}</div>
                  <div className="text-sm text-gray-600">{c.address ?? ""}</div>
                  <div className="mt-1 text-sm text-gray-700">
                    {c.rating ? `⭐ ${c.rating} (${c.userRatingsTotal ?? 0})` : "No rating yet"}
                    {c.openNow === true ? " · Open now" : c.openNow === false ? " · Closed" : ""}
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}

        {weather?.golf?.verdict === "RED" && simulators?.simulators?.length > 0 && (
          <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">Indoor golf / simulators nearby</h2>

            <div className="mt-3 grid gap-3">
              {simulators.simulators.map((s: any) => (
                <a
                  key={s.placeId}
                  href={s.mapsUrl || "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border border-gray-100 p-4 hover:bg-gray-50"
                >
                  <div className="font-semibold">{s.name}</div>
                  <div className="text-sm text-gray-600">{s.address ?? ""}</div>
                  <div className="mt-1 text-sm text-gray-700">
                    {s.rating ? `⭐ ${s.rating} (${s.userRatingsTotal ?? 0})` : "No rating yet"}
                    {s.openNow === true ? " · Open now" : s.openNow === false ? " · Closed" : ""}
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

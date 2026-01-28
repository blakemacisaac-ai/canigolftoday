export type GolfVerdict = "GREEN" | "YELLOW" | "RED";

type Season = "WINTER" | "SHOULDER" | "SUMMER";

export function golfabilityScore(opts: {
  tempC: number;
  feelsLikeC: number;
  windKph: number;
  gustKph?: number;
  pop: number; // 0..1
  precipMm?: number;
  hasAlert?: boolean;
  conditions?: string | null; // "Snow", "Rain", etc.

  // NEW: season awareness inputs
  lat?: number | null;        // from geolocation
  month?: number | null;      // 0..11 (JS month)
}) {
  const {
    tempC,
    feelsLikeC,
    windKph,
    gustKph = 0,
    pop,
    precipMm = 0,
    hasAlert = false,
    conditions = null,
    lat = null,
    month = null,
  } = opts;

  // --- Hard stops ---
  if (hasAlert) {
    return { score: 0, verdict: "RED" as GolfVerdict, reason: "Weather alert in effect" };
  }

  const isSnowy = conditions ? /snow/i.test(conditions) : false;
  const isStormy = conditions ? /thunderstorm/i.test(conditions) : false;

  if (isStormy) {
    return { score: 0, verdict: "RED" as GolfVerdict, reason: "Thunderstorms — hard no" };
  }

  // --- Season detection ---
  const season = inferSeason({ lat, month });

  // Tunable thresholds (these are the “Canada reality” knobs)
  const WINTER_MIN_FEELS_LIKE_C = 5;   // below this in winter = not playable
  const ABSOLUTE_MIN_FEELS_LIKE_C = -2; // always not playable

  // Absolute cold rule
  if (feelsLikeC <= ABSOLUTE_MIN_FEELS_LIKE_C) {
    return { score: 10, verdict: "RED" as GolfVerdict, reason: "Too cold to be playable" };
  }

  // Snow rule (always)
  if (isSnowy) {
    return { score: 15, verdict: "RED" as GolfVerdict, reason: "Snowing / winter conditions" };
  }

  // Winter clamp (season-aware)
  if (season === "WINTER" && feelsLikeC < WINTER_MIN_FEELS_LIKE_C) {
    return { score: 25, verdict: "RED" as GolfVerdict, reason: "Winter conditions — not golf weather" };
  }

  // --- Scoring ---
  let score = 100;

  // Precip risk (up to ~45)
  if (pop >= 0.8) score -= 40;
  else if (pop >= 0.6) score -= 30;
  else if (pop >= 0.4) score -= 18;
  else if (pop >= 0.2) score -= 8;

  if (precipMm >= 5) score -= 12;
  else if (precipMm >= 1) score -= 6;

  // Wind (up to ~30)
  const effectiveWind = Math.max(windKph, gustKph * 0.8);
  if (effectiveWind >= 50) score -= 28;
  else if (effectiveWind >= 40) score -= 22;
  else if (effectiveWind >= 30) score -= 14;
  else if (effectiveWind >= 20) score -= 8;
  else if (effectiveWind >= 15) score -= 3;

  // Temperature (heavier in shoulder/winter)
  const t = feelsLikeC ?? tempC;

  if (t < 0) score -= season === "SUMMER" ? 35 : 40;
  else if (t < 5) score -= season === "SUMMER" ? 25 : 30;
  else if (t < 10) score -= 10;
  else if (t > 32) score -= 18;

  score = Math.max(0, Math.min(100, Math.round(score)));

  let verdict: GolfVerdict = "GREEN";
  if (score < 55) verdict = "RED";
  else if (score < 80) verdict = "YELLOW";

  const reason =
    verdict === "GREEN"
      ? "Great golf weather"
      : verdict === "YELLOW"
        ? "Playable, but not perfect"
        : "Not really golf weather";

  return { score, verdict, reason, season };
}

// Season inference based on hemisphere + month
function inferSeason(opts: { lat: number | null; month: number | null }): Season {
  const { lat, month } = opts;
  if (month === null || month === undefined) return "SHOULDER";

  // Northern hemisphere default if we don’t know latitude
  const northern = lat === null || lat === undefined ? true : lat >= 0;

  // Meteorological seasons by month index (0=Jan)
  // Winter: Dec/Jan/Feb. Shoulder: Mar/Apr/May + Sep/Oct/Nov. Summer: Jun/Jul/Aug.
  const m = month;

  const winterMonthsNorth = new Set([11, 0, 1]);
  const summerMonthsNorth = new Set([5, 6, 7]);

  // Flip for southern hemisphere
  if (northern) {
    if (winterMonthsNorth.has(m)) return "WINTER";
    if (summerMonthsNorth.has(m)) return "SUMMER";
    return "SHOULDER";
  } else {
    // southern: winter is Jun/Jul/Aug, summer is Dec/Jan/Feb
    if (new Set([5, 6, 7]).has(m)) return "WINTER";
    if (new Set([11, 0, 1]).has(m)) return "SUMMER";
    return "SHOULDER";
  }
}

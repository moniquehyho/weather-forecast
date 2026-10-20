"use strict";

// ---------------------------------------------------------------------------
// Preferences and state
// ---------------------------------------------------------------------------

const DEFAULT_LOCATION = { name: "Guildford (Surrey)", lat: 51.2362, lon: -0.5704, tz: "Europe/London" };
const REFRESH_MS = 30 * 60 * 1000;

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`wx.${key}`);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    localStorage.setItem(`wx.${key}`, JSON.stringify(value));
  },
};

const state = {
  location: store.get("location", DEFAULT_LOCATION),
  recent: store.get("recent", []),
  tempUnit: store.get("tempUnit", "C"),
  windUnit: store.get("windUnit", "mph"),
  full: store.get("full", true),
  days: [],
  selected: 0,
  data: null,
  loadedAt: 0,
};

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const tz = () => state.location.tz || "Europe/London";
const fmt = (date, opts) => new Intl.DateTimeFormat("en-GB", { timeZone: tz(), ...opts }).format(date);
const dayKey = (date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz(), year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
const timeLabel = (date) => fmt(date, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const localHour = (date) => Number(fmt(date, { hour: "2-digit", hourCycle: "h23" }));
const keyToNoon = (key) => new Date(`${key}T12:00:00Z`);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const isNum = (v) => typeof v === "number" && !Number.isNaN(v);

function temp(c) {
  if (!isNum(c)) return "–";
  return `${Math.round(state.tempUnit === "F" ? (c * 9) / 5 + 32 : c)}°`;
}

const WIND_UNITS = {
  mph: { label: "mph", f: 2.23694 },
  kph: { label: "km/h", f: 3.6 },
  kt: { label: "knots", f: 1.94384 },
  ms: { label: "m/s", f: 1 },
  bft: { label: "Beaufort" },
};
const BEAUFORT = [0.5, 1.6, 3.4, 5.5, 8, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];

function wind(ms) {
  if (!isNum(ms)) return "–";
  if (state.windUnit === "bft") {
    const force = BEAUFORT.findIndex((t) => ms < t);
    return String(force === -1 ? 12 : force);
  }
  return String(Math.round(ms * WIND_UNITS[state.windUnit].f));
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const compass = (deg) => (isNum(deg) ? COMPASS[Math.round(deg / 22.5) % 16] : "");

const VISIBILITY = [
  [1000, "VP", "Very poor"],
  [4000, "P", "Poor"],
  [10000, "M", "Moderate"],
  [20000, "G", "Good"],
  [40000, "VG", "Very good"],
  [Infinity, "E", "Excellent"],
];
const visibility = (m) => (isNum(m) ? VISIBILITY.find(([limit]) => m < limit) : null);

function uvClass(uv) {
  if (!isNum(uv) || uv < 1) return "uv-0";
  if (uv <= 2) return "uv-low";
  if (uv <= 5) return "uv-mod";
  if (uv <= 7) return "uv-high";
  if (uv <= 10) return "uv-vhigh";
  return "uv-ext";
}
const UV_WORDS = { "uv-0": "None", "uv-low": "Low", "uv-mod": "Moderate", "uv-high": "High", "uv-vhigh": "Very high", "uv-ext": "Extreme" };

function popLabel(p) {
  if (!isNum(p)) return "–";
  if (p < 5) return "<5%";
  return `${Math.min(100, Math.max(10, Math.round(p / 10) * 10))}%`;
}

// Temperature colour scale (°C stops), similar in spirit to the old Met Office table.
const TEMP_STOPS = [
  [-10, [44, 62, 145]], [-5, [58, 98, 179]], [0, [91, 147, 214]], [5, [166, 207, 232]],
  [10, [233, 240, 196]], [15, [253, 224, 138]], [20, [251, 179, 94]], [25, [242, 121, 62]],
  [30, [217, 58, 43]], [35, [158, 27, 27]],
];
function tempColour(c) {
  if (!isNum(c)) return "";
  const t = Math.max(-10, Math.min(35, c));
  let i = TEMP_STOPS.findIndex(([v]) => v >= t);
  if (i <= 0) i = 1;
  const [v0, a] = TEMP_STOPS[i - 1];
  const [v1, b] = TEMP_STOPS[i];
  const k = (t - v0) / (v1 - v0);
  const rgb = a.map((x, j) => Math.round(x + (b[j] - x) * k));
  const text = c < -2 || c > 27 ? "#fff" : "#1d2733";
  return `background:rgb(${rgb.join(",")});color:${text}`;
}

// ---------------------------------------------------------------------------
// Sunrise / sunset (standard NOAA/SunCalc solar position formulas)
// ---------------------------------------------------------------------------

function sunTimes(date, lat, lon) {
  const rad = Math.PI / 180, dayMs = 86400000, J1970 = 2440588, J2000 = 2451545, J0 = 0.0009;
  const toDays = (d) => d.valueOf() / dayMs - 0.5 + J1970 - J2000;
  const fromJulian = (j) => new Date((j + 0.5 - J1970) * dayMs);
  const e = rad * 23.4397;
  const lw = rad * -lon, phi = rad * lat;
  const n = Math.round(toDays(date) - J0 - lw / (2 * Math.PI));
  const ds = J0 + lw / (2 * Math.PI) + n;
  const M = rad * (357.5291 + 0.98560028 * ds);
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + rad * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const transit = (a) => J2000 + a + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const Jnoon = transit(ds);
  const cosW = (Math.sin(-0.833 * rad) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosW < -1 || cosW > 1) return null; // polar day or night
  const w = Math.acos(cosW);
  const Jset = transit(J0 + (w + lw) / (2 * Math.PI) + n);
  return { rise: fromJulian(Jnoon - (Jset - Jnoon)), set: fromJulian(Jset) };
}

// ---------------------------------------------------------------------------
// Data processing
// ---------------------------------------------------------------------------

const timeSeries = (fc) => fc?.features?.[0]?.properties?.timeSeries ?? [];

function normalise(e, kind) {
  const hasRange = isNum(e.maxScreenAirTemp) && isNum(e.minScreenAirTemp);
  return {
    time: new Date(e.time),
    kind,
    code: e.significantWeatherCode,
    pop: e.probOfPrecipitation,
    temp: e.screenTemperature ?? (hasRange ? (e.maxScreenAirTemp + e.minScreenAirTemp) / 2 : null),
    feels: e.feelsLikeTemperature ?? e.feelsLikeTemp,
    wind: e.windSpeed10m,
    dir: e.windDirectionFrom10m,
    gust: e.windGustSpeed10m ?? e.max10mWindGust,
    vis: e.visibility,
    rh: e.screenRelativeHumidity,
    uv: e.uvIndex,
  };
}

const mostCommon = (arr) => {
  const counts = new Map();
  arr.forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};

function buildDays(data) {
  const hourStart = new Date();
  hourStart.setMinutes(0, 0, 0);

  const hourly = timeSeries(data.hourly).map((e) => normalise(e, "hourly")).filter((s) => s.time >= hourStart);
  const lastHourly = hourly.length ? hourly[hourly.length - 1].time : hourStart;
  const threeHourly = timeSeries(data["three-hourly"])
    .map((e) => normalise(e, "three-hourly"))
    .filter((s) => s.time > lastHourly);
  const steps = [...hourly, ...threeHourly];

  const daily = new Map(timeSeries(data.daily).map((d) => [d.time.slice(0, 10), d]));
  const now = new Date();
  const todayKey = dayKey(now);

  const grouped = new Map();
  for (const s of steps) {
    const k = dayKey(s.time);
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k).push(s);
  }

  return [...grouped.entries()].slice(0, 7).map(([key, daySteps]) => {
    const d = daily.get(key) || {};
    const isToday = key === todayKey;
    const evening = isToday && localHour(now) >= 18;
    const daytime = daySteps.filter((s) => localHour(s.time) >= 9 && localHour(s.time) < 18);
    const temps = daySteps.map((s) => s.temp).filter(isNum);
    const dayCode = d.daySignificantWeatherCode ?? mostCommon((daytime.length ? daytime : daySteps).map((s) => s.code));
    const nightCode = d.nightSignificantWeatherCode;

    let summary = weatherName(dayCode);
    if (evening && nightCode !== undefined) summary = weatherName(nightCode);
    else if (nightCode !== undefined && weatherName(nightCode) !== weatherName(dayCode)) {
      summary = `${weatherName(dayCode)} changing to ${weatherName(nightCode).toLowerCase()} by night`;
    }

    return {
      key,
      isToday,
      steps: daySteps,
      code: evening && nightCode !== undefined ? nightCode : dayCode,
      max: d.dayMaxScreenTemperature ?? (temps.length ? Math.max(...temps) : null),
      min: d.nightMinScreenTemperature ?? (temps.length ? Math.min(...temps) : null),
      uv: d.maxUvIndex ?? Math.max(0, ...daySteps.map((s) => s.uv).filter(isNum)),
      summary,
      sun: sunTimes(keyToNoon(key), state.location.lat, state.location.lon),
    };
  });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderTabs() {
  $("day-tabs").innerHTML = state.days
    .map((d, i) => {
      const noon = keyToNoon(d.key);
      const name = d.isToday ? "Today" : fmt(noon, { weekday: "short" });
      const date = fmt(noon, { weekday: d.isToday ? "short" : undefined, day: "numeric", month: "short" });
      const sun = d.sun
        ? `<div class="sun-times"><span title="Sunrise">↑ ${timeLabel(d.sun.rise)}</span><span title="Sunset">↓ ${timeLabel(d.sun.set)}</span></div>`
        : "";
      return `<button type="button" class="day-tab" role="tab" id="tab-${i}" aria-selected="${i === state.selected}"
          tabindex="${i === state.selected ? 0 : -1}" data-index="${i}">
        <span class="day-name">${name}</span>
        <span class="day-date">${date}</span>
        <span class="day-main">${weatherIcon(d.code, 44)}
          <span class="temps"><span class="tmax" title="Maximum">${temp(d.max)}</span>
          <span class="tmin" title="Minimum">${temp(d.min)}</span></span></span>
        <span class="day-summary">${escapeHtml(d.summary)}</span>
        ${sun}
        <span class="day-uv">UV: ${UV_WORDS[uvClass(d.uv)]}</span>
      </button>`;
    })
    .join("");
  $("day-tabs").setAttribute("role", "tablist");
}

function windCell(s) {
  if (!isNum(s.wind)) return "–";
  const toward = isNum(s.dir) ? (s.dir + 180) % 360 : 0;
  const arrow = isNum(s.dir)
    ? `<polygon points="19,0 14.5,8 23.5,8" fill="#163a66" transform="rotate(${toward} 19 19)"/>`
    : "";
  return `<span class="wind" title="${compass(s.dir)} ${wind(s.wind)} ${WIND_UNITS[state.windUnit].label}">
    <span class="wind-dial"><svg width="38" height="38" viewBox="0 0 38 38" aria-hidden="true">
      <circle cx="19" cy="19" r="13" fill="#fff" stroke="#9aa6b2" stroke-width="1.5"/>${arrow}</svg>
      <span>${wind(s.wind)}</span></span>
    <span class="wind-dir">${compass(s.dir)}</span></span>`;
}

function renderTable() {
  const day = state.days[state.selected];
  const table = $("hourly-table");
  if (!day) {
    table.innerHTML = "";
    return;
  }
  const now = Date.now();
  const unit = WIND_UNITS[state.windUnit].label;
  const rows = [
    {
      head: true,
      label: "Time",
      cell: (s) => {
        const span = s.kind === "hourly" ? 3600e3 : 3 * 3600e3;
        const isNow = s.time <= now && now < s.time.getTime() + span;
        return [isNow ? "Now" : timeLabel(s.time), isNow ? "now" : ""];
      },
    },
    { cls: "row-symbol", label: "Weather symbol", cell: (s) => [weatherIcon(s.code, 40)] },
    {
      cls: "row-pop",
      label: "Chance of precipitation",
      cell: (s) => [popLabel(s.pop), "", isNum(s.pop) ? `background:rgba(31,111,209,${((s.pop / 100) * 0.5).toFixed(2)})` : ""],
    },
    {
      cls: "row-temp",
      label: `Temperature <span class="unit">°${state.tempUnit}</span>`,
      cell: (s) => [temp(s.temp), "", tempColour(s.temp)],
    },
    { cls: "row-feels", label: `Feels like temperature <span class="unit">°${state.tempUnit}</span>`, cell: (s) => [temp(s.feels)] },
    { cls: "row-wind", label: `Wind direction and speed <span class="unit">(${unit})</span>`, cell: (s) => [windCell(s)] },
    { cls: "row-gust", label: `Wind gust <span class="unit">(${unit})</span>`, cell: (s) => [wind(s.gust)] },
    {
      cls: "row-vis extra",
      label: "Visibility",
      cell: (s) => {
        const v = visibility(s.vis);
        return [v ? `<span title="${v[2]}">${v[1]}</span>` : "–"];
      },
    },
    { cls: "row-rh extra", label: "Humidity", cell: (s) => [isNum(s.rh) ? `${Math.round(s.rh)}%` : "–"] },
    {
      cls: "row-uv extra",
      label: "UV",
      cell: (s) => [isNum(s.uv) ? `<span class="uv ${uvClass(s.uv)}" title="${UV_WORDS[uvClass(s.uv)]}">${s.uv}</span>` : "–"],
    },
  ];

  const rowHtml = (r) =>
    `<tr class="${r.cls || ""}"><th scope="row">${r.label}</th>${day.steps
      .map((s) => {
        const [html, cls = "", style = ""] = r.cell(s);
        return `<td class="${cls}" style="${style}">${html}</td>`;
      })
      .join("")}</tr>`;

  table.innerHTML = `<thead>${rowHtml(rows[0])}</thead><tbody>${rows.slice(1).map(rowHtml).join("")}</tbody>`;
  table.classList.toggle("full", state.full);

  const noon = keyToNoon(day.key);
  $("table-heading").textContent = `${day.isToday ? "Today" : fmt(noon, { weekday: "long" })} ${fmt(noon, {
    day: "numeric",
    month: "long",
  })}${day.steps[0]?.kind === "three-hourly" ? " · 3-hourly" : ""}`;

  $("table-scroll").scrollLeft = 0;
  updateScrollButtons();
}

function renderUpdated() {
  const run = state.data?.hourly?.features?.[0]?.properties?.modelRunDate;
  const when = run ? new Date(run) : new Date(state.data.fetchedAt);
  const zone = fmt(when, { timeZoneName: "short" }).split(" ").pop();
  $("updated").textContent =
    `Updated: ${timeLabel(when)} (${zone}) on ${fmt(when, { weekday: "short" })} ${fmt(when, { day: "numeric", month: "short", year: "numeric" })}` +
    (state.data.source === "sample" ? " · sample data" : " · Met Office DataHub");
}

function renderAll() {
  renderTabs();
  renderTable();
  renderUpdated();
  document.querySelectorAll("[data-temp-unit]").forEach((b) => b.classList.toggle("on", b.dataset.tempUnit === state.tempUnit));
  $("wind-unit").value = state.windUnit;
  $("full-forecast").checked = state.full;
}

function updateScrollButtons() {
  const el = $("table-scroll");
  $("scroll-left").disabled = el.scrollLeft <= 2;
  $("scroll-right").disabled = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
}

function showError(msg) {
  $("error").hidden = !msg;
  $("error").textContent = msg || "";
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

// On GitHub Pages there is no server, so the browser calls the Met Office directly with an API key
// saved on this device. Everywhere else (local server, Cloudflare) the server holds the key and may
// ask for a passcode instead. Add ?direct to the address to force direct mode (e.g. on a custom domain).
const DIRECT_MODE = location.hostname.endsWith(".github.io") || new URLSearchParams(location.search).has("direct");
const DATAHUB_BASE = "https://data.hub.api.metoffice.gov.uk/sitespecific/v0/point";
const PRODUCTS = ["hourly", "three-hourly", "daily"];
const DIRECT_CACHE_MS = 15 * 60 * 1000; // keeps us well inside the free 360 calls/day

const SECRET = DIRECT_MODE
  ? {
      storeKey: "apikey",
      title: "Enter your Met Office API key",
      prompt: "Paste your Met Office DataHub API key to see the forecast.",
      hint: "Copy it from datahub.metoffice.gov.uk. It's saved only in this browser, so you only need to do this once per device.",
      forget: "Forget API key on this device",
    }
  : {
      storeKey: "passcode",
      title: "Enter passcode",
      prompt: "Enter the passcode to see the forecast.",
      hint: "This device will remember it, so you only need to enter it once.",
      forget: "Forget passcode on this device",
    };

class NeedSecret extends Error {
  constructor(message, wrong) {
    super(message);
    this.wrong = wrong;
  }
}

async function fetchViaServer(loc) {
  const passcode = store.get("passcode", "");
  const res = await fetch(`/api/forecast?lat=${loc.lat}&lon=${loc.lon}`, {
    headers: passcode ? { "X-Passcode": passcode } : {},
  });
  const data = await res.json();
  if (res.status === 401 && data.needPasscode) throw new NeedSecret(data.error, Boolean(passcode));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function fetchDirect(loc) {
  const apiKey = store.get("apikey", "");
  if (!apiKey) throw new NeedSecret(SECRET.prompt, false);

  const cacheKey = `${(+loc.lat).toFixed(3)},${(+loc.lon).toFixed(3)}`;
  const cached = store.get("cache", null);
  if (cached && cached.key === cacheKey && Date.now() - cached.at < DIRECT_CACHE_MS) return cached.data;

  const query = new URLSearchParams({
    latitude: (+loc.lat).toFixed(4),
    longitude: (+loc.lon).toFixed(4),
    includeLocationName: "true",
    excludeParameterMetadata: "true",
  });
  let responses;
  try {
    responses = await Promise.all(
      PRODUCTS.map((p) => fetch(`${DATAHUB_BASE}/${p}?${query}`, { headers: { apikey: apiKey, accept: "application/json" } }))
    );
  } catch {
    throw new Error("Could not reach the Met Office API. Check your internet connection.");
  }
  for (const [i, res] of responses.entries()) {
    if (res.status === 401 || res.status === 403) {
      throw new NeedSecret("The Met Office rejected that key. Check it's subscribed to Site Specific (Global Spot) and paste it again.", true);
    }
    if (res.status === 429) throw new Error("Met Office daily call limit reached. The forecast will be available again tomorrow.");
    if (!res.ok) throw new Error(`Met Office API returned HTTP ${res.status} for the ${PRODUCTS[i]} forecast.`);
  }
  const [hourly, threeHourly, daily] = await Promise.all(responses.map((r) => r.json()));
  const data = { source: "datahub", fetchedAt: new Date().toISOString(), hourly, "three-hourly": threeHourly, daily };
  try {
    store.set("cache", { key: cacheKey, at: Date.now(), data });
  } catch {
    // Storage full: skip caching, the forecast still shows.
  }
  return data;
}

async function loadForecast() {
  const loc = state.location;
  $("location-title").textContent = `${loc.name || "Your location"} weather`;
  document.title = `${loc.name || "Your location"} weather`;
  showError("");
  if (!state.data) $("hourly-table").innerHTML = `<tbody><tr><td class="loading">Loading forecast…</td></tr></tbody>`;

  try {
    const data = await (DIRECT_MODE ? fetchDirect(loc) : fetchViaServer(loc));
    $("forget-secret").hidden = !store.get(SECRET.storeKey, "");
    state.data = data;
    state.loadedAt = Date.now();
    $("sample-banner").hidden = data.source !== "sample";

    if (!loc.name) {
      const apiName = data.hourly?.features?.[0]?.properties?.location?.name;
      loc.name = apiName ? titleCase(apiName) : "Your location";
      store.set("location", loc);
      $("location-title").textContent = `${loc.name} weather`;
      document.title = `${loc.name} weather`;
    }

    state.days = buildDays(data);
    state.selected = Math.min(state.selected, Math.max(0, state.days.length - 1));
    renderAll();
  } catch (err) {
    if (!state.data) $("hourly-table").innerHTML = "";
    if (err instanceof NeedSecret) return askSecret(err.message, err.wrong);
    showError(`Couldn't load the forecast: ${err.message}`);
  }
}

const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

function askSecret(message, wasWrong) {
  const msg = $("secret-message");
  msg.textContent = message;
  msg.classList.toggle("bad", wasWrong);
  $("secret-input").value = "";
  if (!$("secret-dialog").open) $("secret-dialog").showModal();
  $("secret-input").focus();
}

function initSecret() {
  $("secret-title").textContent = SECRET.title;
  $("secret-hint").textContent = SECRET.hint;
  $("forget-secret").textContent = SECRET.forget;
  $("secret-form").addEventListener("submit", (e) => {
    e.preventDefault();
    // API keys are long and often pick up line breaks when pasted from notes, so strip all whitespace.
    const raw = $("secret-input").value;
    const value = DIRECT_MODE ? raw.replace(/\s+/g, "") : raw.trim();
    if (!value) return;
    store.set(SECRET.storeKey, value);
    localStorage.removeItem("wx.cache");
    $("secret-dialog").close();
    loadForecast();
  });
  // The forecast can't load without it, so don't let Escape dismiss the prompt.
  $("secret-dialog").addEventListener("cancel", (e) => e.preventDefault());
  $("forget-secret").addEventListener("click", () => {
    localStorage.removeItem(`wx.${SECRET.storeKey}`);
    localStorage.removeItem("wx.cache");
    location.reload();
  });
}

function setLocation(loc) {
  state.location = loc;
  state.selected = 0;
  state.data = null;
  store.set("location", loc);
  if (loc.name) {
    state.recent = [loc, ...state.recent.filter((r) => r.name !== loc.name)].slice(0, 5);
    store.set("recent", state.recent);
  }
  loadForecast();
}

// ---------------------------------------------------------------------------
// Place search (Open-Meteo geocoding + postcodes.io for UK postcodes)
// ---------------------------------------------------------------------------

const POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
const OUTCODE = /^[A-Z]{1,2}\d[A-Z\d]?$/i;
let searchTimer = null;
let searchSeq = 0;
let searchItems = [];
let activeItem = -1;

async function searchPlaces(q) {
  const tasks = [];
  if (POSTCODE.test(q)) {
    tasks.push(
      fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((j) =>
          j.result
            ? [{ name: `${j.result.postcode} (${j.result.admin_district})`, lat: j.result.latitude, lon: j.result.longitude, tz: "Europe/London", detail: "Postcode" }]
            : []
        )
    );
  } else {
    if (OUTCODE.test(q)) {
      tasks.push(
        fetch(`https://api.postcodes.io/outcodes/${encodeURIComponent(q)}`)
          .then((r) => r.json())
          .then((j) =>
            j.result
              ? [{ name: `${j.result.outcode} (${(j.result.admin_district || [])[0] || "UK"})`, lat: j.result.latitude, lon: j.result.longitude, tz: "Europe/London", detail: "Postcode area" }]
              : []
          )
      );
    }
    tasks.push(
      fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=10&language=en&format=json`)
        .then((r) => r.json())
        .then((j) =>
          (j.results || [])
            .sort((a, b) => (b.country_code === "GB") - (a.country_code === "GB"))
            .map((p) => {
              const area = p.admin2 || p.admin1;
              const uk = p.country_code === "GB";
              return {
                name: uk && area && area !== p.name ? `${p.name} (${area})` : p.name,
                lat: p.latitude,
                lon: p.longitude,
                tz: p.timezone || "Europe/London",
                detail: uk ? p.admin1 || "United Kingdom" : [p.admin1, p.country].filter(Boolean).join(", "),
              };
            })
        )
    );
  }
  const settled = await Promise.allSettled(tasks);
  return settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
}

function renderResults(groups) {
  const box = $("search-results");
  searchItems = [];
  activeItem = -1;
  let html = $("search-extras").innerHTML;
  for (const [title, items, emptyText] of groups) {
    if (!items.length && !emptyText) continue;
    html += `<div class="search-group">${title}</div>`;
    if (!items.length) html += `<div class="search-empty">${emptyText}</div>`;
    for (const item of items) {
      html += `<button type="button" class="search-item" role="option" data-i="${searchItems.length}">
        ${escapeHtml(item.name)}${item.detail ? `<small>${escapeHtml(item.detail)}</small>` : ""}</button>`;
      searchItems.push(item);
    }
  }
  box.innerHTML = html;
  box.hidden = false;
}

function showRecent() {
  renderResults([["Recent places", state.recent.filter((r) => r.name !== state.location.name)]]);
}

function closeResults() {
  $("search-results").hidden = true;
  activeItem = -1;
}

function chooseItem(i) {
  const item = searchItems[i];
  if (!item) return;
  closeResults();
  $("search-input").value = "";
  $("search-input").blur();
  setLocation({ name: item.name, lat: item.lat, lon: item.lon, tz: item.tz });
}

function useMyLocation() {
  closeResults();
  if (!navigator.geolocation) return showError("Your browser doesn't support location lookup.");
  navigator.geolocation.getCurrentPosition(
    (pos) =>
      setLocation({
        name: null,
        lat: +pos.coords.latitude.toFixed(4),
        lon: +pos.coords.longitude.toFixed(4),
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    (err) => showError(`Couldn't get your location: ${err.message}`),
    { timeout: 10000, maximumAge: 600000 }
  );
}

function initSearch() {
  const input = $("search-input");
  const box = $("search-results");

  input.addEventListener("focus", () => {
    if (!input.value.trim()) showRecent();
  });
  input.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (q.length < 2) return showRecent();
    searchTimer = setTimeout(async () => {
      const seq = ++searchSeq;
      const results = await searchPlaces(q);
      if (seq === searchSeq && input.value.trim() === q) renderResults([["Places", results, "No matching places found"]]);
    }, 250);
  });
  input.addEventListener("keydown", (e) => {
    const buttons = [...box.querySelectorAll(".search-item[data-i]")];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!buttons.length) return;
      e.preventDefault();
      activeItem = (activeItem + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons.forEach((b, i) => b.classList.toggle("active", i === activeItem));
      buttons[activeItem].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      chooseItem(activeItem >= 0 ? activeItem : 0);
    } else if (e.key === "Escape") {
      closeResults();
    }
  });
  box.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus so blur doesn't close first
  box.addEventListener("click", (e) => {
    const btn = e.target.closest(".search-item");
    if (!btn) return;
    if (btn.dataset.action === "locate") useMyLocation();
    else chooseItem(Number(btn.dataset.i));
  });
  input.addEventListener("blur", () => setTimeout(closeResults, 100));
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function selectDay(i, focus = false) {
  if (i < 0 || i >= state.days.length) return;
  state.selected = i;
  document.querySelectorAll(".day-tab").forEach((t, j) => {
    t.setAttribute("aria-selected", j === i);
    t.tabIndex = j === i ? 0 : -1;
  });
  if (focus) $(`tab-${i}`).focus();
  renderTable();
}

function initControls() {
  $("day-tabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".day-tab");
    if (tab) selectDay(Number(tab.dataset.index));
  });
  $("day-tabs").addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") selectDay(state.selected + 1, true);
    if (e.key === "ArrowLeft") selectDay(state.selected - 1, true);
  });

  document.querySelectorAll("[data-temp-unit]").forEach((b) =>
    b.addEventListener("click", () => {
      state.tempUnit = b.dataset.tempUnit;
      store.set("tempUnit", state.tempUnit);
      renderAll();
    })
  );
  $("wind-unit").addEventListener("change", (e) => {
    state.windUnit = e.target.value;
    store.set("windUnit", state.windUnit);
    renderTable();
  });
  $("full-forecast").addEventListener("change", (e) => {
    state.full = e.target.checked;
    store.set("full", state.full);
    $("hourly-table").classList.toggle("full", state.full);
  });

  const scroller = $("table-scroll");
  const step = () => Math.max(200, scroller.clientWidth - 240);
  $("scroll-left").addEventListener("click", () => scroller.scrollBy({ left: -step() }));
  $("scroll-right").addEventListener("click", () => scroller.scrollBy({ left: step() }));
  scroller.addEventListener("scroll", updateScrollButtons, { passive: true });
  window.addEventListener("resize", updateScrollButtons);

  // Keep the forecast fresh; the server caches upstream calls for 15 minutes.
  setInterval(() => document.visibilityState === "visible" && loadForecast(), REFRESH_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - state.loadedAt > REFRESH_MS) loadForecast();
  });
}

initSearch();
initControls();
initSecret();
loadForecast();

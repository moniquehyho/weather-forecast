// Weather symbols for Met Office significant weather codes, drawn as inline SVG.

const WEATHER_TYPES = {
  "-1": { name: "Trace rain", sky: null, cloud: "light", precip: "trace" },
  0: { name: "Clear night", sky: "moon", cloud: null },
  1: { name: "Sunny day", sky: "sun", cloud: null },
  2: { name: "Partly cloudy", sky: "moon", cloud: "light" },
  3: { name: "Sunny intervals", sky: "sun", cloud: "light" },
  4: { name: "Dust", sky: null, cloud: null, fog: "mist" },
  5: { name: "Mist", sky: null, cloud: null, fog: "mist" },
  6: { name: "Fog", sky: null, cloud: null, fog: "fog" },
  7: { name: "Cloudy", sky: null, cloud: "light" },
  8: { name: "Overcast", sky: null, cloud: "dark" },
  9: { name: "Light shower", sky: "moon", cloud: "light", precip: "light" },
  10: { name: "Light shower", sky: "sun", cloud: "light", precip: "light" },
  11: { name: "Drizzle", sky: null, cloud: "grey", precip: "drizzle" },
  12: { name: "Light rain", sky: null, cloud: "grey", precip: "light" },
  13: { name: "Heavy shower", sky: "moon", cloud: "dark", precip: "heavy" },
  14: { name: "Heavy shower", sky: "sun", cloud: "dark", precip: "heavy" },
  15: { name: "Heavy rain", sky: null, cloud: "dark", precip: "heavy" },
  16: { name: "Sleet shower", sky: "moon", cloud: "grey", precip: "sleet" },
  17: { name: "Sleet shower", sky: "sun", cloud: "grey", precip: "sleet" },
  18: { name: "Sleet", sky: null, cloud: "grey", precip: "sleet" },
  19: { name: "Hail shower", sky: "moon", cloud: "grey", precip: "hail" },
  20: { name: "Hail shower", sky: "sun", cloud: "grey", precip: "hail" },
  21: { name: "Hail", sky: null, cloud: "grey", precip: "hail" },
  22: { name: "Light snow shower", sky: "moon", cloud: "light", precip: "snow" },
  23: { name: "Light snow shower", sky: "sun", cloud: "light", precip: "snow" },
  24: { name: "Light snow", sky: null, cloud: "grey", precip: "snow" },
  25: { name: "Heavy snow shower", sky: "moon", cloud: "grey", precip: "heavysnow" },
  26: { name: "Heavy snow shower", sky: "sun", cloud: "grey", precip: "heavysnow" },
  27: { name: "Heavy snow", sky: null, cloud: "dark", precip: "heavysnow" },
  28: { name: "Thundery shower", sky: "moon", cloud: "dark", precip: "thunder" },
  29: { name: "Thundery shower", sky: "sun", cloud: "dark", precip: "thunder" },
  30: { name: "Thunder", sky: null, cloud: "dark", precip: "thunder" },
};

const CLOUD_STYLE = {
  light: { fill: "#ffffff", stroke: "#8f9ba8" },
  grey: { fill: "#c9d0d7", stroke: "#7d8995" },
  dark: { fill: "#7c8792", stroke: "#56606a" },
};

const CLOUD_PATH = "M16,46 A8,8 0 0 1 17,30 A12,12 0 0 1 39,25 A10,10 0 0 1 50,46 Z";

function sunSvg(cx, cy, r) {
  let rays = "";
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const x1 = cx + Math.cos(a) * (r + 3), y1 = cy + Math.sin(a) * (r + 3);
    const x2 = cx + Math.cos(a) * (r + 8), y2 = cy + Math.sin(a) * (r + 8);
    rays += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
  }
  return `<g stroke="#f5a300" stroke-width="3" stroke-linecap="round">${rays}</g>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffc400" stroke="#f5a300" stroke-width="2"/>`;
}

function moonSvg(cx, cy, r) {
  // Crescent: a disc with an offset bite taken out of it.
  const id = `m${Math.random().toString(36).slice(2, 8)}`;
  return `<mask id="${id}"><rect width="64" height="64" fill="#fff"/>
      <circle cx="${cx + r * 0.6}" cy="${cy - r * 0.45}" r="${r * 0.85}" fill="#000"/></mask>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#e9e3c3" stroke="#a69f7b" stroke-width="2" mask="url(#${id})"/>`;
}

function cloudSvg(style, transform = "") {
  const s = CLOUD_STYLE[style];
  return `<path d="${CLOUD_PATH}" fill="${s.fill}" stroke="${s.stroke}" stroke-width="2.2"
    stroke-linejoin="round" transform="${transform}"/>`;
}

function drops(xs, len, width) {
  return xs
    .map(([x, y]) => `<line x1="${x}" y1="${y}" x2="${x - len * 0.35}" y2="${y + len}" />`)
    .join("")
    .replace(/^/, `<g stroke="#1f6fd1" stroke-width="${width}" stroke-linecap="round">`) + "</g>";
}

function flakes(points, r) {
  return points
    .map(([x, y]) => {
      let arms = "";
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI) / 3;
        arms += `<line x1="${(x - Math.cos(a) * r).toFixed(1)}" y1="${(y - Math.sin(a) * r).toFixed(1)}"
          x2="${(x + Math.cos(a) * r).toFixed(1)}" y2="${(y + Math.sin(a) * r).toFixed(1)}"/>`;
      }
      return arms;
    })
    .join("")
    .replace(/^/, `<g stroke="#5a8fc9" stroke-width="2" stroke-linecap="round">`) + "</g>";
}

function hailstones(points) {
  return points
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.8" fill="#fff" stroke="#6b7a89" stroke-width="1.5"/>`)
    .join("");
}

function precipSvg(kind) {
  switch (kind) {
    case "trace":
      return drops([[33, 51]], 5, 2.5);
    case "drizzle":
      return drops([[24, 51], [32, 53], [40, 51]], 4, 2.5);
    case "light":
      return drops([[27, 50], [39, 50]], 8, 3);
    case "heavy":
      return drops([[22, 50], [32, 50], [42, 50]], 10, 3.4);
    case "sleet":
      return drops([[26, 50]], 8, 3) + flakes([[39, 55]], 4.2);
    case "hail":
      return hailstones([[24, 53], [34, 57], [43, 52]]);
    case "snow":
      return flakes([[26, 55], [40, 55]], 4.2);
    case "heavysnow":
      return flakes([[21, 54], [33, 58], [45, 54]], 4.4);
    case "thunder":
      return `<polygon points="34,44 25,56 32,56 28,64 41,50 34,50 38,44" fill="#ffd21f" stroke="#c99a00"
        stroke-width="1.4" stroke-linejoin="round"/>` + drops([[20, 50], [46, 50]], 7, 3);
    default:
      return "";
  }
}

function fogSvg(kind, hasCloud) {
  const ys = kind === "fog" ? [26, 34, 42, 50] : [30, 40, 50];
  const top = hasCloud ? 52 : 0;
  return `<g stroke="#9aa4ae" stroke-width="3.4" stroke-linecap="round">${ys
    .map((y, i) => `<line x1="${12 + (i % 2) * 4}" y1="${y + top}" x2="${52 - (i % 2) * 4}" y2="${y + top}"/>`)
    .join("")}</g>`;
}

function weatherIcon(code, size = 48) {
  const t = WEATHER_TYPES[code];
  const label = t ? t.name : "Not available";
  if (!t) {
    return `<svg class="wx-icon" width="${size}" height="${size}" viewBox="0 0 64 64" role="img"
      aria-label="${label}"><text x="32" y="38" text-anchor="middle" font-size="16" fill="#888">–</text></svg>`;
  }
  let body = "";
  const raised = t.precip ? "translate(0,-6)" : "";
  if (t.sky && t.cloud) {
    body += t.sky === "sun" ? sunSvg(24, 22, 10) : moonSvg(24, 22, 11);
    body += cloudSvg(t.cloud, `translate(6,${t.precip ? -2 : 4}) scale(0.92)`);
  } else if (t.sky) {
    body += t.sky === "sun" ? sunSvg(32, 32, 13) : moonSvg(32, 32, 15);
  } else if (t.cloud) {
    body += cloudSvg(t.cloud, raised);
  }
  if (t.precip) body += precipSvg(t.precip);
  if (t.fog) body += fogSvg(t.fog, false);
  return `<svg class="wx-icon" width="${size}" height="${size}" viewBox="0 0 64 64" role="img"
    aria-label="${label}"><title>${label}</title>${body}</svg>`;
}

function weatherName(code) {
  return WEATHER_TYPES[code] ? WEATHER_TYPES[code].name : "Not available";
}

/**
 * pattern-card
 * -----------------------------------------------------------------------------
 * Muster einer Entity über einen wählbaren Zeitraum:
 *
 *   mode: graph    Tagesverlauf heute gegen einen Referenzzeitraum
 *                  (Mittelwert-Linie plus Band), gezeichnet mit ha-chart-base
 *   mode: heatmap  Wochentag × Uhrzeit, eigenes Raster
 *
 * Daten aus der Langzeitstatistik, wo es sie gibt (Messwerte, Zähler),
 * sonst aus dem Verlauf (Zustände, numerische Sensoren ohne Statistik).
 * Spezifikation: SPEC.md
 *
 * Lizenz: MIT
 */

const CARD_VERSION = "0.7.3";

console.info(
  `%c PATTERN-CARD %c ${CARD_VERSION} `,
  "color:#fff;background:#03a9f4;font-weight:700;border-radius:3px 0 0 3px",
  "color:#03a9f4;background:#efefef;font-weight:700;border-radius:0 3px 3px 0"
);

/* --------------------------------------------------------------------------
 * Konstanten
 * ------------------------------------------------------------------------ */

const DAY_MS = 864e5;
const MIN_MS = 6e4;
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const RESOLUTIONS = { "5min": 5, "15min": 15, "30min": 30, hour: 60 };
const DEFAULT_DAYS = 28;
const MIN_DAYS_IQR = 4;
const MIN_DAYS_WIDE = 10; // darunter schwanken 10 %/90 % stark und liegen nahe Min/Max
const BAND_MODES = ["both", "iqr", "wide", "minmax", "none"];
const TODAY_REFRESH_MS = 5 * MIN_MS;
const STATE_REFRESH_THROTTLE_MS = 30 * 1000;
const REF_SETTLE_MS = 15 * MIN_MS; // Stundenstatistik des Vortags ist erst nach Mitternacht vollständig
const CHART_LOAD_TIMEOUT_MS = 10000;

// wie TIMESTAMP_STATE_DOMAINS im Frontend: Zustand ist ein Zeitstempel
const TIMESTAMP_DOMAINS = new Set(["button", "event", "input_button", "scene"]);
const UNKNOWN_STATES = new Set(["unavailable", "unknown"]);
const NUMERIC_DOMAINS = new Set(["sensor", "number", "input_number", "counter"]);

// wie THEME_COLORS im Frontend (ui_color-Selektor)
const THEME_COLORS = new Set([
  "primary", "accent", "disabled", "red", "pink", "purple", "deep-purple", "indigo", "blue",
  "light-blue", "cyan", "teal", "green", "light-green", "lime", "yellow", "amber", "orange",
  "deep-orange", "brown", "light-grey", "grey", "dark-grey", "blue-grey", "black", "white",
]);

const STATISTICS_BY_KIND = {
  state: ["active", "events"],
  timestamp: ["events"],
  measurement: ["mean"],
  numeric: ["mean"],
  counter: ["sum"],
  unsupported: [],
};

/* --------------------------------------------------------------------------
 * Übersetzungen
 * ------------------------------------------------------------------------ */

const I18N = {
  en: {
    today: "Today",
    ref_reference: "Reference (avg)",
    history: "History",
    band_iqr: "Range 25–75 %",
    band_wide: "Range 10–90 %",
    band_both: "Ranges 25–75 % and 10–90 %",
    band_minmax: "Range min–max",
    band_none: "No band",
    wide_needs_days: "10–90 % range from {n} days on",
    days_n: "{n} days",
    days_of: "data from {n} of {total} days",
    avg_of_days: "avg of {n} days",
    loading: "Loading data …",
    no_data: "No data in this period",
    entity_missing: "Entity not available: {id}",
    unsupported: "Circular mean statistics (e.g. wind direction) are not supported",
    chart_unavailable: "Home Assistant's chart component could not be loaded",
    coarse: "hourly (finer statistics do not reach back far enough)",
    events_unit: "events",
    stat_active: "Share active",
    stat_events: "Events",
    stat_mean: "Mean",
    stat_sum: "Consumption",
    stat_sum_cumulative: "Consumption since midnight",
    ref_workday: "Workdays (avg)",
    ref_weekend: "Weekend (avg)",
    group_workday: "Workdays",
    group_weekend: "Weekend",
    band_group: "Range {group}",
    days_short: "{n} days",
    diff_label: "Weekend − workdays",
    more_workday: "more on workdays",
    more_weekend: "more at weekends",
    group_before: "Before {date}",
    group_after: "Since {date}",
    ref_group: "{group} (avg)",
    diff_label_before_after: "After − before",
    more_before: "more before",
    more_after: "more after",
    // Editor
    entity: "Entity",
    mode: "Display",
    mode_graph: "Graph (today vs. reference)",
    mode_heatmap: "Heatmap (weekday × time of day)",
    name: "Name",
    days: "Reference period (days)",
    weekdays: "Weekdays",
    statistic: "Value",
    resolution: "Resolution",
    res_auto: "Automatic",
    res_5min: "5 minutes",
    res_15min: "15 minutes",
    res_30min: "30 minutes",
    res_hour: "1 hour",
    band: "Band",
    cumulative: "Cumulative since midnight",
    color: "Color",
    min: "Scale minimum",
    max: "Scale maximum",
    helper_days: "Completed days before today",
    helper_resolution: "Automatic: graph 15 min where data allows, heatmap 1 h",
    compare: "Comparison",
    compare_none: "None",
    compare_weekday_weekend: "Workdays vs. weekend",
    compare_before_after: "Before vs. after a date",
    since: "Date of the change",
    helper_since: "Days from this date on count as “after”",
    reference: "Reference days",
    reference_auto: "Same kind of day as today",
    reference_all: "All days",
    helper_reference: "Only applies without your own selection of weekdays",
    difference: "Difference row (weekend − workdays)",
    hide_legend: "Hide legend",
    hide_subtitle: "Hide subtitle (period and hints)",
    color_of: "Color {group}",
    color_of_hint_graph: "line and band",
    color_less: "Difference row: color for less",
    color_more: "Difference row: color for more",
    group_before_short: "before",
    group_after_short: "after",
  },
  de: {
    today: "Heute",
    ref_reference: "Referenz (Ø)",
    history: "Verlauf",
    band_iqr: "Spanne 25–75 %",
    band_wide: "Spanne 10–90 %",
    band_both: "Spannen 25–75 % und 10–90 %",
    band_minmax: "Spanne Min–Max",
    band_none: "Kein Band",
    wide_needs_days: "Spanne 10–90 % ab {n} Tagen",
    days_n: "{n} Tage",
    days_of: "Daten aus {n} von {total} Tagen",
    avg_of_days: "Ø aus {n} Tagen",
    loading: "Lade Daten …",
    no_data: "Keine Daten im Zeitraum",
    entity_missing: "Entity nicht verfügbar: {id}",
    unsupported: "Kreismittel (z. B. Windrichtung) wird nicht unterstützt",
    chart_unavailable: "Die Diagramm-Komponente von Home Assistant ließ sich nicht laden",
    coarse: "stündlich (feinere Statistik reicht nicht so weit zurück)",
    events_unit: "Ereignisse",
    stat_active: "Anteil aktiv",
    stat_events: "Ereignisse",
    stat_mean: "Mittelwert",
    stat_sum: "Verbrauch",
    stat_sum_cumulative: "Verbrauch seit Mitternacht",
    ref_workday: "Werktage (Ø)",
    ref_weekend: "Wochenende (Ø)",
    group_workday: "Werktage",
    group_weekend: "Wochenende",
    band_group: "Spanne {group}",
    days_short: "{n} Tage",
    diff_label: "Wochenende − Werktage",
    more_workday: "mehr an Werktagen",
    more_weekend: "mehr am Wochenende",
    group_before: "Vor {date}",
    group_after: "Ab {date}",
    ref_group: "{group} (Ø)",
    diff_label_before_after: "Nachher − Vorher",
    more_before: "mehr vorher",
    more_after: "mehr nachher",
    entity: "Entity",
    mode: "Darstellung",
    mode_graph: "Verlauf (heute gegen Referenz)",
    mode_heatmap: "Heatmap (Wochentag × Uhrzeit)",
    name: "Name",
    days: "Referenzzeitraum (Tage)",
    weekdays: "Wochentage",
    statistic: "Wert",
    resolution: "Auflösung",
    res_auto: "Automatisch",
    res_5min: "5 Minuten",
    res_15min: "15 Minuten",
    res_30min: "30 Minuten",
    res_hour: "1 Stunde",
    band: "Band",
    cumulative: "Kumuliert ab Mitternacht",
    color: "Farbe",
    min: "Skala Minimum",
    max: "Skala Maximum",
    helper_days: "Abgeschlossene Tage vor heute",
    helper_resolution: "Automatisch: Verlauf 15 min, wo die Daten es hergeben, Heatmap 1 h",
    compare: "Vergleich",
    compare_none: "Kein Vergleich",
    compare_weekday_weekend: "Werktage gegen Wochenende",
    compare_before_after: "Vorher gegen nachher (Stichtag)",
    since: "Stichtag der Änderung",
    helper_since: "Tage ab diesem Datum zählen als „nachher“",
    reference: "Referenztage",
    reference_auto: "Tage derselben Art wie heute",
    reference_all: "Alle Tage",
    helper_reference: "Gilt nur ohne eigene Auswahl der Wochentage",
    difference: "Differenzzeile (Wochenende − Werktage)",
    hide_legend: "Legende ausblenden",
    hide_subtitle: "Untertitel ausblenden (Zeitraum und Hinweise)",
    color_of: "Farbe {group}",
    color_of_hint_graph: "Linie und Band",
    color_less: "Differenzzeile: Farbe für weniger",
    color_more: "Differenzzeile: Farbe für mehr",
    group_before_short: "vorher",
    group_after_short: "nachher",
  },
};

const langOf = (hass) => {
  const l = (hass?.locale?.language || hass?.language || "en").split("-")[0];
  return I18N[l] ? l : "en";
};

const translate = (hass, key, vars = {}) => {
  const s = I18N[langOf(hass)][key] ?? I18N.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));
};

/* --------------------------------------------------------------------------
 * Allgemeine Hilfen
 * ------------------------------------------------------------------------ */

const escapeHtml = (v) =>
  String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const domainOf = (entityId) => String(entityId).split(".")[0];

/** wie stateActive im Frontend (src/common/entity/state_active.ts) */
const stateActive = (domain, s) => {
  if (TIMESTAMP_DOMAINS.has(domain)) return s !== "unavailable";
  if (UNKNOWN_STATES.has(s)) return false;
  if (s === "off" && domain !== "alert") return false;
  switch (domain) {
    case "alarm_control_panel": return s !== "disarmed";
    case "alert": return s !== "idle";
    case "cover": return s !== "closed";
    case "device_tracker":
    case "person": return s !== "not_home";
    case "lawn_mower": return !["docked", "paused", "idle"].includes(s);
    case "lock": return s !== "locked";
    case "media_player": return s !== "standby";
    case "vacuum": return !["idle", "docked", "paused"].includes(s);
    case "valve": return s !== "closed";
    case "plant": return s === "problem";
    case "group": return ["on", "home", "open", "locked", "problem"].includes(s);
    case "timer": return s === "active";
    case "camera": return ["streaming", "recording"].includes(s);
    default: return true;
  }
};

/** Art der Entity aus Zustand und Statistik-Metadaten */
const detectKind = (stateObj, meta) => {
  const domain = domainOf(stateObj.entity_id);
  if (TIMESTAMP_DOMAINS.has(domain)) return "timestamp";
  if (meta) {
    const meanType = meta.mean_type ?? (meta.has_mean ? 1 : 0);
    if (meta.has_sum) return "counter";
    if (meanType === 2) return "unsupported";
    if (meanType === 1) return "measurement";
  }
  if (NUMERIC_DOMAINS.has(domain)) {
    const a = stateObj.attributes || {};
    if (a.unit_of_measurement !== undefined || a.state_class !== undefined) return "numeric";
    if (stateObj.state !== "" && Number.isFinite(Number(stateObj.state))) return "numeric";
  }
  return "state";
};

/** Art nur aus dem Zustand (Editor, ohne Metadaten) */
const guessKind = (stateObj) => {
  if (!stateObj) return "state";
  const sc = stateObj.attributes?.state_class;
  if (sc === "total" || sc === "total_increasing") return "counter";
  if (sc === "measurement") return "measurement";
  return detectKind(stateObj, null);
};

const resolveStatistic = (wanted, kind) => {
  const allowed = STATISTICS_BY_KIND[kind] || [];
  return allowed.includes(wanted) ? wanted : allowed[0];
};

const timeZoneOf = (hass) => {
  const server = hass?.config?.time_zone;
  let local;
  try { local = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { local = undefined; }
  return hass?.locale?.time_zone === "local" ? local || server || "UTC" : server || local || "UTC";
};

const selectedWeekdays = (cfg) => {
  const list = Array.isArray(cfg.weekdays) && cfg.weekdays.length ? cfg.weekdays : WEEKDAYS;
  return new Set(list.map((w) => WEEKDAYS.indexOf(String(w).toLowerCase())).filter((i) => i >= 0));
};

const WORKDAYS = [0, 1, 2, 3, 4];
const WEEKEND = [5, 6];
const COMPARE_MODES = ["none", "weekday_weekend", "before_after"];
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "YYYY-MM-DD" → Schlüssel YYYYMMDD, sonst null */
const dateKey = (str) => {
  const m = DATE_RE.exec(String(str ?? ""));
  return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : null;
};
const ymdKey = (ymd) => ymd.y * 10000 + ymd.m * 100 + ymd.d;

/** gehört ein Tag zur Gruppe? Wochentag und, falls gesetzt, Datumsfilter */
const inGroup = (g, d) => g.weekdays.has(d.weekday) && (!g.filter || g.filter(d));

/** Vorher/Nachher: gewählte Wochentage, getrennt am Stichtag */
const beforeAfterGroups = (cfg) => {
  const sel = selectedWeekdays(cfg);
  const k = dateKey(cfg.since);
  return [
    { key: "before", weekdays: sel, filter: (d) => ymdKey(d.ymd) < k },
    { key: "after", weekdays: sel, filter: (d) => ymdKey(d.ymd) >= k },
  ];
};
const REFERENCE_MODES = ["auto", "all"];

/**
 * Referenzgruppen für den Graph:
 * - compare: weekday_weekend → Werktage und Wochenende (je mit gewählten Wochentagen)
 * - reference: auto ohne eigene Wochentage → Tage derselben Art wie heute
 * - sonst eine Referenz aus den gewählten Wochentagen
 */
const referenceGroups = (cfg, todayWeekday) => {
  const sel = selectedWeekdays(cfg);
  const pick = (list) => new Set(list.filter((d) => sel.has(d)));
  if (cfg.compare === "weekday_weekend") {
    return [{ key: "workday", weekdays: pick(WORKDAYS) }, { key: "weekend", weekdays: pick(WEEKEND) }]
      .filter((g) => g.weekdays.size);
  }
  if (cfg.compare === "before_after") return beforeAfterGroups(cfg);
  const explicit = Array.isArray(cfg.weekdays) && cfg.weekdays.length > 0;
  if ((cfg.reference || "auto") === "auto" && !explicit) {
    const key = WEEKEND.includes(todayWeekday) ? "weekend" : "workday";
    return [{ key, weekdays: new Set(key === "weekend" ? WEEKEND : WORKDAYS), auto: true }];
  }
  return [{ key: "reference", weekdays: sel }];
};

/** Zeilen der Heatmap: je gewähltem Wochentag, im Vergleich Werktage und Wochenende */
const heatmapRows = (cfg) => {
  const sel = selectedWeekdays(cfg);
  if (cfg.compare === "weekday_weekend") {
    return [
      { key: "workday", weekdays: new Set(WORKDAYS.filter((d) => sel.has(d))) },
      { key: "weekend", weekdays: new Set(WEEKEND.filter((d) => sel.has(d))) },
    ].filter((r) => r.weekdays.size);
  }
  if (cfg.compare === "before_after") return beforeAfterGroups(cfg);
  return [...sel].sort((a, b) => a - b).map((d) => ({ key: WEEKDAYS[d], weekdays: new Set([d]) }));
};

/* --------------------------------------------------------------------------
 * Zeitzonen und Tagesraster
 * ------------------------------------------------------------------------ */

const _tzFormatters = new Map();
const tzFormatter = (tz) => {
  let f = _tzFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric",
    });
    _tzFormatters.set(tz, f);
  }
  return f;
};

const tzParts = (ts, tz) => {
  const p = {};
  for (const { type, value } of tzFormatter(tz).formatToParts(new Date(ts))) {
    if (type !== "literal") p[type] = Number(value);
  }
  if (p.hour === 24) p.hour = 0;
  return p;
};

/** Abstand der Ortszeit zu UTC in ms zum Zeitpunkt ts */
const tzOffset = (ts, tz) => {
  const p = tzParts(ts, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ts / 1000) * 1000;
};

/**
 * Ortszeit (Wanduhr) → Zeitpunkt. Doppelte Zeiten (Herbst) ergeben das erste
 * Auftreten, fehlende Zeiten (Frühjahr) den Zeitpunkt der Umstellung.
 */
const wallToTs = (y, mo, d, h, mi, tz) => {
  const target = Date.UTC(y, mo - 1, d, h, mi);
  const oA = tzOffset(target - 12 * 3600e3, tz);
  const oB = tzOffset(target + 12 * 3600e3, tz);
  const valid = (t) => t + tzOffset(t, tz) === target;
  const cands = [target - oA, target - oB].filter(valid);
  if (cands.length) return Math.min(...cands);
  // Lücke: erster Zeitpunkt, dessen Ortszeit >= target ist
  let lo = Math.min(target - oA, target - oB);
  let hi = Math.max(target - oA, target - oB);
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (mid + tzOffset(mid, tz) >= target) hi = mid;
    else lo = mid;
  }
  return Math.round(hi / 60000) * 60000;
};

const ymdAdd = (ymd, n) => {
  const d = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d + n));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
};

const weekdayOf = (ymd) => (new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d)).getUTCDay() + 6) % 7;

const todayYmd = (now, tz) => {
  const p = tzParts(now, tz);
  return { y: p.year, m: p.month, d: p.day };
};

const startOfDay = (ymd, tz) => wallToTs(ymd.y, ymd.m, ymd.d, 0, 0, tz);

/**
 * Tage vom Beginn des Referenzzeitraums bis heute, je mit Slot-Grenzen b[0..S].
 * Slots folgen der Wanduhr; an Tagen mit Zeitumstellung sind Slots leer (23 h)
 * oder fassen die doppelte Zeit zusammen (25 h).
 */
const buildDays = (now, nDays, tz, slotMin) => {
  const today = todayYmd(now, tz);
  const S = Math.round(1440 / slotMin);
  const slotMs = slotMin * MIN_MS;
  const days = [];
  for (let i = nDays; i >= 0; i--) {
    const ymd = ymdAdd(today, -i);
    const next = ymdAdd(ymd, 1);
    const start = startOfDay(ymd, tz);
    const end = startOfDay(next, tz);
    const b = new Array(S + 1);
    b[0] = start;
    b[S] = end;
    if (end - start === DAY_MS) {
      for (let k = 1; k < S; k++) b[k] = start + k * slotMs;
    } else {
      for (let k = 1; k < S; k++) {
        const m = k * slotMin;
        b[k] = Math.min(end, Math.max(b[k - 1], wallToTs(ymd.y, ymd.m, ymd.d, Math.floor(m / 60), m % 60, tz)));
      }
    }
    days.push({
      ymd, weekday: weekdayOf(ymd), isToday: i === 0, start, end, b,
      w: new Float64Array(S), v: new Float64Array(S), ev: new Float64Array(S),
    });
  }
  return days;
};

/** ruft cb(day, slot, überlappung_ms) für jeden Slot auf, den [s, e) berührt */
const forEachOverlap = (days, s, e, cb) => {
  if (!(e > s) || !days.length) return;
  let lo = 0;
  let hi = days.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (days[mid].end <= s) lo = mid + 1;
    else hi = mid;
  }
  for (let di = lo; di < days.length && days[di].start < e; di++) {
    const day = days[di];
    const b = day.b;
    const ss = Math.max(s, day.start);
    const ee = Math.min(e, day.end);
    let a = 0;
    let z = b.length - 2;
    while (a < z) {
      const m = (a + z + 1) >> 1;
      if (b[m] <= ss) a = m;
      else z = m - 1;
    }
    for (let k = a; k < b.length - 1 && b[k] < ee; k++) {
      const o = Math.min(ee, b[k + 1]) - Math.max(ss, b[k]);
      if (o > 0) cb(day, k, o);
    }
  }
};

/* --------------------------------------------------------------------------
 * Aggregation
 * ------------------------------------------------------------------------ */

const PERIOD_MS = { "5minute": 5 * MIN_MS, hour: 60 * MIN_MS };

/** Statistik-Zeilen ({start, end, mean|change}) in die Slots verteilen */
const accumulateStats = (days, rows, statistic, period) => {
  for (const r of rows || []) {
    const s = Number(r.start);
    const e = r.end != null ? Number(r.end) : s + (PERIOD_MS[period] || 60 * MIN_MS);
    if (statistic === "sum") {
      if (r.change == null) continue;
      const c = Number(r.change);
      const len = e - s;
      forEachOverlap(days, s, e, (d, k, o) => { d.w[k] += o; d.v[k] += (c * o) / len; });
    } else {
      if (r.mean == null) continue;
      const m = Number(r.mean);
      forEachOverlap(days, s, e, (d, k, o) => { d.w[k] += o; d.v[k] += m * o; });
    }
  }
};

/**
 * Verlauf ({s, lu}) eines Abschnitts [rangeStart, rangeEnd) in die Slots verteilen.
 * mode "numeric": zeitgewichtetes Mittel; sonst bekannte Zeit, aktive Zeit, Ereignisse.
 */
const accumulateHistory = (days, entries, rangeStart, rangeEnd, domain, mode) => {
  const list = entries || [];
  const isTs = TIMESTAMP_DOMAINS.has(domain);
  let prev = null;
  for (let i = 0; i < list.length; i++) {
    const s = list[i].s;
    const at = Number(list[i].lu ?? list[i].lc ?? 0) * 1000;
    const t0 = Math.max(at, rangeStart);
    const t1 = i + 1 < list.length ? Math.min(Number(list[i + 1].lu ?? list[i + 1].lc) * 1000, rangeEnd) : rangeEnd;
    if (mode === "numeric") {
      const x = Number(s);
      if (s !== "" && s != null && Number.isFinite(x)) {
        forEachOverlap(days, t0, t1, (d, k, o) => { d.w[k] += o; d.v[k] += x * o; });
      }
    } else {
      const known = isTs ? s !== "unavailable" : !UNKNOWN_STATES.has(s);
      if (known) {
        const active = !isTs && stateActive(domain, s);
        forEachOverlap(days, t0, t1, (d, k, o) => { d.w[k] += o; if (active) d.v[k] += o; });
      }
      // Ereignis = Wechsel in einen aktiven Zustand (bei Zeitstempeln: jeder neue Zeitstempel)
      if (i > 0 && at >= rangeStart && at < rangeEnd && prev != null) {
        const isEvent = isTs
          ? !UNKNOWN_STATES.has(s) && s !== prev
          : !UNKNOWN_STATES.has(prev) && !stateActive(domain, prev) && stateActive(domain, s);
        if (isEvent) forEachOverlap(days, at, at + 1, (d, k) => { d.ev[k] += 1; });
      }
    }
    prev = s;
  }
};

/** Wert je Slot eines Tages; null ohne Daten oder (heute) in der Zukunft */
const dayValues = (day, statistic, now, completedOnly) => {
  const S = day.b.length - 1;
  const out = new Array(S);
  for (let k = 0; k < S; k++) {
    if (day.isToday && (completedOnly ? day.b[k + 1] > now : day.b[k] >= now)) { out[k] = null; continue; }
    const w = day.w[k];
    if (!(w > 0)) { out[k] = null; continue; }
    switch (statistic) {
      case "mean": out[k] = day.v[k] / w; break;
      case "sum": out[k] = day.v[k]; break;
      case "active": out[k] = (day.v[k] / w) * 100; break;
      case "events": out[k] = day.ev[k]; break;
      default: out[k] = null;
    }
  }
  return out;
};

/** laufende Summe ab Mitternacht; Lücken zählen 0, ohne Daten am Tag null */
const cumulate = (vals, day, now) => {
  if (!vals.some((v) => v != null)) return vals.map(() => null);
  let acc = 0;
  return vals.map((v, k) => {
    if (day.isToday && day.b[k] >= now) return null;
    acc += v ?? 0;
    return acc;
  });
};

const quantile = (sorted, q) => {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

/** Kennzahlen je Slot über mehrere Tage */
const slotStats = (arrays, S) => {
  const out = [];
  for (let k = 0; k < S; k++) {
    const vals = [];
    for (const a of arrays) if (a && a[k] != null) vals.push(a[k]);
    vals.sort((x, y) => x - y);
    const n = vals.length;
    out.push(n
      ? {
        n,
        mean: vals.reduce((s, x) => s + x, 0) / n,
        min: vals[0],
        max: vals[n - 1],
        p10: quantile(vals, 0.1),
        p25: quantile(vals, 0.25),
        p75: quantile(vals, 0.75),
        p90: quantile(vals, 0.9),
      }
      : { n: 0, mean: null, min: null, max: null, p10: null, p25: null, p75: null, p90: null });
  }
  return out;
};

/**
 * Modell für Graph und Heatmap aus den befüllten Tagen.
 * Graph: je Referenzgruppe Kennzahlen je Slot (ohne heute), dazu heute.
 * Heatmap: je Zeile (Wochentag oder Gruppe) Mittel je Slot, optional Differenz zweier Zeilen.
 * Ohne groups/rows wird aus weekdays eine Referenz bzw. eine Zeile je Wochentag.
 */
const computeModel = (days, opts) => {
  const { statistic, now, cumulative, mode } = opts;
  const today = days[days.length - 1];
  const S = today.b.length - 1;
  const weekdays = opts.weekdays || new Set([0, 1, 2, 3, 4, 5, 6]);
  const model = { S, statistic, today };

  if (mode === "heatmap") {
    const specs = opts.rows || [...weekdays].sort((a, b) => a - b).map((d) => ({ key: WEEKDAYS[d], weekdays: new Set([d]) }));
    let lo = Infinity;
    let hi = -Infinity;
    let daysWithData = 0;
    let expectedDays = 0;
    model.rows = specs.map((spec) => {
      const ds = days.filter((d) => inGroup(spec, d));
      const vals = ds.map((d) => dayValues(d, statistic, now, true));
      expectedDays += ds.length;
      daysWithData += vals.filter((a) => a.some((v) => v != null)).length;
      const cells = slotStats(vals, S).map((c) => ({ n: c.n, value: c.mean }));
      for (const c of cells) {
        if (c.value == null) continue;
        lo = Math.min(lo, c.value);
        hi = Math.max(hi, c.value);
      }
      // weekday: Kompatibilität für Zeilen aus genau einem Wochentag
      return { ...spec, weekday: spec.weekdays.size === 1 && !spec.filter ? [...spec.weekdays][0] : undefined, cells, nDays: ds.length };
    });
    // Gruppen ohne Tage im Zeitraum (Stichtag außerhalb) entfallen
    if (opts.rows) model.rows = model.rows.filter((r) => r.nDays > 0);
    if (opts.difference && model.rows.length === 2) {
      const [a, b] = model.rows;
      model.diff = a.cells.map((ca, k) => {
        const cb = b.cells[k];
        return ca.value == null || cb.value == null ? { value: null, n: 0 } : { value: cb.value - ca.value, n: Math.min(ca.n, cb.n) };
      });
    }
    model.dataMin = Number.isFinite(lo) ? lo : null;
    model.dataMax = Number.isFinite(hi) ? hi : null;
    model.daysWithData = daysWithData;
    model.expectedDays = expectedDays;
    return model;
  }

  const prep = (d) => {
    const v = dayValues(d, statistic, now, false);
    return cumulative ? cumulate(v, d, now) : v;
  };
  const groups = opts.groups || [{ key: "reference", weekdays }];
  model.references = groups.map((g) => {
    const ds = days.filter((d) => !d.isToday && inGroup(g, d));
    const vals = ds.map(prep);
    return {
      ...g,
      stats: slotStats(vals, S),
      daysWithData: vals.filter((a) => a.some((v) => v != null)).length,
      expectedDays: ds.length,
    };
  });
  if (model.references.length > 1) model.references = model.references.filter((r) => r.expectedDays > 0);
  model.todayVals = prep(today);
  model.daysWithData = model.references.reduce((s, r) => s + r.daysWithData, 0);
  model.expectedDays = model.references.reduce((s, r) => s + r.expectedDays, 0);
  model.reference = model.references[0]?.stats || [];
  model.refDays = model.expectedDays;
  return model;
};

/* --------------------------------------------------------------------------
 * Farben und Formate
 * ------------------------------------------------------------------------ */

/** Konfigurationswert (Hex, CSS, Theme-Name, [r,g,b]) → CSS-Farbe */
const cssColor = (c) => {
  if (Array.isArray(c)) return `rgb(${c.slice(0, 3).join(",")})`;
  if (typeof c !== "string" || !c) return null;
  if (THEME_COLORS.has(c)) return `var(--${c}-color)`;
  return c;
};

/** Standardfarbe: Zustandsfarbe wie im Frontend bzw. Graph-/Primärfarbe */
const defaultColor = (stateObj, kind, forGraph) => {
  if (kind === "state" || kind === "timestamp") {
    const domain = domainOf(stateObj?.entity_id || "");
    const dc = stateObj?.attributes?.device_class;
    const base = `var(--state-${domain}-active-color, var(--state-active-color))`;
    const on = `var(--state-${domain}-on-color, ${base})`;
    return dc ? `var(--state-${domain}-${dc}-on-color, ${on})` : on;
  }
  return forGraph ? "var(--graph-color-1, var(--primary-color))" : "var(--primary-color)";
};

const parseRgb = (s) => {
  if (!s) return null;
  const str = String(s).trim();
  let m = str.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split("").map((x) => x + x).join("");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16),
      h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
  }
  m = str.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (p.length >= 3 && p.slice(0, 3).every(Number.isFinite)) return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  return null;
};

const rgbaString = (c) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${+c[3].toFixed(3)})`;

/** Farbe bei Anteil t (0–1) über die Stufen */
const interpolateStops = (stops, t) => {
  if (!stops.length) return null;
  if (stops.length === 1) return stops[0];
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  return stops[i].map((v, j) => v + (stops[i + 1][j] - v) * f);
};

const numberLocale = (hass) => {
  switch (hass?.locale?.number_format) {
    case "comma_decimal": return ["en-US"];
    case "decimal_comma": return ["de"];
    case "space_comma": return ["fr"];
    case "system": return undefined;
    default: return hass?.locale?.language || hass?.language || "en";
  }
};

const makeNumberFormatter = (hass, entityId, statistic) => {
  const loc = numberLocale(hass);
  const grouping = hass?.locale?.number_format !== "none";
  const precision = hass?.entities?.[entityId]?.display_precision;
  const cache = new Map();
  const fmt = (digits) => {
    if (!cache.has(digits)) {
      cache.set(digits, new Intl.NumberFormat(loc, { maximumFractionDigits: digits, minimumFractionDigits: 0, useGrouping: grouping }));
    }
    return cache.get(digits);
  };
  return (v) => {
    if (v == null || !Number.isFinite(v)) return "–";
    let digits;
    if (statistic === "active") digits = 0;
    else if (statistic === "events") digits = 1;
    else if (typeof precision === "number") digits = precision;
    else {
      const a = Math.abs(v);
      digits = a >= 100 ? 0 : a >= 10 ? 1 : 2;
    }
    return fmt(digits).format(v);
  };
};

/** Achsenbeschriftung wie _formatYAxisLabel in HA: feste Stellen, die 0 ohne */
const makeAxisFormatter = (hass) => {
  const loc = numberLocale(hass);
  const grouping = hass?.locale?.number_format !== "none";
  const cache = new Map();
  return (v, digits) => {
    const d = v === 0 ? 0 : digits;
    if (!cache.has(d)) cache.set(d, new Intl.NumberFormat(loc, { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: grouping }));
    return cache.get(d).format(v);
  };
};

const timeFormatter = (hass, tz) => {
  const tf = hass?.locale?.time_format;
  const opts = { hour: "2-digit", minute: "2-digit", timeZone: tz };
  if (tf === "12") opts.hour12 = true;
  else if (tf === "24") opts.hourCycle = "h23";
  const lang = tf === "system" ? undefined : hass?.locale?.language || "en";
  let f;
  try { f = new Intl.DateTimeFormat(lang, opts); } catch (e) { f = new Intl.DateTimeFormat("en", { ...opts, timeZone: "UTC" }); }
  return (ts) => f.format(new Date(ts));
};

const weekdayNames = (hass) => {
  const lang = hass?.locale?.language || "en";
  const f = new Intl.DateTimeFormat(lang, { weekday: "short", timeZone: "UTC" });
  // 2024-01-01 war ein Montag
  return WEEKDAYS.map((_, i) => f.format(new Date(Date.UTC(2024, 0, 1 + i))));
};

const unitOf = (statistic, info, hass) => {
  if (statistic === "active") return "%";
  if (statistic === "events") return translate(hass, "events_unit");
  return info.unit || "";
};

const withUnit = (text, unit) => {
  if (!unit) return text;
  return unit === "%" ? `${text} %` : `${text} ${unit}`;
};

/* --------------------------------------------------------------------------
 * Graph: Serien und Optionen für ha-chart-base
 * ------------------------------------------------------------------------ */

/** wie nice(val, true) in ECharts: „runder“ Tick-Abstand */
const niceInterval = (val) => {
  const exponent = Math.floor(Math.log10(val));
  const exp10 = 10 ** exponent;
  const f = val / exp10;
  const nf = f < 1.5 ? 1 : f < 2.5 ? 2 : f < 4 ? 3 : f < 7 ? 5 : 10;
  const out = nf * exp10;
  return exponent >= -20 ? +out.toFixed(exponent < 0 ? -exponent : 0) : out;
};

/** Nachkommastellen einer Zahl wie getPrecision in ECharts */
const decimalsOf = (val) => {
  if (!Number.isFinite(val)) return 0;
  const str = String(val);
  const e = str.indexOf("e-");
  if (e > 0) return Number(str.slice(e + 2)) + Math.max(0, (str.slice(0, e).split(".")[1] || "").length);
  const dot = str.indexOf(".");
  return dot < 0 ? 0 : str.length - dot - 1;
};

/**
 * Nachkommastellen der y-Achse wie computeYAxisFractionDigits in HA:
 * aus dem Tick-Abstand bei 5 Intervallen, nicht aus der Genauigkeit des Werts.
 */
const axisFractionDigits = (min, max, includeZero = false) => {
  const lo = includeZero ? Math.min(min, 0) : min;
  const hi = includeZero ? Math.max(max, 0) : max;
  const range = hi - lo;
  if (!Number.isFinite(range) || range <= 0) return 1;
  if (range <= Math.max(Math.abs(lo), Math.abs(hi)) * 1e-10) return 1;
  return decimalsOf(niceInterval(range / 5));
};

/**
 * Bänder einer Referenz, von außen nach innen.
 * both: 10–90 % und 25–75 %; im Vergleich (zwei Referenzen) nur 25–75 %, sonst überlagern sich vier Flächen.
 * Unter MIN_DAYS_WIDE Tagen entfällt 10–90 %, unter MIN_DAYS_IQR gibt es nur Min–Max.
 */
const bandsFor = (mode = "both", n, multi) => {
  const IQR = { key: "iqr", lo: "p25", hi: "p75", opacity: 0.18 };
  const WIDE = { key: "wide", lo: "p10", hi: "p90", opacity: 0.1 };
  const MINMAX = { key: "minmax", lo: "min", hi: "max", opacity: 0.18 };
  if (mode === "none") return { bands: [], wideDropped: false };
  if (mode === "minmax" || n < MIN_DAYS_IQR) return { bands: [MINMAX], wideDropped: false };
  if (mode === "iqr" || (mode === "both" && multi)) return { bands: [IQR], wideDropped: false };
  const wideOk = n >= MIN_DAYS_WIDE;
  if (mode === "wide") return { bands: [wideOk ? WIDE : IQR], wideDropped: !wideOk };
  return { bands: wideOk ? [WIDE, IQR] : [IQR], wideDropped: !wideOk };
};

/**
 * Baut data/options für ha-chart-base.
 * ctx: { colors: {today, refs: {key: color}}, label: {today, refs: {key}, bandName(ref, mode), daysN},
 *        fmtNumber, fmtTime, unit, band, cumulative }
 */
const buildGraph = (model, ctx) => {
  const { today, references, todayVals, S, statistic } = model;
  const b = today.b;
  const cumulative = !!ctx.cumulative;
  const multi = references.length > 1;
  const xOf = (k) => (cumulative ? b[k + 1] : b[k] + (b[k + 1] - b[k]) / 2);
  const slotOfX = new Map();
  for (let k = 0; k < S; k++) slotOfX.set(xOf(k), k);
  if (cumulative) slotOfX.set(b[0], -1);
  const start = cumulative ? [[b[0], 0]] : [];

  const isState = statistic === "active";
  const isEvents = statistic === "events";
  const series = [];
  const legendData = [{ id: "today", name: ctx.label.today }];

  const refs = references.map((ref) => {
    const { bands, wideDropped } = bandsFor(ctx.band, ref.daysWithData, multi);
    const color = ctx.colors.refs[ref.key];
    const name = ctx.label.refs[ref.key];
    const pts = (fn) => start.concat(ref.stats.map((r, k) => [xOf(k), fn(r, k)]));
    // äußeres Band zuerst, das innere liegt darüber und wirkt durch die Überlagerung kräftiger
    const shown = bands.map((band) => {
      const id = `band-${ref.key}-${band.key}`;
      const bandName = ctx.label.bandName(ref, band.key, multi);
      series.push({
        id: `band-low-${ref.key}-${band.key}`, name: "", type: "line", data: pts((r) => r[band.lo]),
        stack: id, stackStrategy: "all", stackOrder: "seriesAsc", symbol: "none",
        lineStyle: { width: 0 }, silent: true, z: 1, color,
      });
      series.push({
        id, name: bandName, type: "line",
        data: pts((r) => (r[band.lo] == null ? null : r[band.hi] - r[band.lo])),
        stack: id, stackStrategy: "all", stackOrder: "seriesAsc", symbol: "none",
        lineStyle: { width: 0 }, areaStyle: { color, opacity: multi ? 0.12 : band.opacity }, silent: true, z: 1, color,
      });
      return { ...band, id, bandName };
    });
    series.push({
      id: `ref-${ref.key}`, name, type: "line", data: pts((r) => r.mean), symbol: "none",
      lineStyle: { width: 1.5, type: "dashed", color }, color, z: 2,
    });
    legendData.push({ id: `ref-${ref.key}`, name });
    // in der Legende das innere Band vor dem äußeren
    for (const band of [...shown].reverse()) legendData.push({ id: band.id, name: band.bandName });
    return { ref, bands: shown, wideDropped, color, name };
  });

  const todayData = start.concat(todayVals.map((v, k) => [xOf(k), v]));
  let last = todayData.length - 1;
  while (last >= 0 && todayData[last][1] == null) last--;
  const todayShown = todayData.slice(0, last + 1);
  if (isEvents) {
    series.push({
      id: "today", name: ctx.label.today, type: "bar", data: todayShown, barWidth: "60%",
      itemStyle: { color: ctx.colors.today, borderRadius: [2, 2, 0, 0] }, color: ctx.colors.today, z: 3,
    });
  } else {
    series.push({
      id: "today", name: ctx.label.today, type: "line", data: todayShown, symbol: "none",
      step: isState ? "middle" : false,
      lineStyle: { width: 2, color: ctx.colors.today }, color: ctx.colors.today, z: 3,
      ...(isState ? { areaStyle: { color: ctx.colors.today, opacity: 0.15 } } : {}),
    });
  }

  const tooltipFormatter = (params) => {
    const list = Array.isArray(params) ? params : [params];
    const p = list.find((x) => x && Array.isArray(x.value));
    if (!p) return null;
    const k = slotOfX.get(p.value[0]);
    if (k === undefined) return null;
    const el = document.createElement("div");
    if (k === -1) {
      el.textContent = ctx.fmtTime(b[0]);
      return el;
    }
    const v = (x) => escapeHtml(withUnit(ctx.fmtNumber(x), ctx.unit));
    const marker = (c) => `<ha-chart-tooltip-marker color="${escapeHtml(c)}"></ha-chart-tooltip-marker>`;
    let rows = cumulative
      ? escapeHtml(ctx.fmtTime(b[k + 1]))
      : `${escapeHtml(ctx.fmtTime(b[k]))} – ${escapeHtml(ctx.fmtTime(b[k + 1]))}`;
    const tv = todayVals[k];
    if (tv != null) rows += `<br>${marker(ctx.colors.today)}${escapeHtml(ctx.label.today)}: <span dir="ltr">${v(tv)}</span>`;
    for (const r of refs) {
      const st = r.ref.stats[k];
      const days = multi ? ` <span style="color:var(--secondary-text-color)">(${escapeHtml(ctx.label.daysShort(st.n))})</span>` : "";
      rows += `<br>${marker(r.color)}${escapeHtml(r.name)}: <span dir="ltr">${v(st.mean)}</span>${days}`;
      for (const band of [...r.bands].reverse()) {
        if (st[band.lo] == null) continue;
        rows += `<br><span class="pc-indent"></span>${escapeHtml(band.bandName)}: <span dir="ltr">${escapeHtml(ctx.fmtNumber(st[band.lo]))} – ${v(st[band.hi])}</span>`;
      }
    }
    const muted = (t) => `<br><span style="color:var(--secondary-text-color)">${escapeHtml(t)}</span>`;
    if (!multi && refs[0]) rows += muted(ctx.label.daysN(refs[0].ref.stats[k].n));
    if (refs.some((r) => r.wideDropped)) rows += muted(ctx.label.wideNeedsDays(MIN_DAYS_WIDE));
    el.innerHTML = rows;
    return el;
  };

  // Nachkommastellen der Achse aus dem Wertebereich aller gezeichneten Werte, wie in HA
  const scale = !isState && !isEvents && !cumulative && statistic !== "sum";
  let lo = Infinity;
  let hi = -Infinity;
  const scan = (x) => {
    if (x == null || !Number.isFinite(x)) return;
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  };
  todayVals.forEach(scan);
  for (const r of refs) {
    for (const st of r.ref.stats) {
      scan(st.mean);
      for (const band of r.bands) { scan(st[band.lo]); scan(st[band.hi]); }
    }
  }
  const digits = isState ? axisFractionDigits(0, 100) : axisFractionDigits(lo, hi, !scale);
  const fmtAxis = ctx.fmtAxis || ((val) => ctx.fmtNumber(val));
  const yAxis = {
    type: "value",
    name: ctx.unit,
    nameGap: 2,
    nameTextStyle: { align: "left" },
    position: "left",
    scale,
    splitNumber: 5,
    splitLine: { show: true },
    // wie state-history-chart-line
    axisLine: { show: false },
    axisLabel: { margin: 5, formatter: (val) => fmtAxis(val, digits) },
    ...(isState ? { min: 0, max: 100 } : {}),
  };

  const options = {
    // ohne Beschriftung am rechten Rand (24:00), sonst schrumpft containLabel die Fläche
    xAxis: [{ id: "xAxis", type: "time", min: b[0], max: b[S], axisLabel: { showMaxLabel: false } }],
    yAxis,
    legend: { type: "custom", show: !ctx.hideLegend, data: legendData },
    // top 12 statt 15: containLabel schiebt die Fläche um die halbe Höhe der obersten
    // y-Beschriftung nach unten; so liegt sie wie in state-history-chart-line (gemessen, 3 px)
    grid: { top: 12, left: 1, right: 1, bottom: 0, containLabel: true },
    tooltip: { trigger: "axis", renderMode: "html", confine: true, formatter: tooltipFormatter },
    // eigenes dataZoom schaltet Zoomen in ha-chart-base ab (_hasZoomableXAxis)
    dataZoom: [],
  };

  return { data: series, options, refs, slotOfX, axisDigits: digits };
};

/* --------------------------------------------------------------------------
 * ha-chart-base nachladen
 * ------------------------------------------------------------------------ */

let _chartBasePromise;
const ensureChartBase = (entityId) => {
  if (customElements.get("ha-chart-base")) return Promise.resolve(true);
  if (!_chartBasePromise) {
    _chartBasePromise = (async () => {
      try {
        // HA lädt ha-chart-base erst mit einer Karte, die es nutzt
        if (typeof window.loadCardHelpers === "function") {
          const helpers = await window.loadCardHelpers();
          helpers.createCardElement({ type: "statistics-graph", entities: [entityId] });
        }
      } catch (e) { /* weiter mit Warten */ }
      return Promise.race([
        customElements.whenDefined("ha-chart-base").then(() => true),
        new Promise((r) => setTimeout(() => r(false), CHART_LOAD_TIMEOUT_MS)),
      ]);
    })();
    _chartBasePromise.then((ok) => { if (!ok) _chartBasePromise = undefined; });
  }
  return _chartBasePromise;
};

/* --------------------------------------------------------------------------
 * Karte
 * ------------------------------------------------------------------------ */

const STYLE = `
  :host { display: block; height: 100%; }
  ha-card { display: flex; flex-direction: column; height: 100%; position: relative; overflow: visible; }
  .card-header { display: flex; flex-direction: column; padding-bottom: 0; }
  /* Titelzeile wie hui-history-graph-card: Titel links, Link zum Verlauf rechts */
  .card-header .head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .card-header .history { display: flex; flex: none; color: var(--primary-text-color); }
  .card-header ha-icon-next { --ha-icon-button-size: 24px; line-height: 24px; color: var(--primary-text-color); }
  /* display: flex überstimmt sonst das hidden-Attribut */
  [hidden] { display: none !important; }
  .card-header .sub {
    font-size: var(--ha-font-size-s, 12px);
    line-height: var(--ha-line-height-normal, 1.6);
    color: var(--secondary-text-color);
    margin-top: 2px;
  }
  .content { padding: 16px; flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .has-header { padding-top: 0; }
  .has-header.no-name { padding-top: 16px; }
  .has-rows { --chart-max-height: 100%; }
  /* Graph wie hui-history-graph-card: kein Abstand oben, unten 8 px */
  .content.graph, .content.graph.no-name { padding: 0 16px 8px; }
  /* Heatmap unter Titel oder Untertitel: eigener Abstand, den sonst das Diagramm mitbringt */
  .content.heatmap.has-header:not(.no-name) { padding-top: 12px; }
  /* wie .entry-container.line in state-history-charts */
  .content.graph .chart { padding-top: 8px; }
  .chart { flex: 1; min-height: 0; }
  .chart ha-chart-base { height: 100%; }
  .message {
    color: var(--secondary-text-color);
    font-size: var(--ha-font-size-m, 14px);
    min-height: 60px; display: flex; align-items: center; justify-content: center; text-align: center;
  }
  ha-alert { display: block; }

  .heatmap {
    display: grid;
    grid-template-columns: auto repeat(var(--pc-slots), minmax(0, 1fr));
    column-gap: 2px; row-gap: 2px; align-items: center;
    touch-action: manipulation;
  }
  .has-rows .heatmap { flex: 1; grid-template-rows: repeat(var(--pc-rows), minmax(0, 1fr)) auto; }
  .wd {
    font-size: var(--ha-font-size-s, 12px); color: var(--secondary-text-color);
    padding-inline-end: 6px; white-space: nowrap; line-height: 1;
  }
  .cell {
    height: var(--pattern-card-cell-height, 16px);
    border-radius: var(--pattern-card-cell-radius, 3px);
    background: var(--secondary-background-color);
  }
  .has-rows .cell { height: 100%; min-height: 4px; }
  .cell.hover { outline: 2px solid var(--primary-text-color); outline-offset: -1px; }
  .cell.diff, .wd.diff { margin-top: 6px; }
  .legend + .legend { margin-top: 4px; }
  .hour {
    font-size: var(--ha-font-size-xs, 10px); color: var(--secondary-text-color);
    padding-top: 2px; white-space: nowrap; overflow: hidden;
  }
  .legend {
    display: flex; align-items: center; justify-content: flex-end; gap: 6px; margin-top: 8px;
    font-size: var(--ha-font-size-xs, 10px); color: var(--secondary-text-color);
  }
  .legend .bar { width: 96px; height: 8px; border-radius: 4px; }

  .tooltip {
    position: absolute; z-index: 9; pointer-events: none;
    background: var(--card-background-color, #fff);
    border: 1px solid var(--divider-color, #e0e0e0);
    border-radius: 4px; padding: 5px 8px;
    box-shadow: rgba(0, 0, 0, 0.2) 1px 2px 10px;
    color: var(--primary-text-color); font-size: 12px; line-height: 1.5; white-space: nowrap;
  }
  .tooltip[hidden] { display: none; }
  .tooltip .marker {
    display: inline-block; width: 10px; height: 10px; border-radius: 10px;
    margin-inline-end: 4px; vertical-align: middle;
  }
  .tooltip .muted { color: var(--secondary-text-color); }
  .probe { position: absolute; width: 0; height: 0; overflow: hidden; visibility: hidden; }
`;

class PatternCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._token = 0;
    this._ref = null;
    this._today = null;
    this._info = null;
    this._model = null;
    this._error = null;
    this._chart = null;
    this._timer = null;
    this._lastStateKey = null;
    this._stateRefreshTimer = null;
    this._themeKey = null;
  }

  static getConfigElement() {
    return document.createElement("pattern-card-editor");
  }

  static getStubConfig(hass) {
    const states = Object.values(hass?.states || {});
    const pick =
      states.find((s) => s.attributes?.state_class === "measurement" && s.attributes?.device_class === "power") ||
      states.find((s) => s.attributes?.state_class === "measurement") ||
      states.find((s) => domainOf(s.entity_id) === "binary_sensor" && ["motion", "occupancy", "presence"].includes(s.attributes?.device_class));
    if (pick && domainOf(pick.entity_id) === "binary_sensor") {
      return { entity: pick.entity_id, mode: "heatmap", days: DEFAULT_DAYS };
    }
    return { entity: pick?.entity_id || "", mode: "graph", days: DEFAULT_DAYS };
  }

  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("Invalid configuration");
    if (!config.entity || typeof config.entity !== "string") throw new Error("entity is required");
    if (config.mode && !["graph", "heatmap"].includes(config.mode)) throw new Error("mode must be graph or heatmap");
    if (config.resolution && config.resolution !== "auto" && !RESOLUTIONS[config.resolution]) {
      throw new Error("resolution must be auto, 5min, 15min, 30min or hour");
    }
    if (config.days !== undefined && !(Number(config.days) >= 1)) throw new Error("days must be at least 1");
    if (config.compare !== undefined && !COMPARE_MODES.includes(config.compare)) throw new Error("compare must be none, weekday_weekend or before_after");
    if (config.compare === "before_after" && dateKey(config.since) === null) throw new Error("compare: before_after needs since: YYYY-MM-DD");
    if (config.reference !== undefined && !REFERENCE_MODES.includes(config.reference)) throw new Error("reference must be auto or all");
    for (const key of ["compare_colors", "difference_colors"]) {
      if (config[key] !== undefined && !(Array.isArray(config[key]) && config[key].length <= 2)) {
        throw new Error(`${key} must be a list of two colors`);
      }
    }
    if (config.band !== undefined && !BAND_MODES.includes(config.band)) throw new Error("band must be both, iqr, wide, minmax or none");
    const prev = this._config;
    this._config = { mode: "graph", ...config };
    const changed = !prev || JSON.stringify(prev) !== JSON.stringify(this._config);
    if (changed) {
      if (!prev || prev.entity !== this._config.entity) this._info = null;
      this._ref = null;
      this._today = null;
      this._model = null;
      this._error = null;
      this._chart = null;
      this._renderShell();
      if (this._hass) this._refresh({ full: !this._info });
    }
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (!this._config) return;
    if (first) {
      this._renderShell();
      this._refresh({ full: true });
      return;
    }
    const st = hass.states[this._config.entity];
    // Verlauf: bei Zustandswechsel heute nachladen (gedrosselt)
    const key = st ? `${st.state}|${st.last_changed}` : "missing";
    if (this._lastStateKey !== null && key !== this._lastStateKey && this._info && this._source() === "history") {
      this._scheduleTodayRefresh();
    }
    this._lastStateKey = key;
    if (!st && !this._error) this._refresh({ full: true });
    const themeKey = `${hass.themes?.darkMode}|${hass.themes?.theme}|${hass.selectedTheme?.theme}`;
    if (this._themeKey !== null && themeKey !== this._themeKey && this._model) this._renderBody();
    this._themeKey = themeKey;
  }

  get hass() { return this._hass; }

  connectedCallback() {
    if (!this._timer) this._timer = setInterval(() => this._tick(), MIN_MS);
    if (this._hass && this._config && this._today && Date.now() - this._today.fetchedAt > TODAY_REFRESH_MS) {
      this._refresh();
    }
  }

  disconnectedCallback() {
    clearInterval(this._timer);
    this._timer = null;
    clearTimeout(this._stateRefreshTimer);
    this._stateRefreshTimer = null;
  }

  getCardSize() {
    return this._config?.mode === "heatmap" ? 4 : 5;
  }

  getGridOptions() {
    // wie statistics-graph: keine feste Zeilenzahl, die Höhe ergibt sich aus dem Inhalt
    return this._config?.mode === "heatmap"
      ? { columns: 12, min_columns: 6, min_rows: 2 }
      : { columns: 12, min_columns: 6, min_rows: 3 };
  }

  /* ---- Daten ---- */

  _t(key, vars) { return translate(this._hass, key, vars); }

  _source() {
    return this._info && (this._info.kind === "measurement" || this._info.kind === "counter") ? "stats" : "history";
  }

  _plan() {
    const cfg = this._config;
    const res = cfg.resolution || "auto";
    const slot = res === "auto" ? (cfg.mode === "heatmap" ? 60 : 15) : RESOLUTIONS[res];
    const source = this._source();
    return { source, slot, period: source === "stats" ? (slot >= 60 ? "hour" : "5minute") : null };
  }

  _scheduleTodayRefresh() {
    if (this._stateRefreshTimer) return;
    const since = Date.now() - (this._today?.fetchedAt || 0);
    const wait = Math.max(0, STATE_REFRESH_THROTTLE_MS - since);
    this._stateRefreshTimer = setTimeout(() => {
      this._stateRefreshTimer = null;
      this._refresh();
    }, wait);
  }

  _tick() {
    if (!this._hass || !this._config || !this._info) return;
    const now = Date.now();
    const tz = timeZoneOf(this._hass);
    const todayStart = startOfDay(todayYmd(now, tz), tz);
    if (this._ref && (this._ref.todayStart !== todayStart || (!this._ref.settled && now >= todayStart + REF_SETTLE_MS))) {
      this._refresh({ ref: true });
    } else if (!this._today || now - this._today.fetchedAt >= TODAY_REFRESH_MS) {
      this._refresh();
    }
  }

  async _fetchStats(start, end, period, statistic) {
    const info = this._info;
    const msg = {
      type: "recorder/statistics_during_period",
      start_time: new Date(start).toISOString(),
      end_time: new Date(end).toISOString(),
      statistic_ids: [this._config.entity],
      period,
      types: statistic === "sum" ? ["change"] : ["mean"],
    };
    if (info.meta?.unit_class && info.stateUnit) msg.units = { [info.meta.unit_class]: info.stateUnit };
    const res = await this._hass.callWS(msg);
    return (res && res[this._config.entity]) || [];
  }

  async _fetchHistory(start, end) {
    const res = await this._hass.callWS({
      type: "history/history_during_period",
      start_time: new Date(start).toISOString(),
      end_time: new Date(end).toISOString(),
      entity_ids: [this._config.entity],
      minimal_response: true,
      no_attributes: true,
      significant_changes_only: false,
    });
    return (res && res[this._config.entity]) || [];
  }

  async _refresh({ full = false, ref = false } = {}) {
    if (!this._hass || !this._config) return;
    const token = ++this._token;
    const hass = this._hass;
    const cfg = this._config;
    const eid = cfg.entity;
    try {
      const st = hass.states[eid];
      if (!st) {
        this._error = { type: "warning", text: this._t("entity_missing", { id: eid }) };
        this._renderBody();
        return;
      }
      if (this._error?.type === "warning") this._error = null;

      if (full || !this._info) {
        let meta = null;
        try {
          const arr = await hass.callWS({ type: "recorder/get_statistics_metadata", statistic_ids: [eid] });
          meta = (arr && arr[0]) || null;
        } catch (e) { meta = null; }
        if (token !== this._token) return;
        const kind = detectKind(st, meta);
        this._info = {
          kind, meta, domain: domainOf(eid),
          stateUnit: st.attributes?.unit_of_measurement,
          unit: st.attributes?.unit_of_measurement ?? meta?.statistics_unit_of_measurement ?? meta?.display_unit_of_measurement ?? "",
        };
        this._ref = null;
      }
      const info = this._info;
      if (info.kind === "unsupported") {
        this._error = { type: "error", text: this._t("unsupported") };
        this._renderBody();
        return;
      }
      const statistic = resolveStatistic(cfg.statistic, info.kind);
      const plan = this._plan();
      const days = Math.max(1, Math.round(Number(cfg.days) || DEFAULT_DAYS));
      const tz = timeZoneOf(hass);
      const now = Date.now();
      const today = todayYmd(now, tz);
      const todayStart = startOfDay(today, tz);
      const refStart = startOfDay(ymdAdd(today, -days), tz);

      if (ref || !this._ref || this._ref.todayStart !== todayStart) {
        let r;
        if (plan.source === "stats") {
          let period = plan.period;
          let slot = plan.slot;
          let coarse = false;
          let rows = await this._fetchStats(refStart, todayStart, period, statistic);
          if (period === "5minute") {
            // reicht die Kurzzeitstatistik nicht so weit zurück wie die Stundenstatistik, stündlich auswerten
            const hourRows = await this._fetchStats(refStart, todayStart, "hour", statistic);
            const first5 = rows.length ? Number(rows[0].start) : Infinity;
            const firstH = hourRows.length ? Number(hourRows[0].start) : Infinity;
            if (firstH < first5 - 60 * MIN_MS) {
              rows = hourRows;
              period = "hour";
              slot = 60;
              coarse = true;
            }
          }
          r = { rows, period, slot, coarse };
        } else {
          r = { entries: await this._fetchHistory(refStart, todayStart), slot: plan.slot, coarse: false };
        }
        if (token !== this._token) return;
        this._ref = { ...r, todayStart, refStart, settled: now >= todayStart + REF_SETTLE_MS, days };
      }

      const refData = this._ref;
      let todayData;
      if (plan.source === "stats") {
        todayData = { rows: await this._fetchStats(todayStart, now, refData.period, statistic) };
      } else {
        todayData = { entries: await this._fetchHistory(todayStart, now) };
      }
      if (token !== this._token) return;
      this._today = { ...todayData, fetchedAt: now };

      // auswerten
      const dayList = buildDays(now, refData.days, tz, refData.slot);
      if (plan.source === "stats") {
        accumulateStats(dayList, refData.rows, statistic, refData.period);
        accumulateStats(dayList, this._today.rows, statistic, refData.period);
      } else {
        const mode = info.kind === "numeric" ? "numeric" : "state";
        accumulateHistory(dayList, refData.entries, refStart, todayStart, info.domain, mode);
        accumulateHistory(dayList, this._today.entries, todayStart, now, info.domain, mode);
      }
      this._model = computeModel(dayList, {
        statistic, now, mode: cfg.mode,
        cumulative: cfg.mode === "graph" && statistic === "sum" && !!cfg.cumulative,
        groups: referenceGroups(cfg, dayList[dayList.length - 1].weekday),
        rows: heatmapRows(cfg),
        difference: !!cfg.compare && cfg.compare !== "none" && cfg.difference !== false,
      });
      this._model.coarse = refData.coarse;
      this._model.tz = tz;
      this._model.now = now;
      if (this._error?.type !== "chart") this._error = null;
      this._renderBody();
    } catch (e) {
      if (token !== this._token) return;
      this._error = { type: "error", text: e?.message || String(e) };
      this._renderBody();
    }
  }

  /* ---- Darstellung ---- */

  _renderShell() {
    const root = this.shadowRoot;
    if (!root.querySelector("ha-card")) {
      root.innerHTML = `<style>${STYLE}</style><ha-card><h1 class="card-header"><div class="head"><span class="title"></span><a class="history"><ha-icon-next></ha-icon-next></a></div><span class="sub"></span></h1><div class="content has-header"></div><div class="tooltip" hidden></div><div class="probe"></div></ha-card>`;
    }
    this._renderHeader();
    const content = root.querySelector(".content");
    content.classList.toggle("has-rows", typeof this._config?.grid_options?.rows === "number");
    if (!this._model && !this._error) {
      content.innerHTML = `<div class="message">${escapeHtml(this._t("loading"))}</div>`;
    }
  }

  _title() {
    const cfg = this._config;
    // false oder nur Leerzeichen: kein Titel (im Editor lässt sich das Feld nicht leeren)
    if (cfg.name === false) return "";
    if (typeof cfg.name === "string") return cfg.name.trim();
    const st = this._hass?.states?.[cfg.entity];
    return st?.attributes?.friendly_name || cfg.entity;
  }

  _subtitle() {
    const cfg = this._config;
    const m = this._model;
    const parts = [];
    const days = Math.max(1, Math.round(Number(cfg.days) || DEFAULT_DAYS));
    parts.push(this._t("days_n", { n: days }));
    const sel = selectedWeekdays(cfg);
    if (sel.size < 7) {
      const names = weekdayNames(this._hass);
      parts.push([...sel].sort().map((i) => names[i]).join(", "));
    }
    if (m && m.expectedDays && m.daysWithData < m.expectedDays) {
      parts.push(this._t("days_of", { n: m.daysWithData, total: m.expectedDays }));
    }
    if (m?.coarse) parts.push(this._t("coarse"));
    return parts.join(" · ");
  }

  _renderHeader() {
    const root = this.shadowRoot;
    const header = root.querySelector(".card-header");
    if (!header || !this._config) return;
    const title = this._title();
    header.querySelector(".title").textContent = title;
    const sub = header.querySelector(".sub");
    sub.textContent = this._hass && !this._config.hide_subtitle ? this._subtitle() : "";
    sub.hidden = !!this._config.hide_subtitle;
    // ohne Titel und Untertitel entfällt der Kopf ganz
    header.hidden = !title && !!this._config.hide_subtitle;
    root.querySelector(".content").classList.toggle("no-name", !title);
    header.querySelector(".head").hidden = !title;
    // wie die nativen Graph-Karten: Pfeil zum Verlauf über den ausgewerteten Zeitraum
    const link = header.querySelector(".history");
    link.href = this._historyUrl();
    const label = this._hass?.localize?.("panel.history") || this._t("history");
    link.setAttribute("aria-label", label);
    link.title = label;
  }

  _historyUrl() {
    const cfg = this._config;
    const days = Math.max(1, Math.round(Number(cfg.days) || DEFAULT_DAYS));
    const start = this._ref?.refStart ?? Date.now() - (24 * days + 1) * 60 * MIN_MS;
    const params = new URLSearchParams({ entity_id: cfg.entity, back: "1", start_date: new Date(start).toISOString() });
    return `/history?${params}`;
  }

  _resolveColor(css) {
    const probe = this.shadowRoot.querySelector(".probe");
    if (!probe || !css) return css;
    probe.style.color = "";
    probe.style.color = css;
    const c = getComputedStyle(probe).color;
    return parseRgb(c) ? c : css;
  }

  _colors() {
    const cfg = this._config;
    const st = this._hass?.states?.[cfg.entity];
    const kind = this._info?.kind || "state";
    const user = cssColor(cfg.color);
    const neutral = this._resolveColor("var(--secondary-text-color)");
    // Gruppenfarben: compare_colors oder die Graph-Farben 2 und 3 von HA
    const cc = Array.isArray(cfg.compare_colors) ? cfg.compare_colors : [];
    const second = "var(--graph-color-2, var(--color-2, #efb118))";
    const third = "var(--graph-color-3, var(--color-3, #ff725c))";
    const workday = this._resolveColor(cssColor(cc[0]) || second);
    const weekend = this._resolveColor(cssColor(cc[1]) || third);
    // Differenzzeile: nur difference_colors [weniger, mehr], sonst fest die Graph-Farben 2 und 3
    // (nicht die Gruppenfarben, sonst verändert compare_colors auch die Differenz)
    const dc = Array.isArray(cfg.difference_colors) ? cfg.difference_colors : [];
    const diffLess = this._resolveColor(cssColor(dc[0]) || second);
    const diffMore = this._resolveColor(cssColor(dc[1]) || third);
    return {
      today: this._resolveColor(user || defaultColor(st, kind, true)),
      reference: neutral,
      // eine Referenz neutral grau, im Vergleich die nächsten Graph-Farben von HA
      refs: this._model?.references?.length > 1
        ? { workday, weekend, before: workday, after: weekend, reference: neutral }
        : { workday: neutral, weekend: neutral, before: neutral, after: neutral, reference: neutral },
      workday,
      weekend,
      diffLess,
      diffMore,
      heat: user || defaultColor(st, kind, false),
    };
  }

  /** Name einer Gruppe: Werktage, Wochenende, Vor/Ab <Datum> */
  _groupLabel(key) {
    if (key === "before" || key === "after") {
      const m = DATE_RE.exec(String(this._config.since ?? ""));
      const date = m
        ? new Intl.DateTimeFormat(this._hass?.locale?.language || "en", { day: "numeric", month: "short", timeZone: "UTC" })
          .format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))))
        : "";
      return this._t(`group_${key}`, { date });
    }
    return this._t(`group_${key}`);
  }

  /** Texte der Differenzzeile je Vergleich */
  _diffTexts() {
    return this._config.compare === "before_after"
      ? { label: this._t("diff_label_before_after"), neg: this._t("more_before"), pos: this._t("more_after") }
      : { label: this._t("diff_label"), neg: this._t("more_workday"), pos: this._t("more_weekend") };
  }

  _renderBody() {
    if (!this.shadowRoot.querySelector("ha-card")) this._renderShell();
    this._renderHeader();
    const content = this.shadowRoot.querySelector(".content");
    this._hideTooltip();
    if (this._error && this._error.type !== "chart") {
      this._chart = null;
      content.innerHTML = `<ha-alert alert-type="${this._error.type === "warning" ? "warning" : "error"}">${escapeHtml(this._error.text)}</ha-alert>`;
      return;
    }
    const m = this._model;
    if (!m) return;
    const hasData = this._config.mode === "heatmap"
      ? m.rows.some((r) => r.cells.some((c) => c.value != null))
      : m.references.some((r) => r.stats.some((x) => x.mean != null)) || m.todayVals.some((v) => v != null);
    if (!hasData) {
      this._chart = null;
      content.innerHTML = `<div class="message">${escapeHtml(this._t("no_data"))}</div>`;
      return;
    }
    if (this._config.mode === "heatmap") this._renderHeatmap(content, m);
    else this._renderGraph(content, m);
  }

  _fmt() {
    return makeNumberFormatter(this._hass, this._config.entity, this._model.statistic);
  }

  async _renderGraph(content, m) {
    const ok = await ensureChartBase(this._config.entity);
    if (m !== this._model) return; // inzwischen neu berechnet
    if (!ok) {
      this._chart = null;
      content.innerHTML = `<ha-alert alert-type="error">${escapeHtml(this._t("chart_unavailable"))}</ha-alert>`;
      return;
    }
    const cumulative = m.statistic === "sum" && !!this._config.cumulative;
    const unit = unitOf(m.statistic, this._info, this._hass);
    const { data, options } = buildGraph(m, {
      colors: this._colors(),
      unit,
      band: this._config.band || "both",
      hideLegend: !!this._config.hide_legend,
      cumulative,
      fmtNumber: this._fmt(),
      fmtAxis: makeAxisFormatter(this._hass),
      fmtTime: timeFormatter(this._hass, m.tz),
      label: {
        today: this._t("today"),
        refs: {
          reference: this._t("ref_reference"),
          workday: this._t("ref_workday"),
          weekend: this._t("ref_weekend"),
          before: this._t("ref_group", { group: this._groupLabel("before") }),
          after: this._t("ref_group", { group: this._groupLabel("after") }),
        },
        bandName: (ref, key, multi) => (multi
          ? this._t("band_group", { group: this._groupLabel(ref.key) })
          : this._t(`band_${key}`)),
        wideNeedsDays: (n) => this._t("wide_needs_days", { n }),
        daysN: (n) => this._t("avg_of_days", { n }),
        daysShort: (n) => this._t("days_short", { n }),
      },
    });
    content.classList.add("graph");
    content.classList.remove("heatmap");
    let wrap = content.querySelector(".chart");
    if (!wrap || !this._chart || !wrap.contains(this._chart)) {
      content.innerHTML = `<div class="chart"></div>`;
      wrap = content.querySelector(".chart");
      this._chart = document.createElement("ha-chart-base");
      wrap.appendChild(this._chart);
    }
    const chart = this._chart;
    chart.zoomSlider = "never";
    chart.setAttribute("zoom-slider", "never");
    if (typeof this._config.grid_options?.rows === "number") chart.height = "100%";
    chart.data = data;
    chart.options = options;
  }

  _renderHeatmap(content, m) {
    const cfg = this._config;
    const S = m.S;
    const slotMin = 1440 / S;
    const names = weekdayNames(this._hass);
    const fmt = this._fmt();
    const unit = unitOf(m.statistic, this._info, this._hass);

    // Skala
    let lo = cfg.min != null && cfg.min !== "" ? Number(cfg.min) : null;
    let hi = cfg.max != null && cfg.max !== "" ? Number(cfg.max) : null;
    // Anteil, Ereignisse und Verbrauch beginnen bei 0; das Maximum kommt aus den Daten,
    // sonst bliebe etwa ein selten belegter Raum auf einer Skala bis 100 % fast weiß
    if (["active", "events", "sum"].includes(m.statistic)) lo = lo ?? Math.min(0, m.dataMin ?? 0);
    lo = lo ?? m.dataMin ?? 0;
    hi = hi ?? m.dataMax ?? 1;
    if (!(hi > lo)) hi = lo + 1;

    // Farbstufen
    const colors = this._colors();
    let stops;
    if (Array.isArray(cfg.colors) && cfg.colors.length >= 2) {
      stops = cfg.colors.map((c) => parseRgb(this._resolveColor(cssColor(c))) || [128, 128, 128, 1]);
    } else {
      const base = parseRgb(this._resolveColor(colors.heat)) || [3, 169, 244, 1];
      stops = [[base[0], base[1], base[2], 0.06], [base[0], base[1], base[2], 1]];
    }
    // Alle Zeilen, auch im Vergleich, in derselben Farbskala; compare_colors gilt nur im Graph
    const colorOf = (v) => rgbaString(interpolateStops(stops, (v - lo) / (hi - lo)));

    const diffTexts = this._diffTexts();
    const rowLabel = (row) => {
      if (row.key === "before" || row.key === "after") return this._groupLabel(row.key);
      if (row.weekday !== undefined) return names[row.weekday];
      const ds = [...row.weekdays].sort((a, b) => a - b);
      const contiguous = ds.every((d, i) => i === 0 || d === ds[i - 1] + 1);
      return ds.length >= 2 && contiguous ? `${names[ds[0]]}–${names[ds[ds.length - 1]]}` : ds.map((d) => names[d]).join(", ");
    };

    // Differenzzeile: zweifarbig um 0, difference_colors (weniger, mehr)
    const diff = m.diff && m.diff.some((c) => c.value != null) ? m.diff : null;
    let diffMax = 0;
    if (diff) for (const c of diff) if (c.value != null) diffMax = Math.max(diffMax, Math.abs(c.value));
    if (!(diffMax > 0)) diffMax = 1;
    const neg = parseRgb(colors.diffLess) || [239, 177, 24, 1];
    const pos = parseRgb(colors.diffMore) || [255, 114, 92, 1];
    const diffColor = (v) => {
      const c = v < 0 ? neg : pos;
      return rgbaString([c[0], c[1], c[2], Math.min(1, Math.abs(v) / diffMax)]);
    };
    const signed = (v) => (v > 0 ? `+${fmt(v)}` : fmt(v));

    let html = "";
    m.rows.forEach((row, ri) => {
      html += `<div class="wd" style="grid-row:${ri + 1};grid-column:1">${escapeHtml(rowLabel(row))}</div>`;
      row.cells.forEach((c, k) => {
        const bg = c.value == null ? "" : ` style="background:${colorOf(c.value)}"`;
        html += `<div class="cell" data-r="${ri}" data-k="${k}"${bg}></div>`;
      });
    });
    let nRows = m.rows.length;
    if (diff) {
      nRows++;
      html += `<div class="wd diff" style="grid-row:${nRows};grid-column:1" title="${escapeHtml(diffTexts.label)}">Δ</div>`;
      diff.forEach((c, k) => {
        const bg = c.value == null ? "" : ` style="background:${diffColor(c.value)}"`;
        html += `<div class="cell diff" data-r="diff" data-k="${k}"${bg}></div>`;
      });
    }
    // Stundenbeschriftung alle 3 h
    const step = Math.max(1, Math.round(180 / slotMin));
    const hourRow = nRows + 1;
    for (let k = 0; k < S; k += step) {
      const h = Math.floor((k * slotMin) / 60);
      html += `<div class="hour" style="grid-row:${hourRow};grid-column:${k + 2} / span ${Math.min(step, S - k)}">${h}</div>`;
    }
    const gradient = `linear-gradient(to right, ${stops.map((x, i) => `${rgbaString(x)} ${Math.round((i / (stops.length - 1)) * 100)}%`).join(", ")})`;
    let legend = `<div class="legend"><span dir="ltr">${escapeHtml(withUnit(fmt(lo), unit))}</span><span class="bar" style="background:${gradient}"></span><span dir="ltr">${escapeHtml(withUnit(fmt(hi), unit))}</span></div>`;
    if (diff) {
      const dg = `linear-gradient(to right, ${rgbaString([neg[0], neg[1], neg[2], 1])}, ${rgbaString([neg[0], neg[1], neg[2], 0])} 50%, ${rgbaString([pos[0], pos[1], pos[2], 0])} 50%, ${rgbaString([pos[0], pos[1], pos[2], 1])})`;
      legend += `<div class="legend"><span>${escapeHtml(diffTexts.neg)}</span><span dir="ltr">${escapeHtml(withUnit(signed(-diffMax), unit))}</span><span class="bar" style="background:${dg}"></span><span dir="ltr">${escapeHtml(withUnit(signed(diffMax), unit))}</span><span>${escapeHtml(diffTexts.pos)}</span></div>`;
    }

    if (cfg.hide_legend) legend = "";
    content.classList.remove("graph");
    content.classList.add("heatmap");
    content.innerHTML = `<div class="heatmap" style="--pc-slots:${S};--pc-rows:${nRows}">${html}</div>${legend}`;
    this._chart = null;

    const grid = content.querySelector(".heatmap");
    // Slots sind Wanduhrzeiten: Beschriftung über einen festen UTC-Tag
    const fmtWall = timeFormatter(this._hass, "UTC");
    const show = (cell) => {
      if (!cell?.classList?.contains("cell")) return;
      const isDiff = cell.dataset.r === "diff";
      const row = isDiff ? null : m.rows[Number(cell.dataset.r)];
      const k = Number(cell.dataset.k);
      const c = isDiff ? diff[k] : row.cells[k];
      grid.querySelectorAll(".cell.hover").forEach((x) => x.classList.remove("hover"));
      cell.classList.add("hover");
      const t0 = Date.UTC(2024, 0, 1, 0, 0) + k * slotMin * MIN_MS;
      const time = `${fmtWall(t0)} – ${fmtWall(t0 + slotMin * MIN_MS)}`;
      let body;
      if (isDiff) {
        const a = m.rows[0].cells[k];
        const b = m.rows[1].cells[k];
        const line = (r, cc, color) => `<span class="marker" style="background:${color}"></span>${escapeHtml(rowLabel(r))}: <span dir="ltr">${escapeHtml(cc.value == null ? "–" : withUnit(fmt(cc.value), unit))}</span>`;
        const mark = (cc) => (cc.value == null ? "var(--secondary-background-color)" : colorOf(cc.value));
        body = `${escapeHtml(time)}<br>${line(m.rows[0], a, mark(a))}<br>${line(m.rows[1], b, mark(b))}<br>${escapeHtml(diffTexts.label)}: <span dir="ltr">${escapeHtml(c.value == null ? "–" : withUnit(signed(c.value), unit))}</span>`;
      } else {
        const valueText = c.value == null ? "–" : withUnit(fmt(c.value), unit);
        const color = c.value == null ? "var(--secondary-background-color)" : colorOf(c.value);
        const label = this._t(`stat_${m.statistic}`);
        body = `${escapeHtml(rowLabel(row))} ${escapeHtml(time)}<br><span class="marker" style="background:${color}"></span>${escapeHtml(label)}: <span dir="ltr">${escapeHtml(valueText)}</span><br><span class="muted">${escapeHtml(this._t("avg_of_days", { n: c.n }))}</span>`;
      }
      const tip = this.shadowRoot.querySelector(".tooltip");
      tip.innerHTML = body;
      tip.hidden = false;
      const card = this.shadowRoot.querySelector("ha-card");
      const cr = card.getBoundingClientRect();
      const r = cell.getBoundingClientRect();
      const tw = tip.offsetWidth || 160;
      const th = tip.offsetHeight || 60;
      let x = r.left - cr.left + r.width / 2 - tw / 2;
      x = Math.max(4, Math.min(x, cr.width - tw - 4));
      let y = r.top - cr.top - th - 8;
      if (y < 4) y = r.bottom - cr.top + 8;
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
    };
    grid.addEventListener("pointerover", (ev) => show(ev.target));
    grid.addEventListener("click", (ev) => show(ev.target));
    grid.addEventListener("pointerleave", () => this._hideTooltip());
  }

  _hideTooltip() {
    const tip = this.shadowRoot?.querySelector(".tooltip");
    if (tip) tip.hidden = true;
    this.shadowRoot?.querySelectorAll(".cell.hover").forEach((x) => x.classList.remove("hover"));
  }
}

customElements.define("pattern-card", PatternCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "pattern-card",
  name: "Pattern Card",
  description: "Daily and weekly patterns of a sensor: today vs. reference, or weekday × time of day heatmap",
  preview: true,
  documentationURL: "https://github.com/luc-ass/pattern-card",
});

/* --------------------------------------------------------------------------
 * Editor
 * ------------------------------------------------------------------------ */

const editorSchema = (cfg, kind, t) => {
  const mode = cfg.mode || "graph";
  const stats = STATISTICS_BY_KIND[kind] || [];
  const schema = [
    { name: "entity", required: true, selector: { entity: {} } },
    {
      name: "mode",
      selector: {
        select: { mode: "box", options: [{ value: "graph", label: t("mode_graph") }, { value: "heatmap", label: t("mode_heatmap") }] },
      },
    },
    { name: "name", selector: { text: {} } },
    { name: "hide_subtitle", selector: { boolean: {} } },
    {
      type: "grid",
      name: "",
      schema: [
        { name: "days", selector: { number: { min: 1, max: 365, mode: "box" } } },
        {
          name: "resolution",
          selector: {
            select: {
              mode: "dropdown",
              options: ["auto", "5min", "15min", "30min", "hour"].map((v) => ({ value: v, label: t(`res_${v}`) })),
            },
          },
        },
      ],
    },
    {
      name: "weekdays",
      selector: { select: { multiple: true, mode: "list", options: WEEKDAYS.map((v, i) => ({ value: v, label: t(`wd_${i}`) })) } },
    },
    {
      name: "compare",
      selector: { select: { mode: "dropdown", options: COMPARE_MODES.map((v) => ({ value: v, label: t(`compare_${v}`) })) } },
    },
  ];
  const compare = !!cfg.compare && cfg.compare !== "none";
  if (cfg.compare === "before_after") schema.push({ name: "since", selector: { date: {} } });
  if (mode === "graph" && !compare) {
    schema.push({
      name: "reference",
      selector: { select: { mode: "dropdown", options: REFERENCE_MODES.map((v) => ({ value: v, label: t(`reference_${v}`) })) } },
    });
  }
  if (mode === "heatmap" && compare) schema.push({ name: "difference", selector: { boolean: {} } });
  if (compare) {
    // Graph: Farben der beiden Referenzen; Heatmap: nur die Farben der Differenzzeile
    if (mode === "graph") {
      schema.push({
        type: "grid",
        name: "",
        schema: [
          { name: "compare_color_1", selector: { ui_color: {} } },
          { name: "compare_color_2", selector: { ui_color: {} } },
        ],
      });
    }
    if (mode === "heatmap" && cfg.difference !== false) {
      schema.push({
        type: "grid",
        name: "",
        schema: [
          { name: "difference_color_less", selector: { ui_color: {} } },
          { name: "difference_color_more", selector: { ui_color: {} } },
        ],
      });
    }
  }
  if (stats.length > 1) {
    schema.push({
      name: "statistic",
      selector: { select: { mode: "dropdown", options: stats.map((v) => ({ value: v, label: t(`stat_${v}`) })) } },
    });
  }
  if (mode === "graph") {
    schema.push({
      name: "band",
      selector: {
        select: { mode: "dropdown", options: BAND_MODES.map((v) => ({ value: v, label: t(`band_${v}`) })) },
      },
    });
    if (kind === "counter") schema.push({ name: "cumulative", selector: { boolean: {} } });
    schema.push({ name: "color", selector: { ui_color: {} } });
    schema.push({ name: "hide_legend", selector: { boolean: {} } });
  } else {
    schema.push({ name: "color", selector: { ui_color: {} } });
    schema.push({
      type: "grid",
      name: "",
      schema: [
        { name: "min", selector: { number: { mode: "box", step: "any" } } },
        { name: "max", selector: { number: { mode: "box", step: "any" } } },
      ],
    });
    schema.push({ name: "hide_legend", selector: { boolean: {} } });
  }
  return schema;
};

class PatternCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...config };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _t(key, vars) {
    const m = key.match(/^wd_(\d)$/);
    if (m) {
      const names = new Intl.DateTimeFormat(this._hass?.locale?.language || "en", { weekday: "long", timeZone: "UTC" });
      return names.format(new Date(Date.UTC(2024, 0, 1 + Number(m[1]))));
    }
    return translate(this._hass, key, vars);
  }

  _render() {
    if (!this._hass || !this._config) return;
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.addEventListener("value-changed", (ev) => this._changed(ev));
      this.appendChild(this._form);
    }
    const cfg = this._config;
    const kind = guessKind(this._hass.states[cfg.entity]);
    this._kind = kind;
    const form = this._form;
    form.hass = this._hass;
    form.schema = editorSchema(cfg, kind, (k) => this._t(k));
    form.data = {
      mode: "graph",
      days: DEFAULT_DAYS,
      resolution: "auto",
      band: "both",
      compare: "none",
      reference: "auto",
      difference: true,
      compare_color_1: cfg.compare_colors?.[0],
      compare_color_2: cfg.compare_colors?.[1],
      difference_color_less: cfg.difference_colors?.[0],
      difference_color_more: cfg.difference_colors?.[1],
      weekdays: [...WEEKDAYS],
      ...cfg,
      statistic: resolveStatistic(cfg.statistic, kind),
    };
    form.computeLabel = (s) => {
      const groups = cfg.compare === "before_after" ? ["group_before_short", "group_after_short"] : ["group_workday", "group_weekend"];
      const hint = this._t("color_of_hint_graph");
      if (s.name === "compare_color_1") return `${this._t("color_of", { group: this._t(groups[0]) })} (${hint})`;
      if (s.name === "compare_color_2") return `${this._t("color_of", { group: this._t(groups[1]) })} (${hint})`;
      if (s.name === "difference_color_less") return this._t("color_less");
      if (s.name === "difference_color_more") return this._t("color_more");
      return this._t(s.name);
    };
    form.computeHelper = (s) => ({
      days: this._t("helper_days"),
      resolution: this._t("helper_resolution"),
      reference: this._t("helper_reference"),
      since: this._t("helper_since"),
    })[s.name];
  }

  _changed(ev) {
    ev.stopPropagation();
    const v = { ...this._config, ...ev.detail.value };
    // Standardwerte nicht in die Konfiguration schreiben
    if (Array.isArray(v.weekdays) && WEEKDAYS.every((w) => v.weekdays.includes(w))) delete v.weekdays;
    if (Array.isArray(v.weekdays)) v.weekdays = WEEKDAYS.filter((w) => v.weekdays.includes(w));
    if (v.resolution === "auto") delete v.resolution;
    if (v.band === "both") delete v.band;
    if (v.cumulative === false) delete v.cumulative;
    const kind = guessKind(this._hass.states[v.entity]);
    if (v.statistic === (STATISTICS_BY_KIND[kind] || [])[0] || !(STATISTICS_BY_KIND[kind] || []).includes(v.statistic)) delete v.statistic;
    if (v.mode === "heatmap") { delete v.band; delete v.cumulative; }
    if (v.mode === "graph") { delete v.min; delete v.max; delete v.difference; }
    if (v.compare === "none") delete v.compare;
    // Stichtag nur bei vorher/nachher; beim Umschalten heute vorbelegen, sonst wäre die Konfiguration ungültig
    if (v.compare === "before_after") {
      if (dateKey(v.since) === null) {
        const t = todayYmd(Date.now(), timeZoneOf(this._hass));
        v.since = `${t.y}-${String(t.m).padStart(2, "0")}-${String(t.d).padStart(2, "0")}`;
      }
    } else delete v.since;
    if (v.compare) delete v.reference;
    else delete v.difference;
    if (v.mode === "heatmap") delete v.reference;
    if (v.reference === "auto") delete v.reference;
    if (v.difference === true) delete v.difference;
    if (v.hide_legend === false) delete v.hide_legend;
    if (v.hide_subtitle === false) delete v.hide_subtitle;
    // Einzelfelder der Farbwähler wieder zu Listen zusammenfassen
    const pair = (a, b) => (a || b ? [a ?? null, b ?? null] : undefined);
    v.compare_colors = pair(v.compare_color_1, v.compare_color_2);
    v.difference_colors = pair(v.difference_color_less, v.difference_color_more);
    for (const k of ["compare_color_1", "compare_color_2", "difference_color_less", "difference_color_more"]) delete v[k];
    if (!v.compare || v.compare === "none") { delete v.compare_colors; delete v.difference_colors; }
    if (v.mode !== "heatmap" || v.difference === false) delete v.difference_colors;
    if (v.mode === "heatmap") delete v.compare_colors;
    if (kind !== "counter") delete v.cumulative;
    Object.keys(v).forEach((k) => {
      if (v[k] === undefined || v[k] === "" || v[k] === null) delete v[k];
    });
    this._config = v;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: v }, bubbles: true, composed: true }));
  }
}

customElements.define("pattern-card-editor", PatternCardEditor);

// für Tests
window.__patternCard = {
  WEEKDAYS, I18N, translate, stateActive, detectKind, guessKind, resolveStatistic, timeZoneOf, selectedWeekdays,
  tzOffset, wallToTs, ymdAdd, weekdayOf, buildDays, forEachOverlap, accumulateStats, accumulateHistory,
  dayValues, cumulate, quantile, slotStats, computeModel, cssColor, defaultColor, parseRgb, interpolateStops,
  makeNumberFormatter, buildGraph, editorSchema, ensureChartBase, referenceGroups, heatmapRows, WORKDAYS, WEEKEND, bandsFor, dateKey, inGroup,
  axisFractionDigits, niceInterval, makeAxisFormatter,
};

import { JSDOM } from "jsdom";
import fs from "fs";
import assert from "assert/strict";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only", pretendToBeVisual: true });
const w = dom.window;
const src = fs.readFileSync(new URL("../pattern-card.js", import.meta.url), "utf8");
w.console.info = () => {};
w.__PATTERN_CARD_TEST__ = true;
w.eval(src);
const P = w.__patternCard;

let failed = 0;
let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const near = (a, b, eps = 1e-9, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ""} ${a} ≉ ${b}`);
const H = 3600e3;
const M = 60e3;
const TZ = "Europe/Berlin";
const settle = () => new Promise((r) => w.setTimeout(r, 0));
const flush = async (n = 10) => { for (let i = 0; i < n; i++) await settle(); };

/* ---- Zeitraster ---- */

test("withUnit: Einzahl bei genau einem Ereignis", () => {
  assert.equal(P.withUnit("1", "Ereignisse", "Ereignis"), "1 Ereignis");
  assert.equal(P.withUnit("+1", "Ereignisse", "Ereignis"), "+1 Ereignis");
  assert.equal(P.withUnit("\u22121", "Ereignisse", "Ereignis"), "\u22121 Ereignis");
  assert.equal(P.withUnit("0", "Ereignisse", "Ereignis"), "0 Ereignisse");
  assert.equal(P.withUnit("1,5", "Ereignisse", "Ereignis"), "1,5 Ereignisse");
  assert.equal(P.withUnit("11", "Ereignisse", "Ereignis"), "11 Ereignisse");
  assert.equal(P.withUnit("1", "kWh"), "1 kWh");
  assert.equal(P.withUnit("1", "%"), "1 %");
});

test("wallToTs: Berlin Winter- und Sommerzeit", () => {
  assert.equal(P.wallToTs(2026, 1, 15, 0, 0, TZ), Date.UTC(2026, 0, 14, 23, 0));
  assert.equal(P.wallToTs(2026, 7, 15, 12, 30, TZ), Date.UTC(2026, 6, 15, 10, 30));
});

test("buildDays: normaler Tag, 15-min-Slots linear", () => {
  const now = Date.UTC(2026, 10, 12, 11, 0); // Do 12.11.2026 12:00 Berlin
  const days = P.buildDays(now, 3, TZ, 15);
  assert.equal(days.length, 4);
  const t = days[3];
  assert.equal(t.isToday, true);
  assert.equal(t.weekday, 3); // Donnerstag
  assert.equal(t.b.length, 97);
  assert.equal(t.b[0], Date.UTC(2026, 10, 11, 23, 0));
  assert.equal(t.b[48] - t.b[0], 12 * H);
  assert.equal(days[0].weekday, 0); // Mo 09.11.
});

test("buildDays: Zeitumstellung Frühjahr (23 h) und Herbst (25 h)", () => {
  const spring = P.buildDays(Date.UTC(2026, 2, 29, 12, 0), 0, TZ, 15)[0];
  assert.equal(spring.end - spring.start, 23 * H);
  const autumn = P.buildDays(Date.UTC(2026, 9, 25, 12, 0), 0, TZ, 60)[0];
  assert.equal(autumn.end - autumn.start, 25 * H);
  for (const d of [spring, autumn]) {
    for (let k = 1; k < d.b.length; k++) assert.ok(d.b[k] >= d.b[k - 1], "monoton");
  }
  // Frühjahr: 02:00–03:00 gibt es nicht, 01:45–02:00 bleibt 15 min
  assert.equal(spring.b[12] - spring.b[8], 0);
  assert.equal(spring.b[8] - spring.b[7], 15 * M);
  assert.equal(spring.b[8], Date.UTC(2026, 2, 29, 1, 0));
  // Herbst: 02:00 ist das erste Auftreten, die Stunde 02–03 umfasst beide
  assert.equal(autumn.b[2], Date.UTC(2026, 9, 25, 0, 0));
  assert.equal(autumn.b[3] - autumn.b[2], 2 * H);
  // 12:00 Ortszeit stimmt nach der Umstellung
  assert.equal(spring.b[48], Date.UTC(2026, 2, 29, 10, 0));
  assert.equal(autumn.b[12], Date.UTC(2026, 9, 25, 11, 0));
});

/* ---- Aggregation ---- */

const oneDay = (slot, nowOffsetH = 36) => {
  const start = P.wallToTs(2026, 11, 10, 0, 0, TZ);
  return { start, days: P.buildDays(start + nowOffsetH * H, 1, TZ, slot) };
};

test("accumulateStats: Mittel aus 5-min-Zeilen, Summe aus Stundenzeilen verteilt", () => {
  const { start, days } = oneDay(15);
  const rows = [];
  for (let i = 0; i < 12; i++) rows.push({ start: start + i * 5 * M, end: start + (i + 1) * 5 * M, mean: i < 3 ? 100 : 200 });
  P.accumulateStats(days, rows, "mean", "5minute");
  const v = P.dayValues(days[0], "mean", start + 48 * H, false);
  assert.equal(v[0], 100);
  assert.equal(v[1], 200);
  assert.equal(v[4], null);

  const d2 = oneDay(15).days;
  P.accumulateStats(d2, [{ start, end: start + H, change: 1.2 }], "sum", "hour");
  const s = P.dayValues(d2[0], "sum", start + 48 * H, false);
  for (let k = 0; k < 4; k++) near(s[k], 0.3, 1e-12);
});

test("accumulateHistory: Anteil aktiv, unbekannt zählt nicht, Ereignisse", () => {
  const { start, days } = oneDay(60);
  const t = (h, m = 0) => (start + h * H + m * M) / 1000;
  const entries = [
    { s: "off", lu: t(0) },
    { s: "on", lu: t(10) },
    { s: "off", lu: t(10, 30) },
    { s: "unavailable", lu: t(11) },
    { s: "on", lu: t(11, 30) }, // nach unavailable: kein Ereignis
    { s: "off", lu: t(11, 45) },
    { s: "on", lu: t(12, 10) },
    { s: "off", lu: t(12, 20) },
    { s: "on", lu: t(12, 40) },
    { s: "off", lu: t(12, 50) },
  ];
  P.accumulateHistory(days, entries, start, start + 24 * H, "binary_sensor", "state");
  const now = start + 48 * H;
  const act = P.dayValues(days[0], "active", now, false);
  const ev = P.dayValues(days[0], "events", now, false);
  assert.equal(act[9], 0);
  assert.equal(act[10], 50);
  near(act[11], 50, 1e-9, "15 von 30 bekannten Minuten");
  near(act[12], (20 / 60) * 100, 1e-9);
  assert.equal(ev[10], 1);
  assert.equal(ev[11], 0);
  assert.equal(ev[12], 2);
});

test("accumulateHistory: numerisch zeitgewichtet", () => {
  const { start, days } = oneDay(60);
  P.accumulateHistory(days, [{ s: "10", lu: start / 1000 }, { s: "20", lu: (start + 15 * M) / 1000 }, { s: "unavailable", lu: (start + 30 * M) / 1000 }], start, start + H, "sensor", "numeric");
  const v = P.dayValues(days[0], "mean", start + 48 * H, false);
  assert.equal(v[0], 15);
});

test("quantile und slotStats", () => {
  assert.equal(P.quantile([1, 2, 3, 4, 5], 0.25), 2);
  assert.equal(P.quantile([1, 2], 0.5), 1.5);
  const st = P.slotStats([[1, null], [3, null], [2, 5]], 2);
  const r0 = { ...st[0] };
  near(r0.p10, 1.2, 1e-9);
  near(r0.p90, 2.8, 1e-9);
  delete r0.p10;
  delete r0.p90;
  assert.deepEqual(r0, { n: 3, mean: 2, min: 1, max: 3, p25: 1.5, p75: 2.5 });
  assert.equal(st[1].n, 1);
});

test("computeModel graph: Referenz ohne heute, Wochentagsfilter, kumuliert", () => {
  const now = P.wallToTs(2026, 11, 12, 12, 0, TZ); // Do 12:00
  const days = P.buildDays(now, 7, TZ, 60);
  // jeder Tag: Wert = Tag des Monats, je Stunde 1 kWh
  for (const d of days) {
    for (let k = 0; k < 24; k++) {
      if (d.b[k] >= now) break;
      P.accumulateStats([d], [{ start: d.b[k], end: d.b[k + 1], change: d.ymd.d }], "sum", "hour");
    }
  }
  const all = P.computeModel(days, { statistic: "sum", now, weekdays: P.selectedWeekdays({}), mode: "graph" });
  assert.equal(all.expectedDays, 7);
  assert.equal(all.references[0].stats[0].n, 7);
  near(all.references[0].stats[0].mean, (5 + 6 + 7 + 8 + 9 + 10 + 11) / 7);
  assert.equal(all.todayVals[11], 12);
  assert.equal(all.todayVals[12], null);

  const thu = P.computeModel(days, { statistic: "sum", now, weekdays: P.selectedWeekdays({ weekdays: ["thu"] }), mode: "graph" });
  assert.equal(thu.expectedDays, 1);
  assert.equal(thu.references[0].stats[0].mean, 5);

  const cum = P.computeModel(days, { statistic: "sum", now, weekdays: P.selectedWeekdays({}), mode: "graph", cumulative: true });
  near(cum.references[0].stats[23].mean, 24 * (56 / 7));
  assert.equal(cum.todayVals[11], 12 * 12);
  assert.equal(cum.todayVals[12], null);
});

test("computeModel heatmap: nur gewählte Wochentage, heute nur abgeschlossene Slots", () => {
  const now = P.wallToTs(2026, 11, 12, 12, 30, TZ); // Do 12:30
  const days = P.buildDays(now, 14, TZ, 60);
  for (const d of days) {
    P.accumulateHistory([d], [{ s: d.weekday === 3 ? "on" : "off", lu: d.start / 1000 }], d.start, Math.min(d.end, now), "binary_sensor", "state");
  }
  const m = P.computeModel(days, { statistic: "active", now, weekdays: P.selectedWeekdays({ weekdays: ["mon", "thu"] }), mode: "heatmap" });
  assert.equal(m.rows.length, 2);
  const thu = m.rows.find((r) => r.weekday === 3);
  assert.equal(thu.cells[11].n, 3); // 29.10., 05.11., heute
  assert.equal(thu.cells[12].n, 2); // heute 12–13 Uhr noch offen
  assert.equal(thu.cells[12].value, 100);
  assert.equal(m.rows.find((r) => r.weekday === 0).cells[5].value, 0);
});


test("bandsFor: beide Bänder, Rückfall bei wenigen Tagen, Vergleich nur innen", () => {
  const keys = (r) => [...r.bands].map((b) => b.key).join(",") + (r.wideDropped ? " (ohne 10–90)" : "");
  assert.equal(keys(P.bandsFor(undefined, 20, false)), "wide,iqr");
  assert.equal(keys(P.bandsFor("both", 8, false)), "iqr (ohne 10–90)");
  assert.equal(keys(P.bandsFor("both", 3, false)), "minmax");
  assert.equal(keys(P.bandsFor("both", 20, true)), "iqr");
  assert.equal(keys(P.bandsFor("wide", 20, true)), "wide");
  assert.equal(keys(P.bandsFor("wide", 6, false)), "iqr (ohne 10–90)");
  assert.equal(keys(P.bandsFor("iqr", 20, false)), "iqr");
  assert.equal(keys(P.bandsFor("none", 20, false)), "");
});

test("buildGraph: zwei Bänder ab 10 Tagen, Legende innen vor außen", () => {
  const now = P.wallToTs(2026, 11, 12, 12, 0, TZ);
  const days = filledDays(now, 14, (d, k) => 100 + d.ymd.d + k);
  const m = P.computeModel(days, { statistic: "mean", now, mode: "graph", groups: [{ key: "reference", weekdays: new Set([0, 1, 2, 3, 4, 5, 6]) }] });
  const g = P.buildGraph(m, {
    colors: { today: "#00f", refs: { reference: "#888" } },
    label: { today: "Heute", refs: { reference: "Referenz (Ø)" }, bandName: (r, key) => key, daysN: (n) => `${n}`, daysShort: (n) => `${n}`, wideNeedsDays: (n) => `ab ${n}` },
    fmtNumber: (x) => String(Math.round(x)), fmtTime: () => "t", unit: "W",
  });
  assert.deepEqual([...g.data].map((x) => x.id), ["band-low-reference-wide", "band-reference-wide", "band-low-reference-iqr", "band-reference-iqr", "ref-reference", "today"]);
  assert.deepEqual([...g.options.legend.data].map((x) => x.name), ["Heute", "Referenz (Ø)", "iqr", "wide"]);
  const wide = g.data.find((x) => x.id === "band-reference-wide");
  const iqr = g.data.find((x) => x.id === "band-reference-iqr");
  assert.ok(wide.areaStyle.opacity < iqr.areaStyle.opacity);
  const ref = g.data.find((x) => x.id === "ref-reference").data;
  const tip = g.options.tooltip.formatter([{ value: ref[5] }]).textContent;
  assert.ok(tip.indexOf("iqr") < tip.indexOf("wide"), tip);
  assert.ok(!/ab 10/.test(tip));
});


test("y-Achse: Nachkommastellen aus dem Tick-Abstand wie in HA", () => {
  assert.equal(P.axisFractionDigits(1.84, 2.21), 1); // E10: Schritte 0,1
  assert.equal(P.axisFractionDigits(120, 1840), 0);
  assert.equal(P.axisFractionDigits(0.12, 0.18), 2);
  assert.equal(P.axisFractionDigits(5, 5), 1);
  assert.equal(P.axisFractionDigits(0, 100), 0);
  assert.equal(P.niceInterval(0.074), 0.1);
  assert.equal(P.niceInterval(0.06), 0.05);
  const f = P.makeAxisFormatter({ locale: { language: "de", number_format: "language" } });
  assert.equal(f(2, 1), "2,0");
  assert.equal(f(1.9, 1), "1,9");
  assert.equal(f(0, 1), "0");
  assert.equal(f(1500, 0), "1.500");
});

/* ---- Typen, Farben ---- */

test("detectKind und guessKind", () => {
  const st = (id, state, attributes = {}) => ({ entity_id: id, state, attributes });
  assert.equal(P.detectKind(st("sensor.p", "5", {}), { has_sum: false, mean_type: 1 }), "measurement");
  assert.equal(P.detectKind(st("sensor.e", "5", {}), { has_sum: true, mean_type: 0 }), "counter");
  assert.equal(P.detectKind(st("sensor.w", "5", {}), { has_sum: false, mean_type: 2 }), "unsupported");
  assert.equal(P.detectKind(st("sensor.x", "unavailable", { unit_of_measurement: "W" }), null), "numeric");
  assert.equal(P.detectKind(st("sensor.text", "abc", {}), null), "state");
  assert.equal(P.detectKind(st("binary_sensor.m", "on", {}), null), "state");
  assert.equal(P.detectKind(st("event.door", "2026-11-12T10:00:00", {}), null), "timestamp");
  assert.equal(P.guessKind(st("sensor.e", "1", { state_class: "total_increasing" })), "counter");
  assert.equal(P.resolveStatistic("mean", "state"), "active");
  assert.equal(P.resolveStatistic("events", "state"), "events");
});

test("Farben", () => {
  assert.equal(P.cssColor("red"), "var(--red-color)");
  assert.equal(P.cssColor([1, 2, 3]), "rgb(1,2,3)");
  assert.deepEqual([...P.parseRgb("#ff8000")], [255, 128, 0, 1]);
  assert.deepEqual([...P.parseRgb("rgba(1, 2, 3, 0.5)")], [1, 2, 3, 0.5]);
  assert.deepEqual([...P.interpolateStops([[0, 0, 0, 0], [100, 200, 50, 1]], 0.5)], [50, 100, 25, 0.5]);
  assert.match(P.defaultColor({ entity_id: "binary_sensor.m", attributes: { device_class: "motion" } }, "state"), /--state-binary_sensor-motion-on-color/);
});

/* ---- Karte mit gemocktem hass ---- */

const makeHass = (states, handler) => {
  const calls = [];
  return {
    calls,
    hass: {
      locale: { language: "de", number_format: "language", time_format: "24", time_zone: "server" },
      config: { time_zone: TZ },
      states,
      entities: {},
      themes: { darkMode: false },
      callWS: async (msg) => { calls.push(msg); return handler(msg); },
    },
  };
};

const mount = (config, hassObj) => {
  const el = w.document.createElement("pattern-card");
  el.setConfig(config);
  w.document.body.appendChild(el);
  el.hass = hassObj;
  return el;
};

test("Karte heatmap: Bewegungsmelder aus dem Verlauf", async () => {
  const now = Date.now();
  const entries = [];
  for (let t = now - 30 * 24 * H; t < now; t += 6 * H) {
    entries.push({ s: "on", lu: t / 1000 }, { s: "off", lu: (t + 30 * M) / 1000 });
  }
  const { hass, calls } = makeHass(
    { "binary_sensor.bewegung": { entity_id: "binary_sensor.bewegung", state: "off", attributes: { friendly_name: "Bewegung Gäste-WC", device_class: "motion" } } },
    (msg) => {
      if (msg.type === "recorder/get_statistics_metadata") return [];
      if (msg.type === "history/history_during_period") {
        const s = Date.parse(msg.start_time) / 1000;
        const e = Date.parse(msg.end_time) / 1000;
        return { "binary_sensor.bewegung": entries.filter((x) => x.lu >= s && x.lu < e) };
      }
      throw new Error(`unerwartet: ${msg.type}`);
    }
  );
  const el = mount({ type: "custom:pattern-card", entity: "binary_sensor.bewegung", mode: "heatmap", days: 14 }, hass);
  await flush();
  const root = el.shadowRoot;
  assert.equal(root.querySelector(".title").textContent, "Bewegung Gäste-WC");
  assert.match(root.querySelector(".sub").textContent, /14 Tage/);
  // Pfeil zum Verlauf wie bei history-graph: Entity und Beginn des ausgewerteten Zeitraums
  const link = root.querySelector(".card-header a.history");
  const url = new URL(link.getAttribute("href"), "http://ha.local");
  assert.equal(url.pathname, "/history");
  assert.equal(url.searchParams.get("entity_id"), "binary_sensor.bewegung");
  assert.equal(url.searchParams.get("back"), "1");
  const startDays = (Date.now() - Date.parse(url.searchParams.get("start_date"))) / 864e5;
  assert.ok(startDays > 14 && startDays < 16, `start_date ${startDays} Tage zurück`);
  assert.equal(link.getAttribute("aria-label"), "Verlauf");
  assert.ok(link.querySelector("ha-icon-next"));
  el.setConfig({ type: "custom:pattern-card", entity: "binary_sensor.bewegung", mode: "heatmap", days: 14, hide_subtitle: true });
  await flush();
  assert.equal(root.querySelector(".sub").hidden, true);
  assert.equal(root.querySelector(".sub").textContent, "");
  // Abstand zwischen Titel und Raster auch ohne Untertitel
  assert.ok(root.querySelector(".content").classList.contains("heatmap"));
  assert.match(root.querySelector("style").textContent, /\.content\.heatmap\.has-header:not\(\.no-name\) \{ padding-top: 12px; \}/);
  assert.equal(root.querySelector(".title").textContent, "Bewegung Gäste-WC");
  assert.equal(root.querySelector(".card-header").hidden, false);
  el.setConfig({ type: "custom:pattern-card", entity: "binary_sensor.bewegung", mode: "heatmap", days: 14, hide_subtitle: true, name: false });
  await flush();
  assert.equal(root.querySelector(".card-header").hidden, true);
  el.setConfig({ type: "custom:pattern-card", entity: "binary_sensor.bewegung", mode: "heatmap", days: 14, hide_subtitle: true, name: " " });
  await flush();
  assert.equal(root.querySelector(".card-header").hidden, true);
  // das hidden-Attribut muss auch gegen display: flex aus dem Stylesheet greifen.
  // jsdom rechnet Stylesheets im Shadow DOM nicht aus, daher nur die Regel prüfen (Sichtprüfung im Browser)
  assert.match(root.querySelector("style").textContent, /\[hidden\]\s*\{\s*display:\s*none !important;/);
  el.setConfig({ type: "custom:pattern-card", entity: "binary_sensor.bewegung", mode: "heatmap", days: 14 });
  await flush();
  const cells = root.querySelectorAll(".cell");
  assert.equal(cells.length, 7 * 24);
  assert.ok([...cells].some((c) => /rgba/.test(c.getAttribute("style") || "")), "Zellen eingefärbt");
  assert.equal(root.querySelectorAll(".wd").length, 7);
  assert.equal(root.querySelectorAll(".hour").length, 8);
  assert.ok(calls.every((c) => c.type !== "recorder/statistics_during_period"));
  // Tooltip
  const cell = [...cells].find((c) => c.getAttribute("style"));
  cell.dispatchEvent(new w.MouseEvent("pointerover", { bubbles: true }));
  const tip = root.querySelector(".tooltip");
  assert.equal(tip.hidden, false);
  assert.match(tip.textContent, /Anteil aktiv: \d+ %/);
  assert.match(tip.textContent, /Ø aus \d+ Tagen/);
  // Maus verlässt die Heatmap: Tooltip weg
  const leave = new w.Event("pointerleave");
  leave.pointerType = "mouse";
  root.querySelector(".content > .heatmap").dispatchEvent(leave);
  assert.equal(tip.hidden, true);
  // Touch: Tippen zeigt, pointerleave (kommt bei Touch vor dem click) lässt ihn stehen,
  // erneutes Tippen auf dieselbe Zelle und Tippen außerhalb blenden ihn aus
  const tap = (target, where = target) => {
    const down = new w.Event("pointerdown", { bubbles: true, composed: true });
    down.pointerType = "touch";
    where.dispatchEvent(down);
    const lv = new w.Event("pointerleave");
    lv.pointerType = "touch";
    root.querySelector(".content > .heatmap").dispatchEvent(lv);
    target.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  };
  tap(cell);
  assert.equal(tip.hidden, false, "Tippen zeigt den Tooltip");
  tap(cell);
  assert.equal(tip.hidden, true, "zweites Tippen auf dieselbe Zelle schließt ihn");
  tap(cell);
  const other = [...cells].find((c) => c !== cell);
  tap(other);
  assert.equal(tip.hidden, false, "andere Zelle: Tooltip wechselt");
  assert.ok(other.classList.contains("hover") && !cell.classList.contains("hover"));
  const outside = new w.Event("pointerdown", { bubbles: true, composed: true });
  outside.pointerType = "touch";
  w.document.body.dispatchEvent(outside);
  assert.equal(tip.hidden, true, "Tippen außerhalb schließt ihn");
  el.remove();
});

test("Karte graph: Messwert aus der Statistik an ha-chart-base, ohne Zoom", async () => {
  class Stub extends w.HTMLElement {}
  if (!w.customElements.get("ha-chart-base")) w.customElements.define("ha-chart-base", Stub);
  const now = Date.now();
  const rows = (start, end, period) => {
    const step = period === "hour" ? H : 5 * M;
    const out = [];
    for (let t = Math.ceil(start / step) * step; t + step <= end; t += step) out.push({ start: t, end: t + step, mean: 500 + Math.floor(((t + P.tzOffset(t, TZ)) / H) % 24) * 10 });
    return out;
  };
  const { hass, calls } = makeHass(
    { "sensor.leistung": { entity_id: "sensor.leistung", state: "640", attributes: { friendly_name: "Leistung", unit_of_measurement: "W", state_class: "measurement" } } },
    (msg) => {
      if (msg.type === "recorder/get_statistics_metadata") return [{ statistic_id: "sensor.leistung", has_sum: false, mean_type: 1, unit_class: "power", statistics_unit_of_measurement: "W" }];
      if (msg.type === "recorder/statistics_during_period") return { "sensor.leistung": rows(Date.parse(msg.start_time), Math.min(Date.parse(msg.end_time), now), msg.period) };
      throw new Error(`unerwartet: ${msg.type}`);
    }
  );
  const el = mount({ type: "custom:pattern-card", entity: "sensor.leistung", days: 7, reference: "all" }, hass);
  await flush(20);
  const chart = el.shadowRoot.querySelector("ha-chart-base");
  assert.ok(chart, "ha-chart-base eingesetzt");
  const ids = [...chart.data].map((s) => s.id);
  assert.deepEqual(ids, ["band-low-reference-iqr", "band-reference-iqr", "ref-reference", "today"]);
  assert.ok(Array.isArray(chart.options.dataZoom) && chart.options.dataZoom.length === 0);
  assert.equal(chart.zoomSlider, "never");
  assert.equal(chart.options.legend.show, true);
  el.setConfig({ type: "custom:pattern-card", entity: "sensor.leistung", days: 7, reference: "all", hide_legend: true });
  await flush(20);
  assert.equal(el.shadowRoot.querySelector("ha-chart-base").options.legend.show, false);
  assert.equal(chart.options.xAxis[0].type, "time");
  assert.equal(chart.options.yAxis.name, "W");
  assert.equal(chart.options.yAxis.axisLabel.formatter(600), "600");
  assert.equal(chart.options.xAxis[0].axisLabel.showMaxLabel, false);
  assert.ok(el.shadowRoot.querySelector(".content").classList.contains("graph"));
  assert.match(el.shadowRoot.querySelector("style").textContent, /\.content\.graph, \.content\.graph\.no-name \{ padding: 0 16px 8px; \}/);
  const stat = calls.filter((c) => c.type === "recorder/statistics_during_period");
  assert.ok(stat.some((c) => c.period === "5minute"));
  assert.deepEqual({ ...stat[0].units }, { power: "W" });
  // Referenz: 96 Punkte, Mittel je Slot = Stundenwert
  const ref = chart.data.find((s) => s.id === "ref-reference").data;
  assert.equal(ref.length, 96);
  near(ref[4][1], 510, 1e-9);
  // Tooltip
  const tipEl = chart.options.tooltip.formatter([{ value: ref[4] }]);
  assert.match(tipEl.textContent, /01:00 – 01:15/);
  assert.match(tipEl.textContent, /Referenz \(Ø\): 510 W/);
  assert.match(tipEl.textContent, /Spanne 10–90 % ab 10 Tagen/);
  el.remove();
});

test("Karte graph: Fallback auf Stundenstatistik, wenn 5-min nicht weit genug reicht", async () => {
  const now = Date.now();
  const { hass } = makeHass(
    { "sensor.zaehler": { entity_id: "sensor.zaehler", state: "1000", attributes: { unit_of_measurement: "kWh", state_class: "total_increasing" } } },
    (msg) => {
      if (msg.type === "recorder/get_statistics_metadata") return [{ statistic_id: "sensor.zaehler", has_sum: true, mean_type: 0, unit_class: "energy" }];
      const s = Date.parse(msg.start_time);
      const step = msg.period === "hour" ? H : 5 * M;
      const from = msg.period === "hour" ? s : Math.max(s, now - 3 * 24 * H);
      const out = [];
      for (let t = Math.ceil(from / step) * step; t + step <= Math.min(Date.parse(msg.end_time), now); t += step) out.push({ start: t, end: t + step, change: step / H });
      return { "sensor.zaehler": out };
    }
  );
  const el = mount({ type: "custom:pattern-card", entity: "sensor.zaehler", days: 10, cumulative: true }, hass);
  await flush(20);
  const chart = el.shadowRoot.querySelector("ha-chart-base");
  assert.match(el.shadowRoot.querySelector(".sub").textContent, /stündlich/);
  const ref = chart.data.find((s) => s.id.startsWith("ref-")).data;
  assert.equal(ref.length, 25); // Mitternacht + 24 Stunden
  near(ref[24][1], 24, 1e-9);
  el.remove();
});

test("Karte: fehlende Entity zeigt Warnung", async () => {
  const { hass } = makeHass({}, () => []);
  const el = mount({ type: "custom:pattern-card", entity: "sensor.fehlt" }, hass);
  await flush();
  assert.match(el.shadowRoot.querySelector("ha-alert").textContent, /sensor\.fehlt/);
  el.remove();
});

test("setConfig prüft Eingaben", () => {
  const el = w.document.createElement("pattern-card");
  assert.throws(() => el.setConfig({}), /entity/);
  assert.throws(() => el.setConfig({ entity: "sensor.x", mode: "pie" }), /mode/);
  assert.throws(() => el.setConfig({ entity: "sensor.x", resolution: "7min" }), /resolution/);
  assert.throws(() => el.setConfig({ entity: "sensor.x", compare: "month" }), /compare/);
  assert.throws(() => el.setConfig({ entity: "sensor.x", reference: "same" }), /reference/);
  assert.throws(() => el.setConfig({ entity: "sensor.x", band: "sigma" }), /band/);
});


/* ---- Vergleich Werktage/Wochenende ---- */

test("referenceGroups: automatisch wie heute, Vergleich, eigene Wochentage", () => {
  const keys = (g) => [...g].map((x) => `${x.key}:${[...x.weekdays].join("")}`);
  assert.deepEqual(keys(P.referenceGroups({}, 3)), ["workday:01234"]);
  assert.deepEqual(keys(P.referenceGroups({}, 6)), ["weekend:56"]);
  assert.deepEqual(keys(P.referenceGroups({ reference: "all" }, 6)), ["reference:0123456"]);
  assert.deepEqual(keys(P.referenceGroups({ weekdays: ["mon", "sun"] }, 3)), ["reference:06"]);
  assert.deepEqual(keys(P.referenceGroups({ compare: "weekday_weekend" }, 3)), ["workday:01234", "weekend:56"]);
  assert.deepEqual(keys(P.referenceGroups({ compare: "weekday_weekend", weekdays: ["mon", "tue"] }, 3)), ["workday:01"]);
  assert.deepEqual(keys(P.heatmapRows({ compare: "weekday_weekend" })), ["workday:01234", "weekend:56"]);
  assert.equal(P.heatmapRows({}).length, 7);
});

const filledDays = (now, nDays, valueOf) => {
  const days = P.buildDays(now, nDays, TZ, 60);
  for (const d of days) {
    for (let k = 0; k < 24; k++) {
      if (d.b[k] >= now) break;
      P.accumulateStats([d], [{ start: d.b[k], end: d.b[k + 1], mean: valueOf(d, k) }], "mean", "hour");
    }
  }
  return days;
};

test("computeModel: zwei Referenzen und Differenzzeile", () => {
  const now = P.wallToTs(2026, 11, 12, 12, 0, TZ); // Do
  const val = (d, k) => (d.weekday >= 5 ? 300 : 100) + k;
  const days = filledDays(now, 14, val);
  const cfg = { compare: "weekday_weekend" };
  const g = P.computeModel(days, { statistic: "mean", now, mode: "graph", groups: P.referenceGroups(cfg, 3) });
  assert.equal(g.references.length, 2);
  assert.equal(g.references[0].stats[5].mean, 105);
  assert.equal(g.references[1].stats[5].mean, 305);
  assert.equal(g.references[0].expectedDays, 10);
  assert.equal(g.references[1].expectedDays, 4);
  const h = P.computeModel(days, { statistic: "mean", now, mode: "heatmap", rows: P.heatmapRows(cfg), difference: true });
  assert.equal(h.rows.length, 2);
  assert.equal(h.diff[5].value, 200);
  assert.equal(h.diff[5].n, 4);
});

test("Karte graph: Vergleich mit zwei Referenzen und eigenen Farben", async () => {
  const now = Date.now();
  const { hass } = makeHass(
    { "sensor.leistung": { entity_id: "sensor.leistung", state: "640", attributes: { unit_of_measurement: "W", state_class: "measurement" } } },
    (msg) => {
      if (msg.type === "recorder/get_statistics_metadata") return [{ statistic_id: "sensor.leistung", has_sum: false, mean_type: 1 }];
      const step = msg.period === "hour" ? H : 5 * M;
      const out = [];
      for (let t = Math.ceil(Date.parse(msg.start_time) / step) * step; t + step <= Math.min(Date.parse(msg.end_time), now); t += step) out.push({ start: t, end: t + step, mean: 400 });
      return { "sensor.leistung": out };
    }
  );
  const el = mount({ type: "custom:pattern-card", entity: "sensor.leistung", days: 14, compare: "weekday_weekend" }, hass);
  await flush(20);
  const chart = el.shadowRoot.querySelector("ha-chart-base");
  const ids = [...chart.data].map((s) => s.id);
  assert.deepEqual(ids, ["band-low-workday-iqr", "band-workday-iqr", "ref-workday", "band-low-weekend-iqr", "band-weekend-iqr", "ref-weekend", "today"]);
  const legend = [...chart.options.legend.data].map((x) => x.name);
  assert.deepEqual(legend, ["Heute", "Werktage (Ø)", "Spanne Werktage", "Wochenende (Ø)", "Spanne Wochenende"]);
  el.setConfig({ type: "custom:pattern-card", entity: "sensor.leistung", days: 14, compare: "weekday_weekend", compare_colors: ["#0000ff", "#ff0000"] });
  await flush(20);
  const c2 = el.shadowRoot.querySelector("ha-chart-base");
  assert.deepEqual([...P.parseRgb(c2.data.find((s) => s.id === "ref-workday").color)].slice(0, 3), [0, 0, 255]);
  assert.deepEqual([...P.parseRgb(c2.data.find((s) => s.id === "ref-weekend").color)].slice(0, 3), [255, 0, 0]);
  el.setConfig({ type: "custom:pattern-card", entity: "sensor.leistung", days: 14, compare: "weekday_weekend" });
  await flush(20);
  const ref = chart.data.find((s) => s.id === "ref-workday").data;
  const tip = chart.options.tooltip.formatter([{ value: ref[40] }]).textContent;
  assert.match(tip, /Werktage \(Ø\): 400 W \(\d+ Tage\)/);
  assert.match(tip, /Wochenende \(Ø\): 400 W/);
  el.remove();
});

test("Karte heatmap: Gruppenzeilen und Differenzzeile", async () => {
  const now = Date.now();
  const entries = [];
  for (let t = now - 21 * 24 * H; t < now; t += 3 * H) entries.push({ s: "on", lu: t / 1000 }, { s: "off", lu: (t + 20 * M) / 1000 });
  const { hass } = makeHass(
    { "binary_sensor.b": { entity_id: "binary_sensor.b", state: "off", attributes: { device_class: "motion" } } },
    (msg) => {
      if (msg.type === "recorder/get_statistics_metadata") return [];
      const s = Date.parse(msg.start_time) / 1000;
      const e = Date.parse(msg.end_time) / 1000;
      return { "binary_sensor.b": entries.filter((x) => x.lu >= s && x.lu < e) };
    }
  );
  const el = mount({ type: "custom:pattern-card", entity: "binary_sensor.b", mode: "heatmap", days: 14, compare: "weekday_weekend" }, hass);
  await flush();
  const root = el.shadowRoot;
  assert.deepEqual([...root.querySelectorAll(".wd")].map((x) => x.textContent), ["Mo–Fr", "Sa–So", "Δ"]);
  assert.equal(root.querySelectorAll(".cell").length, 3 * 24);
  assert.equal(root.querySelectorAll(".legend").length, 2);
  const d = [...root.querySelectorAll(".cell.diff")].find((c) => c.getAttribute("style"));
  if (d) {
    d.dispatchEvent(new w.MouseEvent("pointerover", { bubbles: true }));
    assert.match(root.querySelector(".tooltip").textContent, /Wochenende − Werktage: [+−-]?\d/);
  }
  el.remove();
  const el2 = mount({ type: "custom:pattern-card", entity: "binary_sensor.b", mode: "heatmap", days: 14, compare: "weekday_weekend", difference: false }, hass);
  await flush();
  assert.equal(el2.shadowRoot.querySelectorAll(".wd").length, 2);
  el2.setConfig({ type: "custom:pattern-card", entity: "binary_sensor.b", mode: "heatmap", days: 14, hide_legend: true });
  await flush();
  assert.equal(el2.shadowRoot.querySelectorAll(".legend").length, 0);
  assert.equal(el2.shadowRoot.querySelectorAll(".cell").length, 7 * 24);
  el2.remove();
});


/* ---- Vorher/Nachher ---- */

test("Vorher/Nachher: Gruppen am Stichtag, Modell und Differenz", () => {
  const now = P.wallToTs(2026, 11, 20, 12, 0, TZ);
  // ab 12.11. halber Wert
  const days = filledDays(now, 14, (d) => (d.ymd.m === 11 && d.ymd.d >= 12 ? 50 : 100));
  const cfg = { compare: "before_after", since: "2026-11-12" };
  const groups = P.referenceGroups(cfg, 4);
  assert.deepEqual([...groups].map((g) => g.key), ["before", "after"]);
  const g = P.computeModel(days, { statistic: "mean", now, mode: "graph", groups });
  assert.equal(g.references[0].expectedDays, 6); // 06.–11.11.
  assert.equal(g.references[1].expectedDays, 8); // 12.–19.11., heute zählt nicht
  assert.equal(g.references[0].stats[3].mean, 100);
  assert.equal(g.references[1].stats[3].mean, 50);
  const h = P.computeModel(days, { statistic: "mean", now, mode: "heatmap", rows: P.heatmapRows(cfg), difference: true });
  assert.deepEqual([...h.rows].map((r) => r.key), ["before", "after"]);
  assert.equal(h.diff[3].value, -50);
  // Stichtag vor dem Zeitraum: nur noch „nachher“, keine Differenz
  const h2 = P.computeModel(days, { statistic: "mean", now, mode: "heatmap", rows: P.heatmapRows({ compare: "before_after", since: "2026-01-01" }), difference: true });
  assert.deepEqual([...h2.rows].map((r) => r.key), ["after"]);
  assert.equal(h2.diff, undefined);
  // Wochentagsfilter gilt in beiden Gruppen
  const g3 = P.computeModel(days, { statistic: "mean", now, mode: "graph", groups: P.referenceGroups({ ...cfg, weekdays: ["mon"] }, 4) });
  assert.deepEqual([...g3.references].map((r) => r.expectedDays), [1, 1]); // Montage 09.11. | 16.11. (20.11. ist ein Freitag)
});

test("Karte heatmap: Vorher/Nachher mit Beschriftung und Differenztexten", async () => {
  const now = Date.now();
  const entries = [];
  for (let t = now - 20 * 24 * H; t < now; t += 2 * H) entries.push({ s: "on", lu: t / 1000 }, { s: "off", lu: (t + 10 * M) / 1000 });
  const { hass } = makeHass(
    { "binary_sensor.pumpe": { entity_id: "binary_sensor.pumpe", state: "off", attributes: { device_class: "running" } } },
    (msg) => {
      if (msg.type === "recorder/get_statistics_metadata") return [];
      const a = Date.parse(msg.start_time) / 1000;
      const b = Date.parse(msg.end_time) / 1000;
      return { "binary_sensor.pumpe": entries.filter((x) => x.lu >= a && x.lu < b) };
    }
  );
  const since = new Date(now - 7 * 24 * H);
  const iso = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, "0")}-${String(since.getDate()).padStart(2, "0")}`;
  const el = mount({ type: "custom:pattern-card", entity: "binary_sensor.pumpe", mode: "heatmap", days: 14, statistic: "events", compare: "before_after", since: iso }, hass);
  await flush();
  const root = el.shadowRoot;
  const labels = [...root.querySelectorAll(".wd")].map((x) => x.textContent);
  assert.equal(labels.length, 3);
  assert.match(labels[0], /^Vor \d+\. /);
  assert.match(labels[1], /^Ab \d+\. /);
  assert.equal(labels[2], "Δ");
  assert.match(root.querySelectorAll(".legend")[1].textContent, /mehr vorher.*mehr nachher/);
  el.remove();
});

test("Karte graph: Vorher/Nachher-Legende und Prüfung des Stichtags", async () => {
  const el = w.document.createElement("pattern-card");
  assert.throws(() => el.setConfig({ entity: "sensor.x", compare: "before_after" }), /since/);
  assert.throws(() => el.setConfig({ entity: "sensor.x", compare: "before_after", since: "12.11.2026" }), /since/);
  const now = Date.now();
  const { hass } = makeHass(
    { "sensor.p": { entity_id: "sensor.p", state: "1", attributes: { unit_of_measurement: "W", state_class: "measurement" } } },
    (msg) => {
      if (msg.type === "recorder/get_statistics_metadata") return [{ statistic_id: "sensor.p", has_sum: false, mean_type: 1 }];
      const step = msg.period === "hour" ? H : 5 * M;
      const out = [];
      for (let t = Math.ceil(Date.parse(msg.start_time) / step) * step; t + step <= Math.min(Date.parse(msg.end_time), now); t += step) out.push({ start: t, end: t + step, mean: 10 });
      return { "sensor.p": out };
    }
  );
  const card = mount({ type: "custom:pattern-card", entity: "sensor.p", days: 14, compare: "before_after", since: "2020-01-01" }, hass);
  await flush(20);
  // Stichtag lange zurück: vorher bleibt verankert, nachher sind die letzten 14 Tage
  const legend = [...card.shadowRoot.querySelector("ha-chart-base").options.legend.data].map((x) => x.name);
  assert.match(legend[1], /^Vor 1\. Jan\.? \(Ø\)$/);
  assert.match(legend.find((n) => /Letzte/.test(n)), /^Letzte 14 Tage \(Ø\)$/);
  assert.match(card.shadowRoot.querySelector(".sub").textContent, /14 Tage vorher · 14 nachher/);
  card.remove();
});

test("Registrierung: doppelt geladen ohne Fehler, kein globaler Name ohne Testschalter", () => {
  // zweites Laden in dasselbe Fenster (alte und neue Ressource gleichzeitig)
  w.eval(src);
  assert.equal(w.customCards.filter((c) => c.type === "pattern-card").length, 1);
  const d2 = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only", pretendToBeVisual: true });
  d2.window.console.info = () => {};
  d2.window.eval(src);
  assert.equal(d2.window.__patternCard, undefined);
  assert.ok(d2.window.customElements.get("pattern-card"));
  // Vorlage ohne Standardwert days
  const stub = d2.window.customElements.get("pattern-card").getStubConfig({ states: {} });
  assert.equal(stub.days, undefined);
});

test("periodPlan: verankerter Stichtag und relative Zeiträume", () => {
  const { periodPlan } = w.__patternCard;
  const today = { y: 2026, m: 11, d: 13 };
  const k = (ymd) => `${ymd.y}-${ymd.m}-${ymd.d}`;
  const ranges = (pp) => pp.ranges.map((r) => `${k(r.from)}..${k(r.to)}`).join(" ");
  // Stichtag im Fenster: ein Abschnitt, vorher 28 Tage vor dem Stichtag, nachher ab Stichtag
  let pp = periodPlan({ days: 28, compare: "before_after", since: "2026-11-10" }, today);
  assert.equal(ranges(pp), "2026-10-13..2026-11-13");
  assert.deepEqual([pp.before, pp.after, pp.truncated], [28, 3, false]);
  // Stichtag lange zurück (Umzug): zwei Abschnitte mit Lücke, nachher auf die letzten 28 Tage gekürzt
  pp = periodPlan({ days: 28, compare: "before_after", since: "2024-05-01" }, today);
  assert.equal(ranges(pp), "2024-4-3..2024-5-1 2026-10-16..2026-11-13");
  assert.deepEqual([pp.before, pp.after, pp.truncated], [28, 28, true]);
  // Stichtag heute: nur vorher
  pp = periodPlan({ days: 7, compare: "before_after", since: "2026-11-13" }, today);
  assert.equal(ranges(pp), "2026-11-6..2026-11-13");
  assert.deepEqual([pp.before, pp.after], [7, 0]);
  // letzte Woche gegen 8 Wochen davor
  pp = periodPlan({ days: 56, compare: "recent", recent_days: 7 }, today);
  assert.equal(ranges(pp), "2026-9-11..2026-11-13");
  assert.equal(k(pp.split), "2026-11-6");
  assert.deepEqual([pp.before, pp.after], [56, 7]);
  assert.equal(periodPlan({ compare: "recent" }, today).after, 7);
  // ohne Vergleich wie bisher
  assert.equal(ranges(periodPlan({ days: 3 }, today)), "2026-11-10..2026-11-13");
});

test("Karte heatmap: letzte Tage gegen die Zeit davor, Abschnitte mit Lücke", async () => {
  const now = Date.now();
  const calls = [];
  const { hass } = makeHass(
    { "sensor.p": { entity_id: "sensor.p", state: "1", attributes: { unit_of_measurement: "W", state_class: "measurement" } } },
    (msg) => {
      if (msg.type === "recorder/get_statistics_metadata") return [{ statistic_id: "sensor.p", has_sum: false, mean_type: 1 }];
      calls.push([Date.parse(msg.start_time), Date.parse(msg.end_time), msg.period]);
      const out = [];
      for (let t = Math.ceil(Date.parse(msg.start_time) / H) * H; t + H <= Math.min(Date.parse(msg.end_time), now); t += H) {
        // in den letzten 7 Tagen doppelt so viel
        out.push({ start: t, end: t + H, mean: t >= now - 7 * 24 * H ? 20 : 10 });
      }
      return { "sensor.p": out };
    }
  );
  const card = mount({ type: "custom:pattern-card", entity: "sensor.p", mode: "heatmap", days: 21, compare: "recent", recent_days: 7, resolution: "hour" }, hass);
  await flush(20);
  const root = card.shadowRoot;
  const labels = [...root.querySelectorAll(".wd")].map((x) => x.textContent);
  assert.deepEqual(labels.slice(0, 2), ["21 Tage davor", "Letzte 7 Tage"]);
  assert.match(root.querySelector(".sub").textContent, /7 gegen 21 Tage davor/);
  const m = card._model;
  assert.equal(m.rows[0].nDays, 21);
  // Differenz zuletzt − davor ≈ +10 (heute zählt mit seinen abgeschlossenen Stunden zu „zuletzt“)
  const d = m.diff.map((c) => c.value).filter((v) => v != null);
  assert.ok(d.length > 0 && d.every((v) => v > 8 && v <= 10.001), d.join());
  // ein einziger Abschnitt, 28 Tage zurück
  const refCall = calls.find((c) => c[1] - c[0] > 2 * 24 * H);
  assert.ok(Math.abs((refCall[1] - refCall[0]) / (24 * H) - 28) < 0.1);
  card.remove();

  // Umzug vor langer Zeit: zwei getrennte Abfragen, die Lücke wird nicht geladen
  calls.length = 0;
  const card2 = mount({ type: "custom:pattern-card", entity: "sensor.p", mode: "heatmap", days: 14, compare: "before_after", since: "2024-05-01", resolution: "hour" }, hass);
  await flush(20);
  const refCalls = calls.filter((c) => c[1] - c[0] > 2 * 24 * H);
  assert.equal(refCalls.length, 2);
  assert.ok(refCalls.every((c) => Math.abs((c[1] - c[0]) / (24 * H) - 14) < 0.1));
  assert.deepEqual([...card2.shadowRoot.querySelectorAll(".wd")].map((x) => x.textContent).slice(0, 2).map((t) => t.replace(/\.? 2024/, "")), ["Vor 1. Mai", "Letzte 14 Tage"]);
  card2.remove();

  // Stichtag heute: nachher hat noch keinen abgeschlossenen Tag
  const t = new Date();
  const todayStr = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  const card3 = mount({ type: "custom:pattern-card", entity: "sensor.p", mode: "heatmap", days: 14, compare: "before_after", since: todayStr, resolution: "hour" }, hass);
  await flush(20);
  assert.match(card3.shadowRoot.querySelector(".sub").textContent, /^14 Tage vorher · nachher bisher nur heute/);
  card3.remove();
});


test("Farben im Vergleich: compare_colors für Gruppen, difference_colors für die Differenz", async () => {
  const now = Date.now();
  const entries = [];
  // vorher häufiger, nachher seltener → Differenz negativ („weniger“)
  for (let t = now - 20 * 24 * H; t < now; t += (t < now - 7 * 24 * H ? 1 : 3) * H) entries.push({ s: "on", lu: t / 1000 }, { s: "off", lu: (t + 5 * M) / 1000 });
  const { hass } = makeHass(
    { "binary_sensor.t": { entity_id: "binary_sensor.t", state: "off", attributes: { device_class: "running" } } },
    (msg) => {
      if (msg.type === "recorder/get_statistics_metadata") return [];
      const a = Date.parse(msg.start_time) / 1000;
      const b = Date.parse(msg.end_time) / 1000;
      return { "binary_sensor.t": entries.filter((x) => x.lu >= a && x.lu < b) };
    }
  );
  const d = new Date(now - 7 * 24 * H);
  const since = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const el = mount({
    type: "custom:pattern-card", entity: "binary_sensor.t", mode: "heatmap", days: 14, statistic: "events",
    compare: "before_after", since, compare_colors: ["#0000ff", "#ff0000"], difference_colors: ["#00ff00", "#ff00ff"],
  }, hass);
  await flush();
  const diffCells = [...el.shadowRoot.querySelectorAll(".cell.diff")].map((c) => c.getAttribute("style") || "");
  const diff = el._model.diff;
  assert.ok(diff.some((c) => c.value < 0), "Testdaten: nachher weniger");
  diff.forEach((c, k) => {
    if (c.value < 0) assert.match(diffCells[k], /rgba\(0,255,0,/, `Slot ${k}: weniger in Grün`);
    if (c.value > 0) assert.match(diffCells[k], /rgba\(255,0,255,/, `Slot ${k}: mehr in Magenta`);
  });
  el.remove();
  // Zeilen bleiben in der normalen Farbskala, compare_colors wirkt in der Heatmap nicht
  const rowCells = (ri) => [...el.shadowRoot.querySelectorAll(`.cell[data-r="${ri}"]`)].map((c) => c.getAttribute("style") || "").filter(Boolean);
  assert.ok(rowCells(0).length && rowCells(0).every((x) => !/rgba\(0,0,255,|rgba\(0,255,0,/.test(x)), "Zeile vorher unverändert");
  assert.ok(rowCells(1).every((x) => !/rgba\(255,0,0,|rgba\(255,0,255,/.test(x)), "Zeile nachher unverändert");
  assert.equal(el.shadowRoot.querySelectorAll(".legend")[0].querySelectorAll(".bar").length, 1);
  // Tooltip der Differenz: Marker der Zeilen wie die Zellen, nicht in den Differenzfarben
  const dcell = el.shadowRoot.querySelector(".cell.diff[style]");
  dcell.dispatchEvent(new w.MouseEvent("pointerover", { bubbles: true }));
  const markers = [...el.shadowRoot.querySelectorAll(".tooltip .marker")].map((x) => x.getAttribute("style"));
  assert.ok(markers.every((x) => !/rgba\(0,255,0,|rgba\(255,0,255,/.test(x)), markers.join(" | "));
  el.remove();

  // nur compare_colors: Differenzzeile bleibt bei den Standardfarben
  const el2 = mount({ type: "custom:pattern-card", entity: "binary_sensor.t", mode: "heatmap", days: 14, statistic: "events", compare: "before_after", since, compare_colors: ["#0000ff", "#ff0000"] }, hass);
  await flush();
  const d2 = [...el2.shadowRoot.querySelectorAll(".cell.diff")].map((c) => c.getAttribute("style") || "").filter(Boolean);
  assert.ok(d2.length && d2.every((x) => !/rgba\(0,0,255,|rgba\(255,0,0,/.test(x)), "Differenz unabhängig von compare_colors");
  el2.remove();

  // nur difference_colors: Zeilen bleiben in der normalen Farbskala
  const el3 = mount({ type: "custom:pattern-card", entity: "binary_sensor.t", mode: "heatmap", days: 14, statistic: "events", compare: "before_after", since, difference_colors: ["#00ff00", "#ff00ff"] }, hass);
  await flush();
  const r3 = [...el3.shadowRoot.querySelectorAll('.cell[data-r="0"]')].map((c) => c.getAttribute("style") || "").filter(Boolean);
  assert.ok(r3.length && r3.every((x) => !/rgba\(0,255,0,|rgba\(255,0,255,/.test(x)), "Zeilen unabhängig von difference_colors");
  assert.equal(el3.shadowRoot.querySelectorAll(".legend")[0].querySelectorAll(".bar").length, 1);
  el3.remove();

  const bad = w.document.createElement("pattern-card");
  assert.throws(() => bad.setConfig({ entity: "sensor.x", compare_colors: "red" }), /compare_colors/);
});

/* ---- Editor ---- */

test("Editor: Felder je Typ und Standardwerte nicht in der Konfiguration", async () => {
  const t = (k) => k;
  const names = (schema) => schema.flatMap((s) => (s.type === "grid" ? s.schema.map((x) => x.name) : [s.name]));
  assert.ok(names(P.editorSchema({ mode: "graph" }, "counter", t)).includes("cumulative"));
  assert.ok(!names(P.editorSchema({ mode: "graph" }, "measurement", t)).includes("statistic"));
  assert.ok(names(P.editorSchema({ mode: "heatmap" }, "state", t)).includes("statistic"));
  // relativer Vergleich: Feld „Letzte Tage“, kein Stichtag
  const rec = names(P.editorSchema({ mode: "heatmap", compare: "recent" }, "state", t));
  assert.ok(rec.includes("recent_days") && !rec.includes("since") && rec.includes("difference"));
  assert.ok(!names(P.editorSchema({ mode: "heatmap", compare: "before_after" }, "state", t)).includes("recent_days"));
  assert.ok(names(P.editorSchema({ mode: "heatmap" }, "state", t)).includes("max"));
  assert.ok(names(P.editorSchema({ mode: "graph" }, "measurement", t)).includes("reference"));
  assert.ok(!names(P.editorSchema({ mode: "graph", compare: "weekday_weekend" }, "measurement", t)).includes("reference"));
  assert.ok(names(P.editorSchema({ mode: "heatmap", compare: "weekday_weekend" }, "state", t)).includes("difference"));
  assert.ok(!names(P.editorSchema({ mode: "heatmap" }, "state", t)).includes("difference"));
  assert.ok(names(P.editorSchema({ mode: "heatmap", compare: "before_after" }, "state", t)).includes("since"));
  assert.ok(names(P.editorSchema({ mode: "heatmap", compare: "before_after" }, "state", t)).includes("difference"));
  assert.ok(!names(P.editorSchema({ mode: "graph", compare: "before_after" }, "measurement", t)).includes("reference"));
  assert.ok(names(P.editorSchema({ mode: "graph", compare: "before_after" }, "measurement", t)).includes("compare_color_1"));
  assert.ok(!names(P.editorSchema({ mode: "graph", compare: "before_after" }, "measurement", t)).includes("difference_color_less"));
  assert.ok(names(P.editorSchema({ mode: "heatmap", compare: "before_after" }, "state", t)).includes("difference_color_more"));
  assert.ok(!names(P.editorSchema({ mode: "heatmap", compare: "before_after" }, "state", t)).includes("compare_color_1"));
  assert.ok(names(P.editorSchema({ mode: "graph" }, "measurement", t)).includes("hide_legend"));
  assert.ok(names(P.editorSchema({ mode: "heatmap" }, "state", t)).includes("hide_legend"));
  assert.ok(names(P.editorSchema({ mode: "graph" }, "measurement", t)).includes("hide_subtitle"));

  const ed = w.document.createElement("pattern-card-editor");
  const { hass } = makeHass({ "binary_sensor.m": { entity_id: "binary_sensor.m", state: "off", attributes: {} } }, () => []);
  ed.hass = hass;
  ed.setConfig({ type: "custom:pattern-card", entity: "binary_sensor.m", mode: "heatmap" });
  let out;
  ed.addEventListener("config-changed", (e) => { out = e.detail.config; });
  const form = ed.querySelector("ha-form");
  assert.equal(form.data.weekdays, undefined); // Wochentage stehen im eigenen Abschnitt
  form.dispatchEvent(new w.CustomEvent("value-changed", { detail: { value: { ...form.data, weekdays: ["sun", "mon"], statistic: "events" } } }));
  assert.deepEqual([...out.weekdays], ["mon", "sun"]);
  assert.equal(out.statistic, "events");
  assert.equal(out.days, undefined);
  assert.equal(out.resolution, undefined);
  assert.equal(out.compare, undefined);
  assert.equal(out.difference, undefined);
  form.dispatchEvent(new w.CustomEvent("value-changed", { detail: { value: { ...form.data, statistic: "active", weekdays: [...P.WEEKDAYS] } } }));
  assert.equal(out.weekdays, undefined); // alle sieben = keine Auswahl
  assert.equal(out.statistic, undefined);
  form.dispatchEvent(new w.CustomEvent("value-changed", { detail: { value: { ...form.data, compare: "before_after" } } }));
  assert.match(out.since, /^\d{4}-\d{2}-\d{2}$/);
  form.dispatchEvent(new w.CustomEvent("value-changed", { detail: { value: { ...form.data, compare: "before_after", since: "2026-11-12", difference_color_less: "green", difference_color_more: "red", compare_color_1: "blue" } } }));
  assert.deepEqual([...out.difference_colors], ["green", "red"]);
  assert.equal(out.compare_colors, undefined); // in der Heatmap ohne Wirkung, wird verworfen
  assert.equal(out.difference_color_less, undefined);
  form.dispatchEvent(new w.CustomEvent("value-changed", { detail: { value: { ...form.data, compare: "none", since: "2026-11-12" } } }));
  assert.equal(out.since, undefined);
  assert.equal(out.compare, undefined);
});

/* ---- Wochentagsgruppen (0.10.0) ---- */

test("Wochentagsgruppen: keine, eine (Filter), zwei (Vergleich), alt weekday_weekend", () => {
  const keys = (g) => [...g].map((x) => `${x.key}:${[...x.weekdays].join("")}`);
  // keine Auswahl: alle Tage, im Graph wie heute
  assert.deepEqual(keys(P.weekdayGroups({})), []);
  assert.deepEqual(keys(P.referenceGroups({}, 3)), ["workday:01234"]);
  assert.equal(P.heatmapRows({}).length, 7);
  // nur A: Filter, Heatmap mit den einzelnen Tagen
  assert.deepEqual(keys(P.referenceGroups({ weekdays: ["mon", "thu"] }, 3)), ["reference:03"]);
  assert.deepEqual(keys(P.heatmapRows({ weekdays: ["mon", "thu"] })), ["mon:0", "thu:3"]);
  assert.equal(P.hasCompare({ weekdays: ["mon", "thu"] }), false);
  // nur B zählt wie A
  assert.deepEqual(keys(P.heatmapRows({ weekdays_b: ["thu", "mon"] })), ["mon:0", "thu:3"]);
  // beide: Vergleich, in der Heatmap zwei Gruppenzeilen
  const cfg = { weekdays: ["mon", "thu"], weekdays_b: ["tue", "wed", "fri"] };
  assert.deepEqual(keys(P.referenceGroups(cfg, 3)), ["group_a:03", "group_b:124"]);
  assert.deepEqual(keys(P.heatmapRows(cfg)), ["group_a:03", "group_b:124"]);
  assert.equal(P.hasCompare(cfg), true);
  // Mo–Fr gegen Sa–So behält die Namen, wie compare: weekday_weekend
  const ww = { weekdays: ["mon", "tue", "wed", "thu", "fri"], weekdays_b: ["sat", "sun"] };
  assert.deepEqual(keys(P.heatmapRows(ww)), ["workday:01234", "weekend:56"]);
  assert.deepEqual(keys(P.heatmapRows({ compare: "weekday_weekend" })), ["workday:01234", "weekend:56"]);
  assert.deepEqual(keys(P.referenceGroups({ compare: "weekday_weekend", weekdays: ["mon", "sat"] }, 3)), ["workday:0", "weekend:5"]);
  // mit Zeitvergleich filtert nur A
  assert.deepEqual(keys(P.heatmapRows({ compare: "recent", weekdays: ["mon"], weekdays_b: ["tue"] })).map((k) => k.split(":")[1]), ["0", "0"]);
  // Beschriftung
  const names = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  assert.equal(P.daysLabel(names, new Set([0, 3])), "Mo, Do");
  assert.equal(P.daysLabel(names, new Set([1, 2, 4])), "Di, Mi, Fr");
  assert.equal(P.daysLabel(names, new Set([5, 6])), "Sa–So");
});

test("Wochentagsgruppen: ungleich große Gruppen je Tag gemittelt, Datenlücken, keine leere Gruppe", () => {
  const now = P.wallToTs(2026, 11, 12, 12, 0, TZ); // Do
  const cfg = { weekdays: ["mon", "thu"], weekdays_b: ["tue", "wed", "fri"] };
  const val = (d, k) => ([0, 3].includes(d.weekday) ? 100 : 300) + k;
  const days = filledDays(now, 14, val);
  const g = P.computeModel(days, { statistic: "mean", now, mode: "graph", groups: P.referenceGroups(cfg, 3) });
  assert.deepEqual([...g.references].map((r) => r.expectedDays), [4, 6]); // Mo/Do 2+2, Di/Mi/Fr 2+2+2
  assert.equal(g.references[0].stats[5].mean, 105); // Mittel je Tag, keine Summe
  assert.equal(g.references[1].stats[5].mean, 305);
  const h = P.computeModel(days, { statistic: "mean", now, mode: "heatmap", rows: P.heatmapRows(cfg), difference: true });
  assert.deepEqual([...h.rows].map((r) => r.key), ["group_a", "group_b"]);
  assert.equal(h.diff[5].value, 200);
  // Lücke: ein Dienstag ohne Daten zählt nicht als 0 und nicht als Tag mit Daten
  const gap = P.buildDays(now, 14, TZ, 60);
  for (const d of gap) {
    if (d.ymd.d === 10 && d.ymd.m === 11) continue; // Di 10.11. fehlt
    for (let k = 0; k < 24 && d.b[k] < now; k++) P.accumulateStats([d], [{ start: d.b[k], end: d.b[k + 1], mean: val(d, k) }], "mean", "hour");
  }
  const g2 = P.computeModel(gap, { statistic: "mean", now, mode: "graph", groups: P.referenceGroups(cfg, 3) });
  assert.equal(g2.references[1].expectedDays, 6);
  assert.equal(g2.references[1].daysWithData, 5);
  assert.equal(g2.references[1].stats[5].mean, 305);
  assert.equal(g2.references[1].stats[5].n, 5);
  // Gruppe B ganz ohne Daten: keine leere Kurve, keine leere Zeile, keine Differenz
  const onlyA = P.buildDays(now, 14, TZ, 60);
  for (const d of onlyA) {
    if (![0, 3].includes(d.weekday)) continue;
    for (let k = 0; k < 24 && d.b[k] < now; k++) P.accumulateStats([d], [{ start: d.b[k], end: d.b[k + 1], mean: 1 }], "mean", "hour");
  }
  const g3 = P.computeModel(onlyA, { statistic: "mean", now, mode: "graph", groups: P.referenceGroups(cfg, 3) });
  assert.deepEqual([...g3.references].map((r) => r.key), ["group_a"]);
  const h3 = P.computeModel(onlyA, { statistic: "mean", now, mode: "heatmap", rows: P.heatmapRows(cfg), difference: true });
  assert.deepEqual([...h3.rows].map((r) => r.key), ["group_a"]);
  assert.equal(h3.diff, undefined);
});

test("Wochentagsgruppen: setConfig prüft weekdays_b", () => {
  const el = w.document.createElement("pattern-card");
  const base = { type: "custom:pattern-card", entity: "binary_sensor.b", mode: "heatmap" };
  el.setConfig({ ...base, weekdays: ["mon", "thu"], weekdays_b: ["tue", "wed", "fri"] });
  el.setConfig({ ...base, weekdays_b: [] });
  assert.throws(() => el.setConfig({ ...base, weekdays: ["mon"], weekdays_b: ["mon", "tue"] }), /not in both/);
  assert.throws(() => el.setConfig({ ...base, weekdays_b: ["tue"], compare: "before_after", since: "2026-11-01" }), /can't be combined with compare/);
  assert.throws(() => el.setConfig({ ...base, weekdays_b: ["tue"], compare: "weekday_weekend" }), /can't be combined with compare/);
  assert.throws(() => el.setConfig({ ...base, weekdays_b: "tue" }), /weekdays_b must be a list/);
});

test("Wochentagsgruppen: Karte heatmap und graph mit eigenen Gruppen", async () => {
  const now = Date.now();
  const entries = [];
  for (let t = now - 21 * 24 * H; t < now; t += 3 * H) entries.push({ s: "on", lu: t / 1000 }, { s: "off", lu: (t + 20 * M) / 1000 });
  const { hass } = makeHass(
    { "binary_sensor.b": { entity_id: "binary_sensor.b", state: "off", attributes: { device_class: "motion" } } },
    (msg) => {
      if (msg.type === "recorder/get_statistics_metadata") return [];
      const s0 = Date.parse(msg.start_time) / 1000;
      const e0 = Date.parse(msg.end_time) / 1000;
      return { "binary_sensor.b": entries.filter((x) => x.lu >= s0 && x.lu < e0) };
    }
  );
  const cfg = { type: "custom:pattern-card", entity: "binary_sensor.b", mode: "heatmap", days: 14, weekdays: ["mon", "thu"], weekdays_b: ["tue", "wed", "fri"] };
  const el = mount(cfg, hass);
  await flush();
  const root = el.shadowRoot;
  assert.deepEqual([...root.querySelectorAll(".wd")].map((x) => x.textContent), ["Mo, Do", "Di, Mi, Fr", "Δ"]);
  assert.match(root.querySelectorAll(".legend")[1].textContent, /mehr Mo, Do.*mehr Di, Mi, Fr/);
  assert.doesNotMatch(root.querySelector(".sub").textContent, /Mo, Do/, "Untertitel ohne Filterliste");
  const d = [...root.querySelectorAll(".cell.diff")].find((c) => c.getAttribute("style"));
  d.dispatchEvent(new w.MouseEvent("pointerover", { bubbles: true }));
  assert.match(root.querySelector(".tooltip").textContent, /Di, Mi, Fr − Mo, Do: [+−-]?\d/);
  // nur Gruppe A: Filter mit den einzelnen Tagen, keine Differenz
  el.setConfig({ ...cfg, weekdays_b: undefined });
  await flush();
  assert.deepEqual([...root.querySelectorAll(".wd")].map((x) => x.textContent), ["Mo", "Do"]);
  assert.equal(root.querySelectorAll(".cell.diff").length, 0);
  // Regelmäßigkeit je Gruppe
  el.setConfig({ ...cfg, statistic: "events", regularity: { enabled: true, min_samples: 1, threshold: 1 } });
  await flush();
  assert.ok(root.querySelectorAll(".cell.regular").length > 0);
  assert.equal(root.querySelectorAll(".cell.diff.regular").length, 0);
  // Graph: zwei Referenzen mit den Tagen als Namen
  class Stub extends w.HTMLElement {}
  if (!w.customElements.get("ha-chart-base")) w.customElements.define("ha-chart-base", Stub);
  el.setConfig({ ...cfg, mode: "graph" });
  await flush(20);
  const chart = root.querySelector("ha-chart-base");
  const legend = [...chart.options.legend.data].map((x) => x.name);
  assert.deepEqual(legend, ["Heute", "Mo, Do (Ø)", "Spanne Mo, Do", "Di, Mi, Fr (Ø)", "Spanne Di, Mi, Fr"]);
  el.remove();
});

test("Wochentagsgruppen: Editor mit Abschnitt, Umzug alter Konfiguration, Rundlauf", async () => {
  const { hass } = makeHass({ "binary_sensor.m": { entity_id: "binary_sensor.m", state: "off", attributes: {} } }, () => []);
  const ed = w.document.createElement("pattern-card-editor");
  ed.hass = hass;
  let out;
  ed.addEventListener("config-changed", (e) => { out = e.detail.config; });
  ed.setConfig({ type: "custom:pattern-card", entity: "binary_sensor.m", mode: "heatmap" });
  const panel = ed.querySelector(".pc-wd");
  const forms = ed.querySelectorAll("ha-form");
  assert.equal(forms.length, 2);
  assert.ok(forms[0].nextElementSibling === panel && panel.nextElementSibling === forms[1], "Abschnitt zwischen den Formularen");
  assert.equal(panel.open, false, "zugeklappt");
  assert.match(panel.textContent, /Wochentage\s*Alle Tage/);
  assert.ok(forms[1].schema.some((x) => x.name === "compare"));
  assert.ok(!forms[1].schema.find((x) => x.name === "compare").selector.select.options.some((o) => o.value === "weekday_weekend"));
  const btn = (g, d) => panel.querySelector(`button[data-group="${g}"][data-day="${d}"]`);
  const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  // Mo + Do gegen Di + Mi + Fr per Klick
  click(btn("a", 0)); click(btn("a", 3));
  assert.deepEqual([...out.weekdays], ["mon", "thu"]);
  assert.equal(out.weekdays_b, undefined);
  click(btn("b", 1)); click(btn("b", 2)); click(btn("b", 4));
  assert.deepEqual([...out.weekdays_b], ["tue", "wed", "fri"]);
  assert.match(panel.textContent, /Mo, Do gegen Di, Mi, Fr/);
  assert.equal(btn("a", 1).className, "pc-wd-day other");
  // ein Tag nie in beiden Gruppen: Do nach B verschieben
  click(btn("b", 3));
  assert.deepEqual([...out.weekdays], ["mon"]);
  assert.deepEqual([...out.weekdays_b], ["tue", "wed", "thu", "fri"]);
  click(btn("a", 3));
  assert.deepEqual([...out.weekdays], ["mon", "thu"]);
  assert.deepEqual([...out.weekdays_b], ["tue", "wed", "fri"]);
  // Differenzzeile und Farben erscheinen, Beschriftung mit den Gruppen
  const names = (schema) => schema.flatMap((s) => (s.type === "grid" ? s.schema.map((x) => x.name) : [s.name]));
  assert.ok(names(forms[1].schema).includes("difference"));
  assert.equal(forms[1].computeLabel({ name: "difference" }), "Differenzzeile (Di, Mi, Fr − Mo, Do)");
  // Rundlauf über das Formular lässt die Gruppen stehen
  forms[1].dispatchEvent(new w.CustomEvent("value-changed", { detail: { value: { ...forms[1].data, difference: false } } }));
  assert.deepEqual([...out.weekdays_b], ["tue", "wed", "fri"]);
  assert.equal(out.difference, false);
  // Zeitvergleich: B wird verworfen und ausgegraut
  forms[1].dispatchEvent(new w.CustomEvent("value-changed", { detail: { value: { ...forms[1].data, compare: "recent" } } }));
  assert.equal(out.weekdays_b, undefined);
  assert.deepEqual([...out.weekdays], ["mon", "thu"]);
  assert.ok(btn("b", 1).disabled);
  assert.match(panel.textContent, /Mit Zeitvergleich filtert Gruppe A nur die Tage/);
  forms[1].dispatchEvent(new w.CustomEvent("value-changed", { detail: { value: { ...forms[1].data, compare: "none" } } }));
  // Vorbelegung Werktage gegen Wochenende, dann alle Tage
  click(panel.querySelector('[data-action="preset"]'));
  assert.deepEqual([...out.weekdays], ["mon", "tue", "wed", "thu", "fri"]);
  assert.deepEqual([...out.weekdays_b], ["sat", "sun"]);
  assert.equal(forms[1].computeLabel({ name: "difference" }), "Differenzzeile (Wochenende − Werktage)");
  click(panel.querySelector('[data-action="reset"]'));
  assert.equal(out.weekdays, undefined);
  assert.equal(out.weekdays_b, undefined);
  assert.equal(out.difference, undefined);
  // alte Konfiguration: Gruppen vorbelegt, beim nächsten Ändern in neuer Form
  ed.setConfig({ type: "custom:pattern-card", entity: "binary_sensor.m", mode: "heatmap", compare: "weekday_weekend" });
  assert.equal(btn("a", 0).getAttribute("aria-pressed"), "true");
  assert.equal(btn("b", 6).getAttribute("aria-pressed"), "true");
  assert.equal(forms[1].data.compare, "none");
  forms[0].dispatchEvent(new w.CustomEvent("value-changed", { detail: { value: { ...forms[0].data, days: 21 } } }));
  assert.equal(out.compare, undefined);
  assert.deepEqual([...out.weekdays], ["mon", "tue", "wed", "thu", "fri"]);
  assert.deepEqual([...out.weekdays_b], ["sat", "sun"]);
  // Englisch
  const en = makeHass({ "binary_sensor.m": { entity_id: "binary_sensor.m", state: "off", attributes: {} } }, () => []).hass;
  en.locale = { ...en.locale, language: "en" };
  const ed2 = w.document.createElement("pattern-card-editor");
  ed2.hass = en;
  ed2.setConfig({ type: "custom:pattern-card", entity: "binary_sensor.m", weekdays: ["mon", "thu"], weekdays_b: ["tue", "wed", "fri"] });
  assert.match(ed2.querySelector(".pc-wd").textContent, /Weekdays\s*Mon, Thu vs\. Tue, Wed, Fri/);
  assert.match(ed2.querySelector(".pc-wd").textContent, /Group A.*Group B/);
});

/* ---- Regelmäßigkeit (0.9.0) ---- */

// Sonntag 15.11.2026 12:00: 56 Tage zurück enthalten genau 8 Samstage (26.09. bis 14.11.)
const REG_NOW = P.wallToTs(2026, 11, 15, 12, 0, TZ);
/** Tage mit Verlauf: perDay(day) liefert [[h, m, Zustand], …] ab Mitternacht oder null (keine Daten) */
const regDays = (perDay, slot = 60) => {
  const days = P.buildDays(REG_NOW, 56, TZ, slot);
  for (const d of days) {
    const list = perDay(d);
    if (!list) continue;
    const end = Math.min(d.end, REG_NOW);
    const entries = [{ s: "off", lu: d.start / 1000 }, ...list.map(([h, m, st]) => ({ s: st, lu: P.wallToTs(d.ymd.y, d.ymd.m, d.ymd.d, h, m, TZ) / 1000 }))];
    P.accumulateHistory([d], entries, d.start, end, "binary_sensor", "state");
  }
  return days;
};
const sats = (days) => days.filter((d) => d.weekday === 5 && !d.isToday);
const satRow = (days, statistic = "events", rows) => {
  const m = P.computeModel(days, { statistic, now: REG_NOW, mode: "heatmap", weekdays: new Set([5]), rows, regularity: true });
  return m;
};

test("Regelmäßigkeit: 6 von 8 Samstagen = 75 %, mehrere Ereignisse am Tag zählen einmal", () => {
  let i = 0;
  const days = regDays((d) => {
    if (d.weekday !== 5) return [];
    const n = i++;
    if (n >= 6) return [];
    // erster Samstag: drei Starts im selben Slot
    return n === 0
      ? [[10, 5, "on"], [10, 10, "off"], [10, 20, "on"], [10, 25, "off"], [10, 40, "on"], [10, 45, "off"]]
      : [[10, 30, "on"], [12, 0, "off"]]; // Programm 10:30–12:00: ein Start um 10:30, kein Ereignis um 11 oder 12
  });
  assert.equal(sats(days).length, 8);
  const m = satRow(days);
  const c = m.rows[0].cells[10];
  assert.deepEqual({ ...c.reg }, { valid: 8, hits: 6 });
  near(c.value, (3 + 5) / 8, 1e-12, "Füllwert bleibt der Mittelwert der Ereignisse");
  assert.deepEqual({ ...m.rows[0].cells[11].reg }, { valid: 8, hits: 0 }, "Ende des Programms ist kein Ereignis");
  assert.deepEqual({ ...m.rows[0].cells[3].reg }, { valid: 8, hits: 0 }, "ohne Ereignisse 0 %, Daten vorhanden");
  // active: irgendwann im Slot aktiv, 10–11 und 11–12 Uhr
  const a = satRow(days, "active");
  assert.deepEqual({ ...a.rows[0].cells[10].reg }, { valid: 8, hits: 6 });
  assert.deepEqual({ ...a.rows[0].cells[11].reg }, { valid: 8, hits: 5 });
  // ohne Option kein reg im Modell
  const off = P.computeModel(days, { statistic: "events", now: REG_NOW, mode: "heatmap", weekdays: new Set([5]) });
  assert.equal(off.rows[0].cells[10].reg, undefined);
});

test("Regelmäßigkeit: fehlende Daten zählen nicht als Tag ohne Ereignis", () => {
  let i = 0;
  const days = regDays((d) => {
    if (d.weekday !== 5) return [];
    const n = i++;
    if (n < 2) return null; // kein Verlauf (vor Beginn der Aufzeichnung)
    if (n === 2) return [[9, 0, "unavailable"], [11, 0, "off"]]; // 10–11 Uhr unbekannt
    if (n === 3) return [[10, 0, "unavailable"], [10, 40, "off"]]; // nur 20 von 60 min bekannt
    return [[10, 30, "on"], [10, 35, "off"]];
  });
  const c = satRow(days).rows[0].cells[10];
  assert.deepEqual({ ...c.reg }, { valid: 4, hits: 4 }, "nur die 4 Samstage mit ausreichend Daten");
  assert.equal(c.n, 5, "Füllwert wie bisher: jeder Tag mit bekannter Zeit im Slot");
});

test("Regelmäßigkeit: heute nur abgeschlossene Slots, Zeitumstellung, 15-min-Auflösung", () => {
  // heute (Sonntag 12:00): Slot 10 zählt mit, Slot 12 nicht
  const days = regDays((d) => (d.weekday === 6 ? [[10, 10, "on"], [10, 15, "off"], [12, 10, "on"], [12, 15, "off"]] : []));
  const sun = P.computeModel(days, { statistic: "events", now: REG_NOW, mode: "heatmap", weekdays: new Set([6]), regularity: true }).rows[0];
  assert.deepEqual({ ...sun.cells[10].reg }, { valid: 9, hits: 9 });
  assert.deepEqual({ ...sun.cells[12].reg }, { valid: 8, hits: 8 }, "heute 12–13 Uhr noch offen, zählt nicht");
  // Herbst 25.10.: Slot 2–3 Uhr umfasst 2 h, Frühjahr: leerer Slot zählt nicht
  const autumn = P.buildDays(Date.UTC(2026, 9, 25, 12, 0), 0, TZ, 60)[0];
  P.accumulateHistory([autumn], [{ s: "off", lu: autumn.start / 1000 }, { s: "on", lu: (autumn.b[2] + 90 * M) / 1000 }, { s: "off", lu: (autumn.b[2] + 95 * M) / 1000 }], autumn.start, autumn.end, "binary_sensor", "state");
  assert.deepEqual({ ...P.slotRegularity([autumn], "events", autumn.end + H, 24)[2] }, { valid: 1, hits: 1 });
  const spring = P.buildDays(Date.UTC(2026, 2, 29, 12, 0), 0, TZ, 60)[0];
  P.accumulateHistory([spring], [{ s: "off", lu: spring.start / 1000 }], spring.start, spring.end, "binary_sensor", "state");
  const sr = P.slotRegularity([spring], "events", spring.end + H, 24);
  assert.equal(sr[2].valid, 0, "02–03 Uhr gibt es am 29.03. nicht");
  assert.equal(sr[1].valid, 1);
  // 15 min: Ereignis 10:30 nur im Slot 10:30–10:45
  const q = regDays((d) => (d.weekday === 5 ? [[10, 30, "on"], [10, 35, "off"]] : []), 15);
  const qr = satRow(q).rows[0].cells;
  assert.deepEqual({ ...qr[42].reg }, { valid: 8, hits: 8 });
  assert.deepEqual({ ...qr[41].reg }, { valid: 8, hits: 0 });
});

test("Regelmäßigkeit: Schwelle, Mindestzahl der Tage und Konfiguration", () => {
  const rc = P.regularityConfig({ mode: "heatmap", regularity: { enabled: true, threshold: 75, min_samples: 4 } }, "events");
  assert.equal(P.isRegular({ valid: 8, hits: 6 }, rc), true, "genau am Schwellwert");
  assert.equal(P.isRegular({ valid: 8, hits: 5 }, rc), false, "unter dem Schwellwert");
  assert.equal(P.isRegular({ valid: 3, hits: 3 }, rc), false, "unter min_samples");
  assert.equal(P.isRegular({ valid: 4, hits: 3 }, rc), true);
  assert.equal(P.isRegular({ valid: 0, hits: 0 }, P.regularityConfig({ mode: "heatmap", regularity: { min_samples: 0 } }, "events")), false);
  const def = P.regularityConfig({ mode: "heatmap", regularity: true }, "active");
  assert.equal(def.threshold, 70);
  assert.equal(def.minSamples, 4);
  assert.equal(P.regularityConfig({ mode: "heatmap", regularity: { enabled: false } }, "events"), null);
  assert.equal(P.regularityConfig({ mode: "heatmap", regularity: true }, "mean"), null, "nur events und active");
  assert.equal(P.regularityConfig({ mode: "graph", regularity: true }, "events"), null, "nur Heatmap");
  assert.equal(P.regularityConfig({ mode: "heatmap" }, "events"), null);
  const el = w.document.createElement("pattern-card");
  const base = { type: "custom:pattern-card", entity: "binary_sensor.x", mode: "heatmap" };
  assert.throws(() => el.setConfig({ ...base, regularity: "ja" }), /regularity/);
  assert.throws(() => el.setConfig({ ...base, regularity: { threshold: 0 } }), /threshold/);
  assert.throws(() => el.setConfig({ ...base, regularity: { threshold: 120 } }), /threshold/);
  assert.throws(() => el.setConfig({ ...base, regularity: { min_samples: 0 } }), /min_samples/);
  el.setConfig({ ...base, regularity: { enabled: true, threshold: 70, min_samples: 4, color: "amber" } });
  el.setConfig({ ...base, regularity: true });
});

/** Karte mit 8 Wochen Waschmaschine: samstags 10:30 an 6 von 8 Samstagen, mittwochs 18:15 an 2 von 8 */
// feste Zeit: Mittwoch 18.11.2026 08:00, heute zählt so weder Samstag noch Mittwoch 18 Uhr mit
const WASHER_NOW = P.wallToTs(2026, 11, 18, 8, 0, TZ);
const withNow = async (ts, fn) => {
  const orig = w.Date.now;
  w.Date.now = () => ts;
  try { await fn(); } finally { w.Date.now = orig; }
};
const washerHass = (since = 0) => {
  const entries = [];
  const now = WASHER_NOW;
  const tz = TZ;
  const t0 = { y: 2026, m: 11, d: 18 };
  let sat = 0;
  let wed = 0;
  entries.push({ s: "off", lu: (now - 60 * 864e5) / 1000 });
  for (let i = 57; i >= 1; i--) {
    const ymd = P.ymdAdd(t0, -i);
    const wd = P.weekdayOf(ymd);
    const at = (h, m) => P.wallToTs(ymd.y, ymd.m, ymd.d, h, m, tz) / 1000;
    if (wd === 5 && i <= 56 && sat++ < 6) entries.push({ s: "on", lu: at(10, 30) }, { s: "off", lu: at(12, 0) });
    if (wd === 2 && i <= 56 && wed++ < 2) entries.push({ s: "on", lu: at(18, 15) }, { s: "off", lu: at(19, 30) });
  }
  return makeHass(
    { "binary_sensor.wasche": { entity_id: "binary_sensor.wasche", state: "off", attributes: { friendly_name: "Waschmaschine", device_class: "running" } } },
    (msg) => {
      if (msg.type === "recorder/get_statistics_metadata") return [];
      // since: Verlauf erst ab diesem Zeitpunkt (davor keine Daten)
      const s = Math.max(Date.parse(msg.start_time), since) / 1000;
      const e = Date.parse(msg.end_time) / 1000;
      if (s >= e) return { "binary_sensor.wasche": [] };
      // wie HA: Zustand zu Beginn des Abschnitts zuerst
      const before = entries.filter((x) => x.lu < s).pop();
      return { "binary_sensor.wasche": [...(before ? [{ ...before, lu: s }] : []), ...entries.filter((x) => x.lu >= s && x.lu < e)] };
    }
  );
};

test("Karte heatmap: Rahmen für regelmäßige Ereignisse, Füllfarbe unverändert, Tooltip", () => withNow(WASHER_NOW, async () => {
  const { hass } = washerHass();
  const base = { type: "custom:pattern-card", entity: "binary_sensor.wasche", mode: "heatmap", statistic: "events", days: 56 };
  const plain = mount(base, hass);
  const el = mount({ ...base, regularity: { enabled: true, threshold: 70 } }, hass);
  await flush(20);
  const cellsOf = (x) => [...x.shadowRoot.querySelectorAll(".cell")];
  const a = cellsOf(plain);
  const b = cellsOf(el);
  assert.equal(a.length, b.length);
  // Füllfarben identisch, ohne Option keine Markierung und keine Legende dazu
  assert.deepEqual(a.map((c) => c.getAttribute("style")), b.map((c) => c.getAttribute("style")));
  assert.equal(plain.shadowRoot.querySelectorAll(".regular").length, 0);
  assert.equal(plain.shadowRoot.querySelector(".content").innerHTML.includes("regular"), false);
  const reg = b.filter((c) => c.classList.contains("regular"));
  assert.equal(reg.length, 1, "nur Samstag 10–11 Uhr");
  assert.equal(reg[0].dataset.r, "5");
  assert.equal(reg[0].dataset.k, "10");
  assert.ok(el.shadowRoot.querySelector(".legend .regular"));
  assert.match(el.shadowRoot.querySelector(".legend").textContent, /^Regelmäßigkeit \(70 %\)/);
  // ein Rahmen über der einen Zelle, gültige Nullwerte ohne Diagonale
  assert.deepEqual([...el.shadowRoot.querySelectorAll(".reg-run")].map((x) => x.style.gridColumn.replace(/\s/g, "")), ["12/13"]);
  assert.equal(el.shadowRoot.querySelectorAll(".cell.nodata").length, 0);
  reg[0].dispatchEvent(new w.MouseEvent("pointerover", { bubbles: true }));
  const tip = el.shadowRoot.querySelector(".tooltip").textContent;
  assert.match(tip, /Ereignisse: 0,8 Ereignisse/);
  assert.match(tip, /Regelmäßigkeit: 75 %/);
  assert.match(tip, /Ereignis an 6 von 8 Samstagen/);
  // Mittwoch 18–19 Uhr: 25 %, kein Rahmen, Tooltip trotzdem mit Anteil
  const wed = b.find((c) => c.dataset.r === "2" && c.dataset.k === "18");
  assert.equal(wed.classList.contains("regular"), false);
  wed.dispatchEvent(new w.MouseEvent("pointerover", { bubbles: true }));
  assert.match(el.shadowRoot.querySelector(".tooltip").textContent, /Regelmäßigkeit: 25 % ?Ereignis an 2 von 8 Mittwochen/);
  // ohne Option kein Zusatz im Tooltip
  cellsOf(plain).find((c) => c.dataset.r === "5" && c.dataset.k === "10").dispatchEvent(new w.MouseEvent("pointerover", { bubbles: true }));
  assert.doesNotMatch(plain.shadowRoot.querySelector(".tooltip").textContent, /Regelmäßigkeit/);
  // Schwelle 80 %: kein Rahmen; min_samples 9: kein Rahmen, Hinweis im Tooltip
  el.setConfig({ ...base, regularity: { threshold: 80 } });
  await flush(20);
  assert.equal(el.shadowRoot.querySelectorAll(".cell.regular").length, 0);
  el.setConfig({ ...base, regularity: { min_samples: 9, color: "amber" } });
  await flush(20);
  assert.equal(el.shadowRoot.querySelectorAll(".cell.regular").length, 0);
  assert.equal(el.shadowRoot.querySelector("ha-card").style.getPropertyValue("--pc-regular-color"), "var(--amber-color)");
  cellsOf(el).find((c) => c.dataset.r === "5" && c.dataset.k === "10").dispatchEvent(new w.MouseEvent("pointerover", { bubbles: true }));
  assert.match(el.shadowRoot.querySelector(".tooltip").textContent, /zu wenige Tage für den Rahmen \(mind\. 9\)/);
  // Anteil aktiv: irgendwann aktiv, auch 11–12 Uhr
  el.setConfig({ ...base, statistic: "active", regularity: true });
  await flush(20);
  const act = cellsOf(el).filter((c) => c.classList.contains("regular")).map((c) => `${c.dataset.r}/${c.dataset.k}`);
  assert.deepEqual(act, ["5/10", "5/11"]);
  // zwei benachbarte Zellen: ein gemeinsamer Rahmen, beide Enden geschlossen
  const runs = [...el.shadowRoot.querySelectorAll(".reg-run")];
  assert.equal(runs.length, 1);
  assert.equal(runs[0].style.gridRow, "6");
  assert.equal(runs[0].style.gridColumn.replace(/\s/g, ""), "12/14");
  assert.ok(!runs[0].classList.contains("open-start") && !runs[0].classList.contains("open-end"));
  cellsOf(el).find((c) => c.dataset.r === "5" && c.dataset.k === "11").dispatchEvent(new w.MouseEvent("pointerover", { bubbles: true }));
  assert.match(el.shadowRoot.querySelector(".tooltip").textContent, /Aktiv an 6 von 8 Samstagen/);
  plain.remove();
  el.remove();
}));

test("Karte heatmap: Regelmäßigkeit im Vergleich je Gruppe, nicht in der Differenzzeile", () => withNow(WASHER_NOW, async () => {
  const { hass } = washerHass();
  const el = mount({ type: "custom:pattern-card", entity: "binary_sensor.wasche", mode: "heatmap", statistic: "events", days: 56, compare: "weekday_weekend", regularity: { threshold: 35 } }, hass);
  await flush(20);
  const root = el.shadowRoot;
  // Wochenende 10–11 Uhr: 6 von 16 Tagen = 37,5 %
  const reg = [...root.querySelectorAll(".cell.regular")];
  assert.deepEqual(reg.map((c) => `${c.dataset.r}/${c.dataset.k}`), ["1/10"]);
  assert.equal(root.querySelectorAll(".cell.diff.regular").length, 0);
  reg[0].dispatchEvent(new w.MouseEvent("pointerover", { bubbles: true }));
  assert.match(root.querySelector(".tooltip").textContent, /Regelmäßigkeit: 38 % ?Ereignis an 6 von 16 Tagen/);
  const d = [...root.querySelectorAll(".cell.diff")].find((c) => c.dataset.k === "10");
  d.dispatchEvent(new w.MouseEvent("pointerover", { bubbles: true }));
  assert.doesNotMatch(root.querySelector(".tooltip").textContent, /Regelmäßigkeit/);
  // recent: Gruppen je Abschnitt, Karte lädt
  el.setConfig({ type: "custom:pattern-card", entity: "binary_sensor.wasche", mode: "heatmap", statistic: "events", days: 28, compare: "recent", recent_days: 14, regularity: { min_samples: 1, threshold: 10 } });
  await flush(20);
  assert.equal(root.querySelectorAll(".wd").length, 3);
  assert.ok(root.querySelectorAll(".cell.regular").length >= 1);
  assert.equal(root.querySelectorAll(".cell.diff.regular").length, 0);
  el.remove();
}));

test("Editor: Regelmäßigkeit nur bei Heatmap mit Ereignissen oder Anteil aktiv", async () => {
  const t = (k) => k;
  const names = (schema) => schema.flatMap((s) => (s.type === "grid" ? s.schema.map((x) => x.name) : [s.name]));
  assert.ok(names(P.editorSchema({ mode: "heatmap" }, "state", t)).includes("regularity_enabled"));
  assert.ok(!names(P.editorSchema({ mode: "heatmap" }, "state", t)).includes("regularity_threshold"), "Felder erst nach dem Einschalten");
  const on = names(P.editorSchema({ mode: "heatmap", regularity: { enabled: true } }, "state", t));
  assert.ok(["regularity_threshold", "regularity_min_samples", "regularity_color"].every((n) => on.includes(n)));
  assert.ok(!names(P.editorSchema({ mode: "heatmap" }, "measurement", t)).includes("regularity_enabled"));
  assert.ok(!names(P.editorSchema({ mode: "graph" }, "state", t)).includes("regularity_enabled"));
  assert.ok(names(P.editorSchema({ mode: "heatmap" }, "timestamp", t)).includes("regularity_enabled"));

  const ed = w.document.createElement("pattern-card-editor");
  const { hass } = makeHass({ "binary_sensor.m": { entity_id: "binary_sensor.m", state: "off", attributes: {} } }, () => []);
  ed.hass = hass;
  ed.setConfig({ type: "custom:pattern-card", entity: "binary_sensor.m", mode: "heatmap", statistic: "events" });
  let out;
  ed.addEventListener("config-changed", (e) => { out = e.detail.config; });
  const form = ed.querySelector("ha-form");
  assert.equal(form.data.regularity_enabled, false);
  form.dispatchEvent(new w.CustomEvent("value-changed", { detail: { value: { ...form.data, regularity_enabled: true } } }));
  assert.deepEqual({ ...out.regularity }, { enabled: true });
  assert.equal(out.regularity_enabled, undefined);
  ed.setConfig(out);
  assert.equal(ed.querySelector("ha-form").data.regularity_threshold, 70);
  form.dispatchEvent(new w.CustomEvent("value-changed", { detail: { value: { ...form.data, regularity_threshold: 75, regularity_min_samples: 6, regularity_color: "amber" } } }));
  assert.deepEqual({ ...out.regularity }, { enabled: true, threshold: 75, min_samples: 6, color: "amber" });
  ed.setConfig(out);
  form.dispatchEvent(new w.CustomEvent("value-changed", { detail: { value: { ...form.data, regularity_enabled: false } } }));
  assert.equal(out.regularity, undefined);
  // Umschalten auf Graph verwirft die Option
  ed.setConfig({ type: "custom:pattern-card", entity: "binary_sensor.m", mode: "heatmap", regularity: { enabled: true } });
  form.dispatchEvent(new w.CustomEvent("value-changed", { detail: { value: { ...ed.querySelector("ha-form").data, mode: "graph" } } }));
  assert.equal(out.regularity, undefined);
});


/* ---- 0.11.0: zusammenhängende Rahmen, fehlende Daten, Legende, Tastatur ---- */

/** Zeilen für regularRuns: je Wochentag die regelmäßigen Slots (24 Slots) */
const runRows = (spec, extra = {}) => Object.entries(spec).map(([wd, ks]) => ({
  weekday: Number(wd), weekdays: new Set([Number(wd)]), ...extra,
  cells: Array.from({ length: 24 }, (_, k) => ({ n: 8, value: 1, reg: ks.includes(k) ? { valid: 8, hits: 8 } : { valid: 8, hits: 0 } })),
}));
const RC = { threshold: 70, minSamples: 4 };
const runsOf = (rows) => [...P.regularRuns(rows, RC, 24)].map((r) => `${r.ri}:${r.k0}-${r.k1}${r.openStart ? "<" : ""}${r.openEnd ? ">" : ""}`);

test("regularRuns: einzelne Zelle, Lauf, Unterbrechung", () => {
  assert.deepEqual(runsOf(runRows({ 0: [5] })), ["0:5-5"]);
  assert.deepEqual(runsOf(runRows({ 0: [8, 9, 10] })), ["0:8-10"], "Mo 8–11 Uhr: ein Rahmen");
  assert.deepEqual(runsOf(runRows({ 0: [8, 9, 11, 12, 13] })), ["0:8-9", "0:11-13"], "Lücke trennt");
  assert.deepEqual(runsOf(runRows({ 0: [] })), []);
  assert.equal(P.regularRuns(runRows({ 0: [1] }), null, 24).length, 0, "ohne Option keine Rahmen");
  // zu wenige Tage: nicht regelmäßig, also kein Rahmen
  const few = runRows({ 0: [3, 4] });
  few[0].cells[3].reg = { valid: 3, hits: 3 };
  assert.deepEqual(runsOf(few), ["0:4-4"]);
});

test("regularRuns: Mitternacht offen nur zwischen aufeinanderfolgenden Wochentagen", () => {
  // Werkstatt: Freitag 22 bis Samstag 02 Uhr
  assert.deepEqual(runsOf(runRows({ 4: [22, 23], 5: [0, 1] })), ["0:22-23>", "1:0-1<"]);
  // Sonntag auf Montag: Montag ist die erste Zeile, Sonntag die letzte
  assert.deepEqual(runsOf(runRows({ 0: [0, 1], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [23] })), ["0:0-1<", "6:23-23>"]);
  // Samstag auf Sonntag
  assert.deepEqual(runsOf(runRows({ 5: [23], 6: [0] })), ["0:23-23>", "1:0-0<"]);
  // letzte Zelle ohne regelmäßigen Nachbarn am Folgetag bzw. erste ohne am Vortag
  assert.deepEqual(runsOf(runRows({ 4: [23], 5: [1] })), ["0:23-23", "1:1-1"]);
  assert.deepEqual(runsOf(runRows({ 4: [20], 5: [0] })), ["0:20-20", "1:0-0"]);
  // nicht aufeinanderfolgend (gefiltert Mo und Do): keine Verbindung
  assert.deepEqual(runsOf(runRows({ 0: [0], 3: [23] })), ["0:0-0", "1:23-23"]);
  // Folgetag herausgefiltert: Freitag allein bleibt zu
  assert.deepEqual(runsOf(runRows({ 4: [23] })), ["0:23-23"]);
  // ganzer Tag regelmäßig, Vor- und Folgetag auch: beide Enden offen
  const all = Array.from({ length: 24 }, (_, k) => k);
  assert.deepEqual(runsOf(runRows({ 0: all, 1: all, 2: all })), ["0:0-23>", "1:0-23<>", "2:0-23<"]);
});

test("regularRuns: Vergleichsgruppen ohne Tagesübergänge", () => {
  // Gruppen aus je einem Tag (Fr gegen Sa) sind keine Wochentagszeilen
  const g = runRows({ 4: [23], 5: [0] }, { group: true });
  assert.deepEqual(runsOf(g), ["0:23-23", "1:0-0"]);
  // Werktage gegen Wochenende
  const rows = [
    { key: "workday", group: true, weekdays: new Set([0, 1, 2, 3, 4]), cells: runRows({ 0: [23] })[0].cells },
    { key: "weekend", group: true, weekdays: new Set([5, 6]), cells: runRows({ 0: [0] })[0].cells },
  ];
  assert.deepEqual(runsOf(rows), ["0:23-23", "1:0-0"]);
  // Vorher/Nachher und Zeilen über einen Filter (weekday undefined)
  assert.deepEqual(runsOf([{ key: "before", group: true, weekdays: new Set([4]), cells: rows[0].cells }, { key: "after", group: true, weekdays: new Set([5]), cells: rows[1].cells }]), ["0:23-23", "1:0-0"]);
});

test("Karte heatmap: fehlende Daten mit Diagonale, gültige Nullwerte ohne", () => withNow(WASHER_NOW, async () => {
  // Verlauf erst ab Montag 16.11. 08:00 (WASHER_NOW = Mi 18.11. 08:00)
  const since = P.wallToTs(2026, 11, 16, 8, 0, TZ);
  const { hass } = washerHass(since);
  const el = mount({ type: "custom:pattern-card", entity: "binary_sensor.wasche", mode: "heatmap", statistic: "events", days: 56 }, hass);
  await flush(30);
  const root = el.shadowRoot;
  const cell = (r, k) => root.querySelector(`.cell[data-r="${r}"][data-k="${k}"]`);
  assert.ok(cell(0, 3), "Heatmap gezeichnet");
  // Donnerstag: keine Daten in keinem Slot
  for (let k = 0; k < 24; k++) assert.ok(cell(3, k).classList.contains("nodata"), `Do ${k}`);
  // Montag: vor 8 Uhr keine Daten, danach gültige Nullwerte (keine Ereignisse)
  assert.ok(cell(0, 3).classList.contains("nodata"));
  assert.ok(!cell(0, 10).classList.contains("nodata"));
  assert.match(cell(0, 10).getAttribute("style"), /background:/, "Nullwert hat die unterste Farbe");
  assert.ok(!/background:/.test(cell(0, 3).getAttribute("style")));
  // Tooltip: fehlende Daten als solche benannt, Nullwert mit Stichprobe
  cell(0, 3).dispatchEvent(new w.MouseEvent("pointerover", { bubbles: true }));
  assert.match(root.querySelector(".tooltip").textContent, /Ereignisse: –keine Daten$/);
  cell(0, 10).dispatchEvent(new w.MouseEvent("pointerover", { bubbles: true }));
  assert.match(root.querySelector(".tooltip").textContent, /Ereignisse: 0 Ereignisse ?Ø aus 1 Tagen/);
  // mit Regelmäßigkeit: Zelle ohne Daten ohne Zeilen zur Regelmäßigkeit, wenige Daten ohne Rahmen
  el.setConfig({ type: "custom:pattern-card", entity: "binary_sensor.wasche", mode: "heatmap", statistic: "events", days: 56, regularity: true });
  await flush(30);
  cell(3, 3).dispatchEvent(new w.MouseEvent("pointerover", { bubbles: true }));
  assert.doesNotMatch(root.querySelector(".tooltip").textContent, /Regelmäßigkeit/);
  cell(0, 10).dispatchEvent(new w.MouseEvent("pointerover", { bubbles: true }));
  assert.match(root.querySelector(".tooltip").textContent, /zu wenige Tage für den Rahmen/);
  assert.equal(root.querySelectorAll(".reg-run").length, 0);
  // Differenzzeile im Vergleich: fehlt eine Seite, ebenfalls Diagonale
  el.setConfig({ type: "custom:pattern-card", entity: "binary_sensor.wasche", mode: "heatmap", statistic: "events", days: 56, weekdays: ["mon", "tue", "wed", "thu", "fri"], weekdays_b: ["sat", "sun"] });
  await flush(30);
  // Wochenende ohne Daten: Gruppe entfällt, keine leere Zeile, keine Differenz
  assert.equal(root.querySelectorAll(".cell.diff").length, 0);
  el.remove();
}));

test("Graph: Hintergrund nur in Bereichen ohne jeden Referenzwert", () => {
  const now = P.wallToTs(2026, 11, 12, 12, 0, TZ);
  // Referenz nur 6–18 Uhr, an einem Tag (wenige Daten) zusätzlich 20 Uhr
  const days = P.buildDays(now, 14, TZ, 60);
  for (const d of days) {
    for (let k = 0; k < 24; k++) {
      if (d.b[k] >= now) break;
      const has = (k >= 6 && k < 18) || (k === 20 && d.ymd.d === 5) || d.isToday;
      if (has) P.accumulateStats([d], [{ start: d.b[k], end: d.b[k + 1], mean: 10 + k }], "mean", "hour");
    }
  }
  const m = P.computeModel(days, { statistic: "mean", now, mode: "graph", groups: [{ key: "reference", weekdays: new Set([0, 1, 2, 3, 4, 5, 6]) }] });
  assert.deepEqual([...P.noDataRanges(m.references, 24)].map((r) => [...r]), [[0, 5], [18, 19], [21, 23]]);
  assert.equal(m.references[0].stats[20].n, 1, "ein Tag reicht, keine Markierung");
  const ctx = {
    colors: { today: "#00f", refs: { reference: "#888" }, noData: "rgba(0,0,0,0.08)" },
    label: { today: "Heute", refs: { reference: "Referenz (Ø)" }, bandName: (r, key) => key, daysN: (n) => `${n}`, daysShort: (n) => `${n}`, wideNeedsDays: (n) => `ab ${n}` },
    fmtNumber: (x) => String(Math.round(x)), fmtTime: () => "t", unit: "W",
  };
  const g = P.buildGraph(m, ctx);
  const nd = g.data.find((x) => x.id === "nodata");
  assert.ok(nd, "Serie für fehlende Daten");
  assert.equal(nd.type, "custom");
  assert.equal(nd.z, 0, "unter Bändern (z 1) und Linien");
  assert.equal(nd.silent, true);
  const b = m.today.b;
  assert.deepEqual([...nd.data].map((x) => [...x]), [[b[0], b[6]], [b[18], b[20]], [b[21], b[24]]]);
  assert.ok(!g.options.legend.data.some((x) => x.id === "nodata"), "nicht in der Legende");
  // Zeichnen: Rechteck über die volle Höhe der Fläche, Breite aus der Zeitachse
  const rect = nd.renderItem({ coordSys: { x: 10, y: 5, width: 240, height: 100 } }, { value: (i) => nd.data[1][i], coord: ([x]) => [10 + ((x - b[0]) / (b[24] - b[0])) * 240, 0] });
  assert.equal(rect.type, "rect");
  assert.equal(rect.shape.y, 5);
  assert.equal(rect.shape.height, 100);
  assert.equal(Math.round(rect.shape.x), 190);
  assert.equal(Math.round(rect.shape.width), 20);
  assert.equal(rect.style.fill, "rgba(0,0,0,0.08)");
  // Tooltip ignoriert die Serie, Werte und Bänder unverändert
  const ref = g.data.find((x) => x.id === "ref-reference").data;
  assert.ok(g.options.tooltip.formatter([{ seriesId: "nodata", value: nd.data[0] }, { seriesId: "ref-reference", value: ref[8] }]).textContent.startsWith("t – t"));
  const plain = P.buildGraph(P.computeModel(filledDays(now, 14, (d, k) => k), { statistic: "mean", now, mode: "graph", groups: [{ key: "reference", weekdays: new Set([0, 1, 2, 3, 4, 5, 6]) }] }), ctx);
  assert.ok(!plain.data.some((x) => x.id === "nodata"), "volle Daten: keine Markierung");
  // die Zukunft von heute allein markiert nichts: Referenz hat dort Werte
  assert.equal(P.noDataRanges(plain.refs.map((r) => r.ref), 24).length, 0);
});

test("Legende: nur „Regelmäßigkeit (70 %)“, Englisch, Editor gleich benannt", () => withNow(WASHER_NOW, async () => {
  const { hass } = washerHass();
  hass.locale = { ...hass.locale, language: "en" };
  hass.language = "en";
  const el = mount({ type: "custom:pattern-card", entity: "binary_sensor.wasche", mode: "heatmap", statistic: "events", days: 56, regularity: { threshold: 65 } }, hass);
  await flush(20);
  assert.equal(el.shadowRoot.querySelector(".legend .reg-text").textContent, "Regularity (65%)");
  el.remove();
  const t = (k) => k;
  assert.ok(P.editorSchema({ mode: "heatmap" }, "state", t).some((f) => f.name === "regularity_enabled"));
}));

test("Tastatur: Raster fokussierbar, Pfeiltasten zeigen Zellen, Escape und Verlassen blenden aus", () => withNow(WASHER_NOW, async () => {
  const { hass } = washerHass();
  const el = mount({ type: "custom:pattern-card", entity: "binary_sensor.wasche", mode: "heatmap", statistic: "events", days: 56, weekdays: ["mon", "tue", "wed", "thu", "fri"], weekdays_b: ["sat", "sun"] }, hass);
  await flush(20);
  const root = el.shadowRoot;
  const grid = root.querySelector(".content > .heatmap");
  const tip = root.querySelector(".tooltip");
  assert.equal(grid.tabIndex, 0);
  assert.ok(grid.getAttribute("aria-label"));
  assert.equal(tip.getAttribute("role"), "status");
  const key = (k) => grid.dispatchEvent(new w.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  const hovered = () => { const c = root.querySelector(".cell.hover"); return c ? `${c.dataset.r}/${c.dataset.k}` : null; };
  key("ArrowRight");
  assert.equal(hovered(), "0/0", "erste Taste zeigt die erste Zelle");
  assert.equal(tip.hidden, false);
  key("ArrowRight"); key("ArrowRight");
  assert.equal(hovered(), "0/2");
  key("End");
  assert.equal(hovered(), "0/23");
  key("ArrowRight");
  assert.equal(hovered(), "0/23", "am Rand stehen bleiben");
  key("ArrowDown");
  assert.equal(hovered(), "1/23");
  key("ArrowDown");
  assert.equal(hovered(), "diff/23", "Differenzzeile erreichbar");
  assert.match(tip.textContent, /Δ|−/);
  key("ArrowDown");
  assert.equal(hovered(), "diff/23");
  key("Home");
  assert.equal(hovered(), "diff/0");
  key("ArrowUp"); key("ArrowUp"); key("ArrowUp");
  assert.equal(hovered(), "0/0");
  assert.equal(key("Escape"), false, "Escape verbraucht");
  assert.equal(tip.hidden, true);
  assert.equal(hovered(), null);
  key("Enter");
  assert.equal(hovered(), "0/0", "Enter zeigt die zuletzt gewählte Zelle wieder");
  grid.dispatchEvent(new w.FocusEvent("blur"));
  assert.equal(tip.hidden, true);
  // andere Tasten bleiben frei (Tab)
  assert.equal(key("Tab"), true);
  el.remove();
}));

for (const [name, fn] of tests) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${e.stack.split("\n").slice(0, 6).join("\n    ")}`);
  }
}
console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
process.exit(failed ? 1 : 0);

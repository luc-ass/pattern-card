import { JSDOM } from "jsdom";
import fs from "fs";
import assert from "assert/strict";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only", pretendToBeVisual: true });
const w = dom.window;
const src = fs.readFileSync(new URL("../pattern-card.js", import.meta.url), "utf8");
w.console.info = () => {};
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
  assert.deepEqual({ ...st[0] }, { n: 3, mean: 2, min: 1, max: 3, p25: 1.5, p75: 2.5 });
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
  assert.equal(all.refDays, 7);
  assert.equal(all.reference[0].n, 7);
  near(all.reference[0].mean, (5 + 6 + 7 + 8 + 9 + 10 + 11) / 7);
  assert.equal(all.todayVals[11], 12);
  assert.equal(all.todayVals[12], null);

  const thu = P.computeModel(days, { statistic: "sum", now, weekdays: P.selectedWeekdays({ weekdays: ["thu"] }), mode: "graph" });
  assert.equal(thu.refDays, 1);
  assert.equal(thu.reference[0].mean, 5);

  const cum = P.computeModel(days, { statistic: "sum", now, weekdays: P.selectedWeekdays({}), mode: "graph", cumulative: true });
  near(cum.reference[23].mean, 24 * (56 / 7));
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
  const el = mount({ type: "custom:pattern-card", entity: "sensor.leistung", days: 7 }, hass);
  await flush(20);
  const chart = el.shadowRoot.querySelector("ha-chart-base");
  assert.ok(chart, "ha-chart-base eingesetzt");
  const ids = [...chart.data].map((s) => s.id);
  assert.deepEqual(ids, ["band-low", "band", "reference", "today"]);
  assert.ok(Array.isArray(chart.options.dataZoom) && chart.options.dataZoom.length === 0);
  assert.equal(chart.zoomSlider, "never");
  assert.equal(chart.options.xAxis[0].type, "time");
  assert.equal(chart.options.yAxis.name, "W");
  const stat = calls.filter((c) => c.type === "recorder/statistics_during_period");
  assert.ok(stat.some((c) => c.period === "5minute"));
  assert.deepEqual({ ...stat[0].units }, { power: "W" });
  // Referenz: 96 Punkte, Mittel je Slot = Stundenwert
  const ref = chart.data.find((s) => s.id === "reference").data;
  assert.equal(ref.length, 96);
  near(ref[4][1], 510, 1e-9);
  // Tooltip
  const tipEl = chart.options.tooltip.formatter([{ value: ref[4] }]);
  assert.match(tipEl.textContent, /01:00 – 01:15/);
  assert.match(tipEl.textContent, /Referenz \(Ø\): 510 W/);
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
  const ref = chart.data.find((s) => s.id === "reference").data;
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
});

/* ---- Editor ---- */

test("Editor: Felder je Typ und Standardwerte nicht in der Konfiguration", async () => {
  const t = (k) => k;
  const names = (schema) => schema.flatMap((s) => (s.type === "grid" ? s.schema.map((x) => x.name) : [s.name]));
  assert.ok(names(P.editorSchema({ mode: "graph" }, "counter", t)).includes("cumulative"));
  assert.ok(!names(P.editorSchema({ mode: "graph" }, "measurement", t)).includes("statistic"));
  assert.ok(names(P.editorSchema({ mode: "heatmap" }, "state", t)).includes("statistic"));
  assert.ok(names(P.editorSchema({ mode: "heatmap" }, "state", t)).includes("max"));

  const ed = w.document.createElement("pattern-card-editor");
  const { hass } = makeHass({ "binary_sensor.m": { entity_id: "binary_sensor.m", state: "off", attributes: {} } }, () => []);
  ed.hass = hass;
  ed.setConfig({ type: "custom:pattern-card", entity: "binary_sensor.m", mode: "heatmap" });
  let out;
  ed.addEventListener("config-changed", (e) => { out = e.detail.config; });
  const form = ed.querySelector("ha-form");
  assert.deepEqual([...form.data.weekdays], [...P.WEEKDAYS]);
  form.dispatchEvent(new w.CustomEvent("value-changed", { detail: { value: { ...form.data, weekdays: ["sun", "mon"], statistic: "events" } } }));
  assert.deepEqual([...out.weekdays], ["mon", "sun"]);
  assert.equal(out.statistic, "events");
  assert.equal(out.resolution, undefined);
  form.dispatchEvent(new w.CustomEvent("value-changed", { detail: { value: { ...form.data, statistic: "active" } } }));
  assert.equal(out.weekdays, undefined);
  assert.equal(out.statistic, undefined);
});

for (const [name, fn] of tests) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${e.stack.split("\n").slice(0, 3).join("\n    ")}`);
  }
}
console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
process.exit(failed ? 1 : 0);

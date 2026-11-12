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
  // Stichtag vor dem Zeitraum: eine Referenz „Ab …“
  const legend = [...card.shadowRoot.querySelector("ha-chart-base").options.legend.data].map((x) => x.name);
  assert.match(legend[1], /^Ab 1\. Jan\.? \(Ø\)$/);
  card.remove();
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
  assert.deepEqual([...form.data.weekdays], [...P.WEEKDAYS]);
  form.dispatchEvent(new w.CustomEvent("value-changed", { detail: { value: { ...form.data, weekdays: ["sun", "mon"], statistic: "events" } } }));
  assert.deepEqual([...out.weekdays], ["mon", "sun"]);
  assert.equal(out.statistic, "events");
  assert.equal(out.resolution, undefined);
  assert.equal(out.compare, undefined);
  assert.equal(out.difference, undefined);
  form.dispatchEvent(new w.CustomEvent("value-changed", { detail: { value: { ...form.data, statistic: "active" } } }));
  assert.equal(out.weekdays, undefined);
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

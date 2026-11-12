# Spezifikation: pattern-card

Stand 2026-11-12, aus `INTERVIEW.md` und der Erkundung von HA 2026.11.1 (Frontend `20261028.5`, Referenz-Klon unter `.ref/frontend`, gitignored).

Lovelace-Custom-Card für **eine** Entity mit zwei Darstellungen:

- **`graph`**: Tagesverlauf heute (bis jetzt) gegen einen Referenzzeitraum. Die Referenz erscheint als Mittelwert-Linie mit Band.
- **`heatmap`**: Wochentag (Zeilen Mo–So) × Uhrzeit (Spalten).

Ziel ist, dass die Karte so nativ wie möglich wirkt: Aussehen, Tooltips, Theme-Variablen, Editor und Größen im Sections-Raster entsprechen den nativen Karten (`statistics-graph`, `history-graph`).

## Konfiguration

```yaml
type: custom:pattern-card
entity: sensor.flur_kg_stromzahler_netz_leistung
mode: graph                 # graph | heatmap
name: Strom                 # optional, Standard: Anzeigename der Entity
days: 28                    # Länge des Referenzzeitraums in Tagen, ohne heute
weekdays: [mon, tue, wed, thu, fri, sat, sun]   # Standard: alle
statistic: mean             # active | events | mean | sum, Standard nach Typ (s. u.)
resolution: auto            # auto | 5min | 15min | 30min | hour
# nur graph
band: iqr                   # iqr (25–75 %) | minmax | none
cumulative: false           # nur Zähler: kumuliert ab Mitternacht
# nur heatmap
color: "#ff9800"            # eine Farbe: Skala von transparent bis zur Farbe
# oder
colors: ["#e3f2fd", "#0d47a1"]   # zwei oder mehr Stufen von niedrig nach hoch
min: 0                      # optional, Skalengrenzen. Standard: aus den Daten
max: 100
```

Den Zeitraum legst du nur in der Konfiguration fest, in der Karte selbst gibt es keine Auswahl.

## Typen, Datenquelle und Werte

Die Karte erkennt den Typ der Entity und holt die Metadaten über `recorder/get_statistics_metadata`.

| Typ | Erkennung | Quelle | `statistic` angeboten | Standard |
| --- | --- | --- | --- | --- |
| Zustand | Domain `binary_sensor`, `light`, `switch`, `input_boolean`, `fan`, `person`, `device_tracker` … oder kein numerischer Zustand | Verlauf `history/history_during_period` (`minimal_response`, `no_attributes`, `significant_changes_only: false`) | `active`, `events` | `active` |
| Messwert | Statistik mit `has_mean` (`mean_type` 1) | `recorder/statistics_during_period`, `types: [mean, min, max]` | `mean` | `mean` |
| Zähler | Statistik mit `has_sum` | `recorder/statistics_during_period`, `types: [change]` | `sum` (Verbrauch je Slot, Ø je Tag) | `sum` |
| Numerisch ohne Statistik | numerischer Zustand, keine Metadaten | Verlauf, zeitgewichtet gemittelt | `mean` | `mean` |

- **`active`**: zeitgewichteter Anteil des Slots, in dem der Zustand aktiv war, in %. Als aktiv gilt, was auch HA als aktiv ansieht (wie `stateActive` im Frontend, z. B. `on`, `home`, `open`, `playing`). `unavailable` und `unknown` zählen nicht zum Nenner.
- **`events`**: Zahl der Wechsel von inaktiv nach aktiv je Slot, gemittelt über die Tage.
- **`mean`**: Mittelwert je Slot. Bei Statistik ist das der Mittelwert der Slot-Mittel, beim Verlauf zeitgewichtet.
- **`sum`**: Verbrauch je Slot (Summe der `change`-Werte), gemittelt über die Tage.
- Eine Schwelle für Messwerte („aktiv ab 50 W“) gibt es nicht. Dafür gibt es in HA den Threshold-Helfer.
- `mean_type` 2 (Kreismittel, etwa Windrichtung) wird nicht unterstützt und zeigt einen Hinweis.

## Zeitraster und Auflösung

- Die Slots beziehen sich auf die Ortszeit, und zwar auf die Zeitzone, die der Nutzer gewählt hat (`hass.locale.time_zone`: Server oder Browser). An Tagen mit Zeitumstellung (23 oder 25 h) zählen die Slots nach Uhrzeit, die doppelte Stunde wird zusammengefasst.
- Der Referenzzeitraum umfasst die `days` abgeschlossenen Tage vor heute, gefiltert nach `weekdays`. Heute ist nie Teil der Referenz. Die Heatmap zeigt nur abgeschlossene Slots.
- **`resolution: auto`**:
  - Graph mit Statistik: 15 min aus der 5-Minuten-Statistik, wenn diese den Zeitraum abdeckt (der erste Wert liegt höchstens einen Slot nach dem Beginn), sonst 1 h aus der Stundenstatistik.
  - Graph mit Verlauf: 15 min.
  - Heatmap: 1 h, also 24 Spalten. Mit 30 oder 15 min werden die Spalten schmaler, sinnvoll erst ab breiten Karten.
- Wird eine feinere Auflösung erzwungen, als die Daten hergeben (z. B. `5min` aus der Stundenstatistik), nimmt die Karte die feinste mögliche und zeigt einen Hinweis.
- **Befund an deiner Instanz**: Die 5-Minuten-Statistik bleibt so lange erhalten wie der Verlauf (`purge_keep_days: 100`). Das hängt an `purge_keep_days` und nicht am HA-Standard von 10 Tagen. Abfragezeiten: Stromzähler 5-min über 100 Tage etwa 0,1 s, Verlauf eines Bewegungsmelders unter 0,05 s.

## Graph

- Gezeichnet wird mit **`ha-chart-base`**, der ECharts-Komponente von HA, wie bei `statistics-graph`. Die x-Achse ist eine Zeitachse über den heutigen Tag von 0:00 bis 24:00, so formatiert HA die Uhrzeiten selbst.
- Serien:
  1. **Band**: gestapelte Flächen (unterer Rand transparent, Spanne gefüllt) in Referenzfarbe mit geringer Deckkraft. `iqr` = 25.–75. Perzentil. Bei weniger als 4 Referenztagen weicht das Band auf `minmax` aus, mit Hinweis im Tooltip.
  2. **Referenz-Mittel**: gestrichelte Linie in Referenzfarbe.
  3. **Heute**: kräftige Linie in `--graph-color-1` oder der Zustandsfarbe, endet bei „jetzt“.
- **Zustände**: Die Referenz zeigt den Anteil aktiv je Slot (0–100 %). Heute erscheint als Stufenfläche 0/100 % (aktiv ja/nein), beim Modus `events` als Balken mit der Zahl der Ereignisse je Slot.
- **Zähler**: Verbrauch je Slot, mit `cumulative: true` kumuliert ab Mitternacht („heute bis jetzt gegen sonst bis zu dieser Uhrzeit“).
- **Tooltip**: Uhrzeit, heute, Referenz-Mittel und Spanne mit Einheit, Zahl der Referenztage.
- **Kein Zoom**: Die Karte setzt `zoom-slider="never"` und übergibt ein eigenes `dataZoom`. Damit schaltet `ha-chart-base` das Zoomen per Ziehen und Mausrad ab (`_hasZoomableXAxis`).
- **Laden**: `ha-chart-base` lädt HA erst bei Bedarf. Die Karte lässt es über `loadCardHelpers().createCardElement({ type: "statistics-graph", … })` nachladen und wartet auf `customElements.whenDefined("ha-chart-base")`. Theme, Sprache und Zahlenformat holt sich die Komponente selbst über Lit-Context vom HA-Baum, `hass` muss nicht durchgereicht werden.
- **Risiko**: `ha-chart-base` ist intern. Der Graph steckt deshalb in einem eigenen Renderer-Modul mit schmaler Schnittstelle (Slots, Serien, Tooltip-Texte), damit er bei einem Bruch durch ein eigenes SVG ersetzt werden kann. Nach jedem HA-Update (Frontend-Version) ist der Graph zu prüfen.

## Heatmap

- Eigenes CSS-Raster in `ha-card`. 7 Zeilen Mo–So, ausgeblendete Wochentage entfallen. Die Spalten sind die Slots, beschriftet sind 0, 3, 6 … 21 Uhr. Die Wochentage stehen kurz in Landessprache (`Intl.DateTimeFormat`).
- **Farbe**: Interpoliert zwischen `colors`. Bei nur `color` reicht die Skala von 0 % bis 100 % Deckkraft. Standard ist die Zustandsfarbe der Entity (`--state-<domain>-<device_class>-on-color` → `--state-<domain>-active-color` → `--state-active-color`), bei Messwerten `--primary-color`. Slots ohne Daten zeigen `--secondary-background-color`.
- **Skala**: `min`/`max` aus der Konfiguration, sonst aus den Daten. Bei `active`, `events` und `sum` beginnt sie bei 0 und reicht bis zum größten Wert (nicht fest bis 100 %, sonst bliebe ein selten belegter Raum fast weiß), bei `mean` von min bis max über alle Zellen. Darunter steht eine schmale Legende mit Verlauf und Grenzwerten.
- **Tooltip** (auch per Tippen): Wochentag, Uhrzeit von bis, Wert mit Einheit, Zahl der Tage. Die Optik folgt dem Tooltip von `ha-chart-base` (Hintergrund `--card-background-color`, Schatten, Rundung).

## Aktualisierung

- Die Referenz wird beim Laden, bei geänderter Konfiguration und danach stündlich zur vollen Stunde neu berechnet.
- **Heute im Graph**: Mit Statistik lädt die Karte alle 5 Minuten neu (passend zum Takt der Kurzzeitstatistik), mit Verlauf beim nächsten Zustandswechsel der Entity in `hass.states`, gedrosselt auf 30 s.
- Nichts läuft, solange die Karte nicht sichtbar ist (`connectedCallback`/`disconnectedCallback`).

## Editor und Einbindung

- Der visuelle Editor nutzt `ha-form` mit nativen Selektoren: `entity`, `select` (Modus, Statistik, Auflösung, Band), `number` (Tage), `select` mit `multiple` (Wochentage) und `color_rgb`/`ui_color` für Farben. Die Felder für `statistic` hängen vom Typ der Entity ab.
- `getStubConfig` wählt einen Messwert mit Statistik, sonst einen Bewegungsmelder.
- `getGridOptions`: Graph `columns: 12, min_columns: 6, rows: 4, min_rows: 3`, Heatmap `columns: 12, min_columns: 6, rows: 3, min_rows: 2`. `getCardSize` für Masonry passend dazu.
- `window.customCards`-Eintrag mit Vorschau.
- Übersetzungen DE/EN in der Karte, gewählt nach `hass.locale.language`. Zahlen und Einheiten formatiert wie in HA (`hass.formatEntityState`/`formatEntityAttributeValue`, sonst `Intl.NumberFormat`).

## Fehler und Leerstände

| Fall | Anzeige |
| --- | --- |
| Entity fehlt | Native Warnung wie `hui-warning` („Entity nicht verfügbar“) |
| Keine Daten im Zeitraum | Karte mit Hinweis „Keine Daten im Zeitraum“ |
| Weniger Daten als `days` (Verlauf kürzer) | Auswertung mit den vorhandenen Tagen, Hinweis „x von y Tagen“ im Tooltip und klein unter dem Titel |
| `ha-chart-base` nicht ladbar | Hinweis in der Karte, die Heatmap funktioniert weiter |

## Projekt

- **Aufbau wie `ha-gauge-flex`**: eine Datei `pattern-card.js` ohne Build und ohne Fremdabhängigkeiten zur Laufzeit. Tests mit jsdom (`npm test`), `preview.html` aus `tools/build-preview.mjs`. In der Vorschau zeichnet ein kleiner Stub `ha-chart-base` nach, die Heatmap ist echt.
- **Repo `luc-ass/pattern-card`**, HACS (`hacs.json`, `content_in_root`). README auf Englisch, die Projekt-Doku auf Deutsch.
- **Installation an deiner Instanz** erst nach OK (Datei unter `/config/www/`, Ressource, Testdashboard), mit Eintrag im `CHANGELOG.md` von ha-organisation.
- **Testdaten**: Strom `sensor.flur_kg_stromzahler_netz_leistung` (Messwert), `sensor.flur_kg_stromzahler_netz_import` (Zähler), Gäste-WC `binary_sensor.bewegung_eg_gaste_wc` und `light.licht_eg_gaste_wc` (Zustände, Verlauf erst ab 09.11.2026).

## Entscheidungen nach dem Entwurf (2026-11-12)

- Zähler kumuliert: ja (`cumulative`)
- `active_state` für eigene aktive Zustände: nein
- Zähler bieten nur `sum`: ein „Mittel der Änderung je Slot“ wäre dasselbe wie der Verbrauch je Slot im Schnitt der Tage
- Heatmap als CSS-Raster statt SVG: passt sich ohne Messen der Breite und der Höhe im Sections-Raster an

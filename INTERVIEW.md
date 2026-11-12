# Interview: Muster-Karte (Arbeitstitel `pattern-card`)

Ziel: Lovelace-Karte, die Muster von Sensoren über wählbare Zeiträume zeigt.
Zwei Darstellungen:
- **Graph**: heutiger Verlauf gegen einen Referenzzeitraum (z. B. Strom heute vs. Woche, nach Uhrzeit)
- **Heatmap**: Wochentag × Stunde, Wert = Ereignisse, Anteil aktiv oder Mittelwert

Leitlinie: so nativ wie möglich in Funktion und Aussehen (HA-Frontend als Referenz).

## Rahmen (aus ha-organisation, 2026-11-12)
- HA 2026.11.1, `recorder: purge_keep_days: 100` (Verlauf 100 Tage, Langzeitstatistik unbegrenzt)
- Roadmap-Idee „Belegungsmuster der Räume“ (Start Gäste-WC, FBH-Heizzeiten danach ausrichten) wäre der erste Anwendungsfall
- Projektmuster wie `ha-gauge-flex`: eine JS-Datei, Tests mit jsdom, `preview.html`

## Antworten

### Runde 1
- **Datenquelle**: automatisch. Langzeitstatistik, wo vorhanden (state_class), sonst Verlauf (binary_sensor u. a., max. 100 Tage)
- **Graph-Referenz**: Mittelwert als Linie plus Band (Spanne, z. B. 25–75 %), heute kräftig darüber
- **Zeitraum**: nur in der Konfiguration, keine Auswahl in der Karte
- **Rendering**: hybrid. Graph über `ha-chart-base` (ECharts von HA), Heatmap als eigenes SVG/Grid

### Runde 2
- **Referenz im Graph**: Zeitraum wählbar (Konfiguration), darin Wochentage wählbar, Standard alle ausgewählt
- **Heatmap-Werte**: Anteil aktiv (%), Anzahl Ereignisse, Mittelwert, Summe/Verbrauch. Angeboten wird, was zum Typ des Sensors passt
- **Entities**: eine pro Karte
- **Editor/Verteilung**: visueller Editor (ha-form) und HACS, eigenes Repo unter luc-ass

### Runde 3
- **Auflösung**: so fein wie die Daten es hergeben. Kurze Zeiträume (z. B. heute gegen eine Woche) fein, längere gröber, wenn nur die Stundenstatistik reicht
- **Heatmap-Farben**: frei wählbar
- **Interaktion**: Tooltip mit Wert (kein More-Info, kein Zoom gewünscht)
- **Name/Sprache**: `pattern-card`, Repo `luc-ass/pattern-card`, Ordner `ha-pattern`, README Englisch, Karte übersetzt DE/EN

### Runde 4
- **Heatmap-Layout**: Wochentage als Zeilen (Mo–So), Uhrzeit nach rechts
- **Laufender Tag**: Referenz ohne heute. Graph: heute bis jetzt gegen abgeschlossene Tage. Heatmap: nur abgeschlossene Stunden
- **Schwelle für Messwerte**: nein. „Aktiv“ und „Ereignisse“ nur für Zustands-Entities (dafür gibt es den Threshold-Helfer in HA)
- **Weitere Darstellungen**: keine, erst Graph und Heatmap

## Abgeleitete Festlegungen (zur Bestätigung)
- Datenquelle und Auflösung werden automatisch gewählt. Messwert mit Statistik: kurzer Zeitraum (≤ 10 Tage) aus der 5-min-Statistik, länger aus der Stundenstatistik. Ohne Statistik: Verlauf, Raster fein (z. B. 15 min), bei langen Zeiträumen stündlich. Für den Verlauf gilt die Grenze von 100 Tagen
- Heatmap-Werte je Typ: Zustand → Anteil aktiv (Standard), Ereignisse. Messwert (`measurement`) → Mittelwert. Zähler (`total`/`total_increasing`) → Summe/Verbrauch (Standard), Mittelwert
- Wochentagsfilter gilt für Graph-Referenz und Heatmap-Zeilen
- Tooltip: Wochentag/Uhrzeit, Wert mit Einheit, Zahl der Tage, die eingeflossen sind

### Nachtrag 2026-11-12: Vergleich Werktage/Wochenende (0.2.0)
- Gewünscht: Ideen 1–4. Graph mit zwei Referenzen (Werktage, Wochenende), Referenz standardmäßig wie heute (Werktag oder Wochenende), Heatmap mit zwei Zeilen und Differenzzeile
- Feiertage (Workday-Integration) und eigene Gruppen erst später

### Nachtrag 2026-11-12: Bänder (0.3.0)
- Frage: zwei Standardabweichungen? Entscheidung: nein, stattdessen zwei Perzentil-Bänder (25–75 % innen, 10–90 % außen), ohne Option `sigma`

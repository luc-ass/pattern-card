# pattern-card

Lovelace-Custom-Card für Muster einer Entity (Graph heute gegen Referenz, Heatmap Wochentag × Uhrzeit). Repo `luc-ass/pattern-card`, Ordner `~/Projects/ha-pattern`.

Sprache: Doku, Commits und Rückfragen auf Deutsch. README auf Englisch (HACS).

- `INTERVIEW.md`: Entscheidungen von Lucas, `SPEC.md`: Spezifikation. Bei Abweichungen erst SPEC anpassen, nach Rückfrage
- Aufbau wie `~/Projects/ha-gauge-flex`: eine Datei `pattern-card.js` ohne Build, Tests mit jsdom (`npm test`), `npm run preview` baut `preview.html`
- Referenz: HA-Frontend in der installierten Version unter `.ref/frontend` (gitignored). Version steht in `homeassistant/components/frontend/manifest.json` des Core-Tags, bei HA-Updates neu klonen und `ha-chart-base` gegenprüfen
- Zugang zu HA, Testdaten und Freigaben: `~/Projects/ha-organisation/CLAUDE.md`. Installation in HA (Datei unter `/config/www/`, Ressource, Dashboard) nur nach OK und mit Eintrag im `CHANGELOG.md` von ha-organisation

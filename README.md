# Pattern Card

A Home Assistant Lovelace card that shows **patterns** of a single entity over a configurable period:

- **Graph**: today's curve against a reference period (mean line plus 25–75 % band), by time of day
- **Heatmap**: weekday × time of day, showing share of time active, number of events, mean or consumption

It is meant to look and behave like a native card: the graph uses Home Assistant's own chart component (`ha-chart-base`), theme colors and number/time formats follow your profile, and the data comes from long-term statistics where available, otherwise from history.

## Installation

### HACS (custom repository)
1. HACS → ⋮ → Custom repositories → `https://github.com/luc-ass/pattern-card`, type *Dashboard*
2. Install *Pattern Card*, reload the browser

### Manual
1. Copy `pattern-card.js` to `<config>/www/`
2. Settings → Dashboards → ⋮ → Resources → add `/local/pattern-card.js` as *JavaScript module*

## Examples

```yaml
# Power today vs. the last 4 weeks
type: custom:pattern-card
entity: sensor.grid_power
mode: graph
days: 28

# Energy since midnight vs. working days of the last 4 weeks
type: custom:pattern-card
entity: sensor.grid_energy_import
mode: graph
cumulative: true
weekdays: [mon, tue, wed, thu, fri]

# Room occupancy: weekday × hour
type: custom:pattern-card
entity: binary_sensor.motion_guest_toilet
mode: heatmap
days: 56
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `entity` | – | Entity to analyse (required) |
| `mode` | `graph` | `graph` or `heatmap` |
| `name` | friendly name | Card title, `false` hides it |
| `days` | `28` | Completed days before today used as reference |
| `weekdays` | all | Only these weekdays (`mon` … `sun`) |
| `statistic` | by type | `active`, `events` (states), `mean` (measurements), `sum` (counters) |
| `resolution` | `auto` | `auto`, `5min`, `15min`, `30min`, `hour`. Auto: graph 15 min where data allows, heatmap 1 h |
| `band` | `iqr` | Graph only: `iqr` (25–75 %), `minmax`, `none` |
| `cumulative` | `false` | Graph, counters only: consumption since midnight |
| `color` | state color | Today's line / heatmap color (hex, CSS or theme color name) |
| `colors` | – | Heatmap only: list of two or more colors, low → high |
| `min`, `max` | from data | Heatmap only: scale limits |

### Data sources

| Entity | Source | Values |
| --- | --- | --- |
| On/off-like states (`binary_sensor`, `light`, `switch`, `person`, …) | History (limited by `recorder: purge_keep_days`) | share active, events |
| Events, buttons, scenes | History | events |
| Sensors with `state_class: measurement` | Long-term statistics | mean |
| Counters (`total`, `total_increasing`) | Long-term statistics | consumption |
| Numeric sensors without statistics | History | time-weighted mean |

The reference never includes today; the heatmap only uses completed time slots.

## Development

`npm test` runs the jsdom tests, `npm run preview` builds `preview.html` with simulated data (graph drawn by a small ECharts stand-in for `ha-chart-base`).

> Note: `ha-chart-base` is an internal component of the Home Assistant frontend. The card is tested against frontend `20261028.5` (HA 2026.11); check the graph after Home Assistant updates.

## License

MIT

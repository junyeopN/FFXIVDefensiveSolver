# FFXIV Defensive Solver

Auto-assigns party defensive cooldowns to boss mechanics from an fflogs log,
and writes the plan as a new tab in a Google Sheet.

## Setup

1. `npm install`
2. Copy `.env.local.example` to `.env.local` and fill in:
   - `FFLOGS_CLIENT_ID` / `FFLOGS_CLIENT_SECRET` — create a v2 API client at
     https://www.fflogs.com/api/clients
   - `GOOGLE_SERVICE_ACCOUNT_KEY` — Google Cloud service account JSON (one
     line) with the Sheets API enabled
   - `MITIGATION_SPREADSHEET_ID` — a spreadsheet you own, shared with the
     service account's email as Editor. Each generated plan becomes a new tab
     in it (service accounts cannot own files, so the app never creates
     spreadsheets of its own).
3. `npm run dev` → http://localhost:3000
4. First time only: open the spreadsheet in a desktop browser, click a `#REF!`
   icon cell, and press "Allow access" so `=IMAGE()` may load icons from
   GitHub.

## Usage

Pick your party composition, paste an fflogs report URL including `?fight=N`
or `?fight=last`, and press **Create Mitigation Sheet**. The plan renders
inline and is exported as a new tab (fight name + timestamp) in your
spreadsheet, with skill icons, red rows for unsurvivable hits, and purple
text for Dark (unmitigable) damage.

## Data

- `data/skills.json` — defensive skill database (cooldowns, effects, icons)
- `data/fights/<encounterID>.json` — optional per-fight classification overrides
- `icons/` — ability and job icons fetched from XIVAPI (`scripts/fetch_icons.py`)

## Testing

`npm test` — unit tests are offline; the live fflogs test runs only when
credentials are present in `.env.local`.

## Design

See `docs/superpowers/specs/2026-07-10-ffxiv-defense-solver-design.md` and
`docs/superpowers/plans/2026-07-10-ffxiv-defense-solver.md`.

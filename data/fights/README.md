# Per-fight overrides

Optional. One file per encounter: `<encounterID>.json` (fflogs encounter id).

```json
{
  "abilities": {
    "12345": { "category": "Tankbuster", "type": "Dark", "mitigable": false, "name": "Nicer Name" }
  },
  "untargetable": [[120000, 180000]]
}
```

- `abilities` keys are fflogs ability game IDs (as strings). All fields optional.
- `untargetable` is a list of `[startMs, endMs]` windows (fight-relative) where the
  boss cannot be targeted, blocking needsTarget skills like Reprisal/Feint/Addle.

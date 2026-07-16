"""Download FFXIV party-mitigation ability icons from XIVAPI v2."""
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://v2.xivapi.com/api"
OUT = Path(__file__).resolve().parent.parent / "icons"

# ability name -> job/role tag (used only for filename prefix)
ABILITIES = {
    # Tank
    "Reprisal": "tank",
    "Divine Veil": "pld",
    "Passage of Arms": "pld",
    "Shake It Off": "war",
    "Dark Missionary": "drk",
    "Heart of Light": "gnb",
    # Melee
    "Feint": "melee",
    "Mantra": "mnk",
    # Physical ranged
    "Troubadour": "brd",
    "Tactician": "mch",
    "Dismantle": "mch",
    "Shield Samba": "dnc",
    # Caster
    "Addle": "caster",
    "Magick Barrier": "rdm",
    # Healer
    "Temperance": "whm",
    "Asylum": "whm",
    "Liturgy of the Bell": "whm",
    "Sacred Soil": "sch",
    "Fey Illumination": "sch",
    "Expedient": "sch",
    "Seraphism": "sch",
    "Collective Unconscious": "ast",
    "Neutral Sect": "ast",
    "Macrocosmos": "ast",
    "Sun Sign": "ast",
    "Kerachole": "sge",
    "Holos": "sge",
    "Panhaima": "sge",
    "Physis II": "sge",
    # Single-target mits (healer ST + tank externals)
    "Divine Benison": "whm",
    "Aquaveil": "whm",
    "Protraction": "sch",
    "Exaltation": "ast",
    "Celestial Intersection": "ast",
    "Haima": "sge",
    "Taurochole": "sge",
    "Intervention": "pld",
    "Cover": "pld",
    "Nascent Flash": "war",
    "The Blackest Night": "drk",
    "Oblation": "drk",
    "Heart of Corundum": "gnb",
    # Tank personals (incl. pre-upgrade versions for level sync)
    "Rampart": "tank",
    "Hallowed Ground": "pld",
    "Guardian": "pld",
    "Sentinel": "pld",
    "Holy Sheltron": "pld",
    "Sheltron": "pld",
    "Bulwark": "pld",
    "Holmgang": "war",
    "Damnation": "war",
    "Vengeance": "war",
    "Bloodwhetting": "war",
    "Raw Intuition": "war",
    "Thrill of Battle": "war",
    "Living Dead": "drk",
    "Shadowed Vigil": "drk",
    "Shadow Wall": "drk",
    "Dark Mind": "drk",
    "Superbolide": "gnb",
    "Great Nebula": "gnb",
    "Nebula": "gnb",
    "Camouflage": "gnb",
}

# job abbreviation -> ClassJob row id
JOBS = {
    "pld": 19, "war": 21, "drk": 32, "gnb": 37,
    "whm": 24, "sch": 28, "ast": 33, "sge": 40,
    "mnk": 20, "drg": 22, "nin": 30, "sam": 34, "rpr": 39, "vpr": 41,
    "brd": 23, "mch": 31, "dnc": 38,
    "blm": 25, "smn": 27, "rdm": 35, "pct": 42,
}
# 062000 + ClassJob row id = the classic job icons (party list set).
# This is the only series actually indexed by job id; _hr1 doubles it to 56px.
JOB_ICON_BASE = 62000


def get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "ffxiv-defense-planner"})
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def main() -> None:
    OUT.mkdir(exist_ok=True)
    manifest = {}
    failures = []
    for name, tag in ABILITIES.items():
        query = urllib.parse.quote(f'Name="{name}"')
        url = (
            f"{API}/search?sheets=Action&query={query}"
            "&fields=Name,Icon,IsPlayerAction,IsPvP,ClassJobLevel"
        )
        results = get_json(url)["results"]
        # PvP/duplicate rows share names; real actions have IsPlayerAction=true
        rows = [
            r
            for r in results
            if r["fields"].get("IsPlayerAction") and not r["fields"].get("IsPvP")
        ]
        if not rows:
            failures.append(name)
            print(f"FAIL  {name}: no player action found")
            continue
        row = rows[0]
        icon = row["fields"]["Icon"]
        asset_url = f"{API}/asset?path={icon['path_hr1']}&format=png"
        fname = f"{tag}_{slugify(name)}.png"
        req = urllib.request.Request(
            asset_url, headers={"User-Agent": "ffxiv-defense-planner"}
        )
        with urllib.request.urlopen(req) as r:
            (OUT / fname).write_bytes(r.read())
        manifest[name] = {
            "job": tag,
            "action_id": row["row_id"],
            "icon_id": icon["id"],
            "file": fname,
        }
        print(f"OK    {name} -> {fname} (action {row['row_id']}, icon {icon['id']})")
        time.sleep(0.15)  # be polite to the API

    jobs_dir = OUT / "jobs"
    jobs_dir.mkdir(exist_ok=True)
    for abbr, job_id in JOBS.items():
        icon_id = JOB_ICON_BASE + job_id
        path = f"ui/icon/{icon_id // 1000 * 1000:06d}/{icon_id:06d}_hr1.tex"
        req = urllib.request.Request(
            f"{API}/asset?path={path}&format=png",
            headers={"User-Agent": "ffxiv-defense-planner"},
        )
        with urllib.request.urlopen(req) as r:
            (jobs_dir / f"{abbr}.png").write_bytes(r.read())
        print(f"OK    job {abbr.upper()} -> jobs/{abbr}.png")
        time.sleep(0.15)

    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"\n{len(manifest)} ability icons + {len(JOBS)} job icons saved to {OUT}")
    if failures:
        print(f"Failed: {failures}")


if __name__ == "__main__":
    main()

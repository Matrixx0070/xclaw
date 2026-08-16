import json, re, shutil
from pathlib import Path
import os
HF = Path(os.environ.get("WILDCLAW_HF_DIR", "/tmp/wc-hf/WildClawBench-data")) / "workspace"
OUT = Path("eval/fixtures/wc")
OUT.mkdir(parents=True, exist_ok=True)
MAX_FILES = int(os.environ.get("WILDCLAW_MAX_FIXTURE_FILES", "80"))
mapped = []
if not HF.is_dir():
    raise SystemExit(f"missing HF workspace at {HF} — run wave-b-fetch first")
for cat in sorted(HF.iterdir()):
    if not cat.is_dir():
        continue
    for task in sorted(cat.iterdir()):
        if not task.is_dir():
            continue
        content = task / "exec" if (task / "exec").is_dir() else task
        nfiles = sum(1 for p in content.rglob("*") if p.is_file())
        if nfiles > MAX_FILES:
            print("SKIP", cat.name, task.name, nfiles)
            continue
        fixture_id = f"wc-{cat.name}-{task.name}"
        dest = OUT / fixture_id
        if dest.exists():
            shutil.rmtree(dest)
        dest.mkdir(parents=True)
        for item in content.iterdir():
            t = dest / item.name
            if item.is_dir():
                shutil.copytree(item, t, dirs_exist_ok=True)
            else:
                shutil.copy2(item, t)
        n = sum(1 for p in dest.rglob("*") if p.is_file())
        mapped.append({"fixture": fixture_id, "files": n})
        print("OK", fixture_id, n)
Path("reports/autonomy").mkdir(parents=True, exist_ok=True)
Path("reports/autonomy/wave-b-fixtures.json").write_text(json.dumps(mapped, indent=2))
# link cases
cases_path = Path("eval/cases/wildclaw-wave-a.json")
if cases_path.exists():
    cases = json.loads(cases_path.read_text())
    for c in cases:
        m = re.match(r"wc-a-(0\d_[A-Za-z_]+)_task_(\d+_.+)", c["id"])
        if not m:
            continue
        fx = f"wc-{m.group(1)}-task_{m.group(2)}"
        if (OUT / fx).is_dir():
            c["fixture"] = f"wc/{fx}"
            c["tags"] = sorted(set(c.get("tags") or []) | {"wave-b", "fixture"})
    cases_path.write_text(json.dumps(cases, indent=2) + "\n")
    wb = [c for c in cases if c.get("fixture")]
    Path("eval/cases/wildclaw-wave-b.json").write_text(json.dumps(wb, indent=2) + "\n")
    print("linked", len(wb))
print("fixtures", len(mapped))

"""Bundle the native menu sources into the DLL's UTF-8 resource."""
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "build/generated"
OUT.mkdir(parents=True, exist_ok=True)
catalog = json.loads((ROOT / "src/mod/catalog.json").read_text(encoding="utf-8-sig"))
prefix = "const CATALOG=" + json.dumps(catalog, ensure_ascii=False) + ";\n"
prefix += "const INITIAL_CONFIG=JSON.parse(__settings()||'{}');\n"
payload = prefix + (ROOT / "src/mod/ui.js").read_text(encoding="utf-8")
payload += (ROOT / "src/mod/core.js").read_text(encoding="utf-8")
shim = (ROOT / "src/native/shim.js").read_text(encoding="utf-8")
(OUT / "mod.js").write_text(payload, encoding="utf-8")
(OUT / "embedded.js").write_text(shim + "\n" + payload, encoding="utf-8")
resource = (OUT / "embedded.js").as_posix()
(OUT / "mod.rc").write_text(f'#pragma code_page(65001)\n101 RCDATA "{resource}"\n', encoding="utf-8")
print(f"Bundled {len(payload.encode('utf-8')):,} bytes of menu code")

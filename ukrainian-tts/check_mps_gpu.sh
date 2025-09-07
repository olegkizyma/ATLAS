#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -x .venv/bin/python ]; then
  echo "[setup] creating venv"
  python3 -m venv .venv
fi
. .venv/bin/activate

python - <<'PY'
import json, platform, importlib.util, time
out = {}
has_torch = importlib.util.find_spec("torch") is not None
out["torch_present"] = has_torch
if not has_torch:
    print(json.dumps(out, ensure_ascii=False, indent=2))
    raise SystemExit(0)
import torch
out["python"] = platform.python_version()
out["platform"] = platform.platform()
out["torch_version"] = getattr(torch, "__version__", None)
out["cuda_available"] = bool(getattr(torch, 'cuda', None) and torch.cuda.is_available())
out["cuda_device_count"] = torch.cuda.device_count() if out["cuda_available"] else 0
out["has_mps"] = hasattr(torch.backends, 'mps')
out["mps_is_built"] = torch.backends.mps.is_built() if out["has_mps"] else False
out["mps_is_available"] = torch.backends.mps.is_available() if out["has_mps"] else False
if out["cuda_available"]:
    out["preferred"] = "cuda"
elif out["mps_is_available"]:
    out["preferred"] = "mps"
else:
    out["preferred"] = "cpu"

if out["preferred"] == "mps":
    try:
        a = torch.randn(1536,1536, device='mps')
        b = torch.randn(1536,1536, device='mps')
        torch.mps.synchronize()
        t0 = time.time(); c = a @ b; torch.mps.synchronize()
        out["mps_matmul_ms"] = round((time.time() - t0) * 1000, 2)
        out["mps_result_mean"] = float(c.mean().cpu())
    except Exception as e:
        out["mps_test_error"] = str(e)

print(json.dumps(out, ensure_ascii=False, indent=2))
PY

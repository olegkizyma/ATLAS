#!/usr/bin/env python3
"""Model diagnostics tool for ATLAS openai-compatible backend.

Checks a list of model IDs by issuing a minimal chat completion request
and reports:
  - http_status
  - latency_ms
  - ok (True if non-empty assistant content)
  - error_kind (timeout / http_error / parse_error / empty / none)
  - content_preview (first 80 chars)

Usage (from repo root):
  python scripts/model_diagnostics.py            # tests default failed set
  python scripts/model_diagnostics.py --all      # tests all models from /v1/models
  python scripts/model_diagnostics.py model1 model2 ...

Env:
  API_BASE (default http://127.0.0.1:3010/v1)
  TIMEOUT_SECONDS (default 8)
"""
from __future__ import annotations
import os, sys, json, time, textwrap
from typing import List, Dict, Any
import argparse
import urllib.request
import urllib.error

DEFAULT_FAILED_MODELS = [
    # From recent orchestrator report phase failures
    "openai/o3",
    "openai/gpt-5-nano",
    "mistral-ai/ministral-3b",
    "microsoft/phi-3-mini-4k-instruct",
    "mistral-ai/mistral-small-2503",
    "microsoft/phi-3.5-mini-instruct",
    "openai/gpt-4o-mini",
    "microsoft/phi-3-mini-128k-instruct",
    "meta/meta-llama-3.1-8b-instruct",
    "openai/gpt-4.1-mini",
    "microsoft/phi-3-small-8k-instruct",
    "microsoft/phi-3-small-128k-instruct",
    "ai21-labs/ai21-jamba-1.5-mini",
    "microsoft/phi-4-mini-instruct",
    "openai/o4-mini",
    "mistral-ai/mistral-medium-2505",
    "xai/grok-3-mini",
    # Earlier blacklist examples
    "xai/grok-3",
    "openai/gpt-4o"
]

def fetch_all_models(api_base: str, timeout: int) -> List[str]:
    url = f"{api_base}/models"
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            data = json.load(r)
        return [m["id"] for m in data.get("data", [])]
    except Exception as e:
        print(f"[WARN] Could not fetch models list: {e}", file=sys.stderr)
        return []

def test_model(api_base: str, model: str, timeout: int) -> Dict[str, Any]:
    url = f"{api_base}/chat/completions"
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "PING"}],
        "max_tokens": 8,
        "temperature": 0.1
    }
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    start = time.perf_counter()
    result: Dict[str, Any] = {"model": model}
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            latency = (time.perf_counter() - start) * 1000
            body = r.read().decode(errors="replace")
            result["http_status"] = r.status
            # Try parse
            try:
                js = json.loads(body)
            except json.JSONDecodeError:
                result.update(ok=False, error_kind="parse_error", latency_ms=int(latency), raw_preview=body[:120])
                return result
            # Extract content
            content = ""
            if isinstance(js, dict):
                choices = js.get("choices") or []
                if choices:
                    msg = choices[0].get("message") or {}
                    content = (msg.get("content") or "").strip()
            if content:
                result.update(ok=True, latency_ms=int(latency), content_preview=content[:80])
            else:
                result.update(ok=False, error_kind="empty", latency_ms=int(latency), content_preview="")
    except urllib.error.HTTPError as e:
        latency = (time.perf_counter() - start) * 1000
        body = e.read().decode(errors="replace") if hasattr(e, 'read') else ''
        result.update(ok=False, http_status=e.code, error_kind="http_error", latency_ms=int(latency), raw_preview=body[:120])
    except Exception as e:
        latency = (time.perf_counter() - start) * 1000
        result.update(ok=False, error_kind=type(e).__name__, latency_ms=int(latency))
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("models", nargs="*", help="Specific model IDs to test")
    parser.add_argument("--all", action="store_true", help="Test all models returned by /models")
    parser.add_argument("--json", action="store_true", help="Output raw JSON summary")
    args = parser.parse_args()

    api_base = os.environ.get("API_BASE", "http://127.0.0.1:3010/v1")
    timeout = int(os.environ.get("TIMEOUT_SECONDS", "8"))

    if args.all:
        models = fetch_all_models(api_base, timeout)
    elif args.models:
        models = args.models
    else:
        models = DEFAULT_FAILED_MODELS

    if not models:
        print("No models to test.")
        return 1

    print(f"[INFO] Testing {len(models)} models (api_base={api_base}, timeout={timeout}s)\n")
    results = []
    for m in models:
        r = test_model(api_base, m, timeout)
        results.append(r)
        status = "OK" if r.get("ok") else "FAIL"
        detail = r.get("error_kind", "") if not r.get("ok") else r.get("content_preview", "")
        print(f"{status:4} | {r.get('latency_ms','-'):>5} ms | {m} | {detail}")
    ok_count = sum(1 for r in results if r.get("ok"))
    print(f"\n[SUMMARY] {ok_count}/{len(results)} models returned non-empty content.")

    if not ok_count:
        print("[CRITICAL] All tested models failed / empty.")
    elif ok_count < 4:
        print("[WARN] Low number of working models — pipeline may stall.")
    else:
        print("[INFO] Sufficient working models detected.")

    if args.json:
        print("\n" + json.dumps(results, ensure_ascii=False, indent=2))

    return 0

if __name__ == "__main__":
    raise SystemExit(main())

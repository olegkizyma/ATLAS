# Shim to restore scipy.signal.kaiser for libraries expecting the old import path
# Loaded automatically by Python if present on sys.path (sitecustomize)
try:
    import scipy.signal as _sig
    try:
        _ = _sig.kaiser  # type: ignore[attr-defined]
    except AttributeError:
        from scipy.signal.windows import kaiser as _kaiser  # type: ignore
        setattr(_sig, 'kaiser', _kaiser)
except Exception:
    # Fail silently: this file should not break interpreter startup
    pass

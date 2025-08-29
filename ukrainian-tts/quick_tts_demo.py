from ukrainian_tts.tts import TTS, Voices, Stress
import argparse
import traceback
import io
import os
import json
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt, tf2sos
import librosa


def main() -> None:
    parser = argparse.ArgumentParser(description="Ukrainian TTS quick demo")
    voices = [v.value for v in Voices]
    parser.add_argument("--text", default="Привіт, як у тебе справи?", help="Text to synthesize")
    parser.add_argument("--out", default="test.wav", help="Output WAV file path")
    parser.add_argument("--device", default="cpu", choices=["cpu", "mps", "gpu"], help="Device to use")
    parser.add_argument("--voice", default="dmytro", choices=voices, help="Voice to use")
    parser.add_argument("--fx", default="none", choices=["none", "robot_bass", "robot_bass_grit", "robot_bass_clean", "anonymous", "grit_clean", "grit_ultraclean"], help="Post-effect to apply")
    parser.add_argument("--speed", type=float, default=1.0, help="Time-stretch rate: <1 slower, >1 faster (e.g., 0.9)")
    parser.add_argument("--fx-config", default=None, help="Path to FX config JSON (optional)")

    args = parser.parse_args()

    text = args.text
    out_path = args.out

    try:
        # Init TTS with device; fallback if MPS float64 issue
        try:
            tts = TTS(device=args.device)
        except TypeError as e:
            if args.device == "mps" and "float64" in str(e).lower():
                print("[warn] MPS не підтримує float64. Перехід на CPU…")
                tts = TTS(device="cpu")
            else:
                raise

        # Synthesize to memory for post-processing
        buf = io.BytesIO()
        _, accented = tts.tts(text, args.voice, Stress.Dictionary.value, buf)
        buf.seek(0)
        audio, sr = sf.read(buf, dtype="float32")

        if audio.ndim > 1:
            audio = audio.mean(axis=1)

        # Optional time-stretch (before FX)
        if args.speed and abs(args.speed - 1.0) > 1e-3:
            try:
                audio = librosa.effects.time_stretch(audio, rate=args.speed)
            except Exception:
                pass

        if args.fx == "robot_bass":
            # Pitch down ~ -4 semitones
            try:
                audio = librosa.effects.pitch_shift(audio, sr=sr, n_steps=-4)
            except Exception:
                pass

            # Smooth ring-modulation
            mod_freq = 80.0
            t = np.arange(len(audio)) / sr
            ring = np.sin(2 * np.pi * mod_freq * t).astype(np.float32)
            audio = 0.9 * audio + 0.1 * (audio * ring)

            def highpass(sig: np.ndarray, cutoff: float) -> np.ndarray:
                sos = butter(2, cutoff / (sr / 2), btype="high", output="sos")
                y = sosfilt(sos, sig)
                return np.asarray(y, dtype=np.float32)

            audio = highpass(audio, 40.0)

            def rbj_lowshelf(sig: np.ndarray, f0: float, gain_db: float, S: float = 0.707) -> np.ndarray:
                A = 10 ** (gain_db / 40)
                w0 = 2 * np.pi * f0 / sr
                alpha = np.sin(w0) / (2 * S)
                cosw0 = np.cos(w0)
                b0 = A * ((A + 1) - (A - 1) * cosw0 + 2 * np.sqrt(A) * alpha)
                b1 = 2 * A * ((A - 1) - (A + 1) * cosw0)
                b2 = A * ((A + 1) - (A - 1) * cosw0 - 2 * np.sqrt(A) * alpha)
                a0 = (A + 1) + (A - 1) * cosw0 + 2 * np.sqrt(A) * alpha
                a1 = -2 * ((A - 1) + (A + 1) * cosw0)
                a2 = (A + 1) + (A - 1) * cosw0 - 2 * np.sqrt(A) * alpha
                b = np.array([b0, b1, b2], dtype=np.float64) / a0
                a = np.array([1.0, a1 / a0, a2 / a0], dtype=np.float64)
                sos = tf2sos(b, a)
                y = sosfilt(sos, sig)
                return np.asarray(y, dtype=np.float32)

            audio = rbj_lowshelf(audio, 120.0, gain_db=6.0)

            def lowpass(sig: np.ndarray, cutoff: float) -> np.ndarray:
                sos = butter(4, cutoff / (sr / 2), btype="low", output="sos")
                y = sosfilt(sos, sig)
                return np.asarray(y, dtype=np.float32)

            audio = lowpass(audio, 7000.0)

            def rbj_highshelf(sig: np.ndarray, f0: float, gain_db: float, S: float = 0.707) -> np.ndarray:
                A = 10 ** (gain_db / 40)
                w0 = 2 * np.pi * f0 / sr
                alpha = np.sin(w0) / (2 * S)
                cosw0 = np.cos(w0)
                b0 = A * ((A + 1) + (A - 1) * cosw0 + 2 * np.sqrt(A) * alpha)
                b1 = -2 * A * ((A - 1) + (A + 1) * cosw0)
                b2 = A * ((A + 1) + (A - 1) * cosw0 - 2 * np.sqrt(A) * alpha)
                a0 = (A + 1) - (A - 1) * cosw0 + 2 * np.sqrt(A) * alpha
                a1 = 2 * ((A - 1) - (A + 1) * cosw0)
                a2 = (A + 1) - (A - 1) * cosw0 - 2 * np.sqrt(A) * alpha
                b = np.array([b0, b1, b2], dtype=np.float64) / a0
                a = np.array([1.0, a1 / a0, a2 / a0], dtype=np.float64)
                sos = tf2sos(b, a)
                y = sosfilt(sos, sig)
                return np.asarray(y, dtype=np.float32)

            audio = rbj_highshelf(audio, 6500.0, gain_db=-3.0)

            def soft_compander(sig: np.ndarray, thresh: float = 0.6, ratio: float = 1.6) -> np.ndarray:
                x = sig.copy()
                mag = np.abs(x)
                over = mag > thresh
                x[over] = np.sign(x[over]) * (thresh + (mag[over] - thresh) / ratio)
                return x.astype(np.float32)

            audio = soft_compander(audio, thresh=0.6, ratio=1.6)
        
        elif args.fx == "robot_bass_grit":
            # Deeper pitch
            try:
                audio = librosa.effects.pitch_shift(audio, sr=sr, n_steps=-6)
            except Exception:
                pass

            # Saturation + bitcrusher
            def saturate(sig: np.ndarray, drive: float = 2.8) -> np.ndarray:
                x = np.tanh(drive * sig)
                return (x / np.tanh(drive)).astype(np.float32)

            def sample_hold(sig: np.ndarray, n: int = 3) -> np.ndarray:
                if n <= 1:
                    return sig.astype(np.float32)
                held = np.repeat(sig[::n], n)
                if len(held) < len(sig):
                    held = np.pad(held, (0, len(sig) - len(held)))
                return held[: len(sig)].astype(np.float32)

            def quantize(sig: np.ndarray, bits: int = 10) -> np.ndarray:
                levels = float(2 ** bits - 1)
                y = np.round(((sig + 1.0) * 0.5) * levels) / levels
                return (y * 2.0 - 1.0).astype(np.float32)

            a_sat = saturate(audio, drive=2.8)
            a_hold = sample_hold(a_sat, n=3)
            a_bits = quantize(a_hold, bits=10)
            audio = 0.75 * audio + 0.25 * a_bits

            # Short delay
            delay_ms = 6.0
            d = max(1, int(sr * delay_ms / 1000.0))
            delayed = np.concatenate([np.zeros(d, dtype=np.float32), audio[:-d]])
            audio = 0.85 * audio + 0.15 * delayed

            def highpass(sig: np.ndarray, cutoff: float) -> np.ndarray:
                sos = butter(2, cutoff / (sr / 2), btype="high", output="sos")
                y = sosfilt(sos, sig)
                return np.asarray(y, dtype=np.float32)

            audio = highpass(audio, 40.0)

            def rbj_lowshelf(sig: np.ndarray, f0: float, gain_db: float, S: float = 0.707) -> np.ndarray:
                A = 10 ** (gain_db / 40)
                w0 = 2 * np.pi * f0 / sr
                alpha = np.sin(w0) / (2 * S)
                cosw0 = np.cos(w0)
                b0 = A * ((A + 1) - (A - 1) * cosw0 + 2 * np.sqrt(A) * alpha)
                b1 = 2 * A * ((A - 1) - (A + 1) * cosw0)
                b2 = A * ((A + 1) - (A - 1) * cosw0 - 2 * np.sqrt(A) * alpha)
                a0 = (A + 1) + (A - 1) * cosw0 + 2 * np.sqrt(A) * alpha
                a1 = -2 * ((A - 1) + (A + 1) * cosw0)
                a2 = (A + 1) + (A - 1) * cosw0 - 2 * np.sqrt(A) * alpha
                b = np.array([b0, b1, b2], dtype=np.float64) / a0
                a = np.array([1.0, a1 / a0, a2 / a0], dtype=np.float64)
                sos = tf2sos(b, a)
                y = sosfilt(sos, sig)
                return np.asarray(y, dtype=np.float32)

            audio = rbj_lowshelf(audio, 110.0, gain_db=8.0)

            def lowpass(sig: np.ndarray, cutoff: float) -> np.ndarray:
                sos = butter(4, cutoff / (sr / 2), btype="low", output="sos")
                y = sosfilt(sos, sig)
                return np.asarray(y, dtype=np.float32)

            audio = lowpass(audio, 6500.0)

            def rbj_highshelf(sig: np.ndarray, f0: float, gain_db: float, S: float = 0.707) -> np.ndarray:
                A = 10 ** (gain_db / 40)
                w0 = 2 * np.pi * f0 / sr
                alpha = np.sin(w0) / (2 * S)
                cosw0 = np.cos(w0)
                b0 = A * ((A + 1) + (A - 1) * cosw0 + 2 * np.sqrt(A) * alpha)
                b1 = -2 * A * ((A - 1) + (A + 1) * cosw0)
                b2 = A * ((A + 1) + (A - 1) * cosw0 - 2 * np.sqrt(A) * alpha)
                a0 = (A + 1) - (A - 1) * cosw0 + 2 * np.sqrt(A) * alpha
                a1 = 2 * ((A - 1) - (A + 1) * cosw0)
                a2 = (A + 1) - (A - 1) * cosw0 - 2 * np.sqrt(A) * alpha
                b = np.array([b0, b1, b2], dtype=np.float64) / a0
                a = np.array([1.0, a1 / a0, a2 / a0], dtype=np.float64)
                sos = tf2sos(b, a)
                y = sosfilt(sos, sig)
                return np.asarray(y, dtype=np.float32)

            audio = rbj_highshelf(audio, 6000.0, gain_db=-4.0)

            def soft_compander(sig: np.ndarray, thresh: float = 0.5, ratio: float = 2.0) -> np.ndarray:
                x = sig.copy()
                mag = np.abs(x)
                over = mag > thresh
                x[over] = np.sign(x[over]) * (thresh + (mag[over] - thresh) / ratio)
                return x.astype(np.float32)

            audio = soft_compander(audio, thresh=0.5, ratio=2.0)

        elif args.fx == "robot_bass_clean":
            # Slightly shallower depth and cleaner chain
            try:
                audio = librosa.effects.pitch_shift(audio, sr=sr, n_steps=-3)
            except Exception:
                pass

            # Light saturation only (no bitcrush)
            def saturate(sig: np.ndarray, drive: float = 1.6) -> np.ndarray:
                x = np.tanh(drive * sig)
                return (x / np.tanh(drive)).astype(np.float32)

            audio = 0.85 * audio + 0.15 * saturate(audio, drive=1.6)

            # Filters: clean low-end, add controlled bass, reduce muddiness
            def highpass(sig: np.ndarray, cutoff: float) -> np.ndarray:
                sos = butter(2, cutoff / (sr / 2), btype="high", output="sos")
                y = sosfilt(sos, sig)
                return np.asarray(y, dtype=np.float32)

            def rbj_lowshelf(sig: np.ndarray, f0: float, gain_db: float, S: float = 0.707) -> np.ndarray:
                A = 10 ** (gain_db / 40)
                w0 = 2 * np.pi * f0 / sr
                alpha = np.sin(w0) / (2 * S)
                cosw0 = np.cos(w0)
                b0 = A * ((A + 1) - (A - 1) * cosw0 + 2 * np.sqrt(A) * alpha)
                b1 = 2 * A * ((A - 1) - (A + 1) * cosw0)
                b2 = A * ((A + 1) - (A - 1) * cosw0 - 2 * np.sqrt(A) * alpha)
                a0 = (A + 1) + (A - 1) * cosw0 + 2 * np.sqrt(A) * alpha
                a1 = -2 * ((A - 1) + (A + 1) * cosw0)
                a2 = (A + 1) + (A - 1) * cosw0 - 2 * np.sqrt(A) * alpha
                b = np.array([b0, b1, b2], dtype=np.float64) / a0
                a = np.array([1.0, a1 / a0, a2 / a0], dtype=np.float64)
                sos = tf2sos(b, a)
                y = sosfilt(sos, sig)
                return np.asarray(y, dtype=np.float32)

            def rbj_peak(sig: np.ndarray, f0: float, gain_db: float, Q: float = 0.8) -> np.ndarray:
                A = 10 ** (gain_db / 40)
                w0 = 2 * np.pi * f0 / sr
                alpha = np.sin(w0) / (2 * Q)
                cosw0 = np.cos(w0)
                b0 = 1 + alpha * A
                b1 = -2 * cosw0
                b2 = 1 - alpha * A
                a0 = 1 + alpha / A
                a1 = -2 * cosw0
                a2 = 1 - alpha / A
                b = np.array([b0, b1, b2], dtype=np.float64) / a0
                a = np.array([1.0, a1 / a0, a2 / a0], dtype=np.float64)
                sos = tf2sos(b, a)
                y = sosfilt(sos, sig)
                return np.asarray(y, dtype=np.float32)

            audio = highpass(audio, 45.0)
            audio = rbj_lowshelf(audio, 120.0, gain_db=5.0)
            audio = rbj_peak(audio, 300.0, gain_db=-1.5, Q=0.9)

            # Gentle top shaping for cleanliness
            def lowpass(sig: np.ndarray, cutoff: float) -> np.ndarray:
                sos = butter(4, cutoff / (sr / 2), btype="low", output="sos")
                y = sosfilt(sos, sig)
                return np.asarray(y, dtype=np.float32)

            audio = lowpass(audio, 9000.0)

            # Very mild high-shelf attenuation
            def rbj_highshelf(sig: np.ndarray, f0: float, gain_db: float, S: float = 0.707) -> np.ndarray:
                A = 10 ** (gain_db / 40)
                w0 = 2 * np.pi * f0 / sr
                alpha = np.sin(w0) / (2 * S)
                cosw0 = np.cos(w0)
                b0 = A * ((A + 1) + (A - 1) * cosw0 + 2 * np.sqrt(A) * alpha)
                b1 = -2 * A * ((A - 1) + (A + 1) * cosw0)
                b2 = A * ((A + 1) + (A - 1) * cosw0 - 2 * np.sqrt(A) * alpha)
                a0 = (A + 1) - (A - 1) * cosw0 + 2 * np.sqrt(A) * alpha
                a1 = 2 * ((A - 1) - (A + 1) * cosw0)
                a2 = (A + 1) - (A - 1) * cosw0 - 2 * np.sqrt(A) * alpha
                b = np.array([b0, b1, b2], dtype=np.float64) / a0
                a = np.array([1.0, a1 / a0, a2 / a0], dtype=np.float64)
                sos = tf2sos(b, a)
                y = sosfilt(sos, sig)
                return np.asarray(y, dtype=np.float32)

            audio = rbj_highshelf(audio, 7000.0, gain_db=-1.0)

            # Mild companding
            def soft_compander(sig: np.ndarray, thresh: float = 0.65, ratio: float = 1.35) -> np.ndarray:
                x = sig.copy()
                mag = np.abs(x)
                over = mag > thresh
                x[over] = np.sign(x[over]) * (thresh + (mag[over] - thresh) / ratio)
                return x.astype(np.float32)

            audio = soft_compander(audio, thresh=0.65, ratio=1.35)

        elif args.fx == "anonymous":
            # Load external config if provided or default file exists
            cfg_path = None
            if args.fx_config and os.path.isfile(args.fx_config):
                cfg_path = args.fx_config
            else:
                default_cfg = os.path.join("fx_presets", "anonymous.json")
                if os.path.isfile(default_cfg):
                    cfg_path = default_cfg

            cfg = {}
            if cfg_path:
                try:
                    with open(cfg_path, "r", encoding="utf-8") as f:
                        cfg = json.load(f)
                except Exception:
                    cfg = {}

            def getv(key: str, default):
                return cfg.get(key, default)

            name = cfg.get("name")
            if name:
                print(f"FX preset: {name}")

            # Approximate "Anonymous" voice: deeper, band-limited, heavily compressed, slight doubling
            # 1) Deeper pitch
            try:
                audio = librosa.effects.pitch_shift(audio, sr=sr, n_steps=float(getv("pitch_steps", -5)))
            except Exception:
                pass

            # 2) Telephone band EQ: HPF ~200 Hz, LPF ~3400 Hz, slight presence boost ~1.2 kHz
            def highpass(sig: np.ndarray, cutoff: float) -> np.ndarray:
                sos = butter(2, cutoff / (sr / 2), btype="high", output="sos")
                y = sosfilt(sos, sig)
                return np.asarray(y, dtype=np.float32)

            def lowpass(sig: np.ndarray, cutoff: float) -> np.ndarray:
                sos = butter(4, cutoff / (sr / 2), btype="low", output="sos")
                y = sosfilt(sos, sig)
                return np.asarray(y, dtype=np.float32)

            def rbj_peak(sig: np.ndarray, f0: float, gain_db: float, Q: float = 1.1) -> np.ndarray:
                A = 10 ** (gain_db / 40)
                w0 = 2 * np.pi * f0 / sr
                alpha = np.sin(w0) / (2 * Q)
                cosw0 = np.cos(w0)
                b0 = 1 + alpha * A
                b1 = -2 * cosw0
                b2 = 1 - alpha * A
                a0 = 1 + alpha / A
                a1 = -2 * cosw0
                a2 = 1 - alpha / A
                b = np.array([b0, b1, b2], dtype=np.float64) / a0
                a = np.array([1.0, a1 / a0, a2 / a0], dtype=np.float64)
                sos = tf2sos(b, a)
                y = sosfilt(sos, sig)
                return np.asarray(y, dtype=np.float32)

            audio = highpass(audio, float(getv("hpf", 200.0)))
            audio = lowpass(audio, float(getv("lpf", 3400.0)))
            audio = rbj_peak(audio, float(getv("presence_f0", 1200.0)), gain_db=float(getv("presence_gain_db", 2.5)), Q=float(getv("presence_Q", 1.1)))

            # 3) Slight doubling (static short delays)
            d1 = max(1, int(sr * (float(getv("delay_ms_1", 6.0)) / 1000.0)))
            d2 = max(1, int(sr * (float(getv("delay_ms_2", 12.0)) / 1000.0)))
            delayed1 = np.concatenate([np.zeros(d1, dtype=np.float32), audio[:-d1]])
            delayed2 = np.concatenate([np.zeros(d2, dtype=np.float32), audio[:-d2]])
            w_dry = float(getv("mix_dry", 0.85))
            w_d1 = float(getv("mix_d1", 0.10))
            w_d2 = float(getv("mix_d2", 0.05))
            audio = (w_dry * audio + w_d1 * delayed1 + w_d2 * delayed2).astype(np.float32)

            # 4) Stronger compression + soft clip as limiter
            def soft_compander(sig: np.ndarray, thresh: float = 0.45, ratio: float = 2.8) -> np.ndarray:
                x = sig.copy()
                mag = np.abs(x)
                over = mag > thresh
                x[over] = np.sign(x[over]) * (thresh + (mag[over] - thresh) / ratio)
                return x.astype(np.float32)

            def soft_clip(sig: np.ndarray, drive: float = 1.8) -> np.ndarray:
                x = np.tanh(drive * sig)
                return (x / np.tanh(drive)).astype(np.float32)

            audio = soft_compander(audio, thresh=float(getv("comp_thresh", 0.45)), ratio=float(getv("comp_ratio", 2.8)))
            audio = soft_clip(audio, drive=float(getv("clip_drive", 1.8)))

        elif args.fx == "grit_clean":
            # Rough but clean: moderate depth, subtle ring-mod, controlled saturation, surgical EQ
            # 1) Moderate pitch depth
            try:
                audio = librosa.effects.pitch_shift(audio, sr=sr, n_steps=-4)
            except Exception:
                pass

            # 2) Subtle ring-mod (adds texture) + light saturation in parallel
            t = np.arange(len(audio)) / sr
            ring = np.sin(2 * np.pi * 70.0 * t).astype(np.float32)

            def saturate(sig: np.ndarray, drive: float = 2.2) -> np.ndarray:
                x = np.tanh(drive * sig)
                return (x / np.tanh(drive)).astype(np.float32)

            a_ring = audio * ring
            a_sat = saturate(audio, drive=2.2)
            audio = (0.92 * audio + 0.05 * a_ring + 0.03 * a_sat).astype(np.float32)

            # 3) Filters and EQ: clean lows, add controlled bass, cut mud, small presence
            def highpass(sig: np.ndarray, cutoff: float) -> np.ndarray:
                sos = butter(2, cutoff / (sr / 2), btype="high", output="sos")
                y = sosfilt(sos, sig)
                return np.asarray(y, dtype=np.float32)

            def lowpass(sig: np.ndarray, cutoff: float) -> np.ndarray:
                sos = butter(4, cutoff / (sr / 2), btype="low", output="sos")
                y = sosfilt(sos, sig)
                return np.asarray(y, dtype=np.float32)

            def rbj_lowshelf(sig: np.ndarray, f0: float, gain_db: float, S: float = 0.707) -> np.ndarray:
                A = 10 ** (gain_db / 40)
                w0 = 2 * np.pi * f0 / sr
                alpha = np.sin(w0) / (2 * S)
                cosw0 = np.cos(w0)
                b0 = A * ((A + 1) - (A - 1) * cosw0 + 2 * np.sqrt(A) * alpha)
                b1 = 2 * A * ((A - 1) - (A + 1) * cosw0)
                b2 = A * ((A + 1) - (A - 1) * cosw0 - 2 * np.sqrt(A) * alpha)
                a0 = (A + 1) + (A - 1) * cosw0 + 2 * np.sqrt(A) * alpha
                a1 = -2 * ((A - 1) + (A + 1) * cosw0)
                a2 = (A + 1) + (A - 1) * cosw0 - 2 * np.sqrt(A) * alpha
                b = np.array([b0, b1, b2], dtype=np.float64) / a0
                a = np.array([1.0, a1 / a0, a2 / a0], dtype=np.float64)
                sos = tf2sos(b, a)
                y = sosfilt(sos, sig)
                return np.asarray(y, dtype=np.float32)

            def rbj_peak(sig: np.ndarray, f0: float, gain_db: float, Q: float = 1.0) -> np.ndarray:
                A = 10 ** (gain_db / 40)
                w0 = 2 * np.pi * f0 / sr
                alpha = np.sin(w0) / (2 * Q)
                cosw0 = np.cos(w0)
                b0 = 1 + alpha * A
                b1 = -2 * cosw0
                b2 = 1 - alpha * A
                a0 = 1 + alpha / A
                a1 = -2 * cosw0
                a2 = 1 - alpha / A
                b = np.array([b0, b1, b2], dtype=np.float64) / a0
                a = np.array([1.0, a1 / a0, a2 / a0], dtype=np.float64)
                sos = tf2sos(b, a)
                y = sosfilt(sos, sig)
                return np.asarray(y, dtype=np.float32)

            audio = highpass(audio, 50.0)
            audio = rbj_lowshelf(audio, 110.0, gain_db=6.0)
            audio = rbj_peak(audio, 300.0, gain_db=-2.0, Q=0.9)
            audio = rbj_peak(audio, 2500.0, gain_db=1.5, Q=1.1)
            audio = lowpass(audio, 8000.0)

            # 4) Parallel bright grit: distort band 1–4 kHz and mix in lightly
            def bandpass(sig: np.ndarray, lo: float, hi: float) -> np.ndarray:
                sos = butter(2, [lo / (sr / 2), hi / (sr / 2)], btype="band", output="sos")
                y = sosfilt(sos, sig)
                return np.asarray(y, dtype=np.float32)

            bright = bandpass(audio, 1000.0, 4000.0)
            bright = saturate(bright, drive=2.4)
            audio = (0.9 * audio + 0.1 * bright).astype(np.float32)

            # 5) Gentle companding to keep transients tidy
            def soft_compander(sig: np.ndarray, thresh: float = 0.6, ratio: float = 1.6) -> np.ndarray:
                x = sig.copy()
                mag = np.abs(x)
                over = mag > thresh
                x[over] = np.sign(x[over]) * (thresh + (mag[over] - thresh) / ratio)
                return x.astype(np.float32)

            audio = soft_compander(audio, thresh=0.6, ratio=1.6)

        elif args.fx == "grit_ultraclean":
            # Even clearer variant: milder depth, minimal texture, strong articulation
            # 1) Mild pitch depth for intelligibility
            try:
                audio = librosa.effects.pitch_shift(audio, sr=sr, n_steps=-3)
            except Exception:
                pass

            # 2) Very subtle texture and saturation
            t = np.arange(len(audio)) / sr
            ring = np.sin(2 * np.pi * 65.0 * t).astype(np.float32)

            def saturate(sig: np.ndarray, drive: float = 1.8) -> np.ndarray:
                x = np.tanh(drive * sig)
                return (x / np.tanh(drive)).astype(np.float32)

            audio = (0.965 * audio + 0.015 * (audio * ring) + 0.02 * saturate(audio, drive=1.8)).astype(np.float32)

            # 3) Clean low-end, reduce mud, add presence, keep airy top but controlled
            def highpass(sig: np.ndarray, cutoff: float) -> np.ndarray:
                sos = butter(2, cutoff / (sr / 2), btype="high", output="sos")
                y = sosfilt(sos, sig)
                return np.asarray(y, dtype=np.float32)

            def lowpass(sig: np.ndarray, cutoff: float) -> np.ndarray:
                sos = butter(4, cutoff / (sr / 2), btype="low", output="sos")
                y = sosfilt(sos, sig)
                return np.asarray(y, dtype=np.float32)

            def rbj_lowshelf(sig: np.ndarray, f0: float, gain_db: float, S: float = 0.707) -> np.ndarray:
                A = 10 ** (gain_db / 40)
                w0 = 2 * np.pi * f0 / sr
                alpha = np.sin(w0) / (2 * S)
                cosw0 = np.cos(w0)
                b0 = A * ((A + 1) - (A - 1) * cosw0 + 2 * np.sqrt(A) * alpha)
                b1 = 2 * A * ((A - 1) - (A + 1) * cosw0)
                b2 = A * ((A + 1) - (A - 1) * cosw0 - 2 * np.sqrt(A) * alpha)
                a0 = (A + 1) + (A - 1) * cosw0 + 2 * np.sqrt(A) * alpha
                a1 = -2 * ((A - 1) + (A + 1) * cosw0)
                a2 = (A + 1) + (A - 1) * cosw0 - 2 * np.sqrt(A) * alpha
                b = np.array([b0, b1, b2], dtype=np.float64) / a0
                a = np.array([1.0, a1 / a0, a2 / a0], dtype=np.float64)
                sos = tf2sos(b, a)
                y = sosfilt(sos, sig)
                return np.asarray(y, dtype=np.float32)

            def rbj_peak(sig: np.ndarray, f0: float, gain_db: float, Q: float = 1.1) -> np.ndarray:
                A = 10 ** (gain_db / 40)
                w0 = 2 * np.pi * f0 / sr
                alpha = np.sin(w0) / (2 * Q)
                cosw0 = np.cos(w0)
                b0 = 1 + alpha * A
                b1 = -2 * cosw0
                b2 = 1 - alpha * A
                a0 = 1 + alpha / A
                a1 = -2 * cosw0
                a2 = 1 - alpha / A
                b = np.array([b0, b1, b2], dtype=np.float64) / a0
                a = np.array([1.0, a1 / a0, a2 / a0], dtype=np.float64)
                sos = tf2sos(b, a)
                y = sosfilt(sos, sig)
                return np.asarray(y, dtype=np.float32)

            def rbj_highshelf(sig: np.ndarray, f0: float, gain_db: float, S: float = 0.707) -> np.ndarray:
                A = 10 ** (gain_db / 40)
                w0 = 2 * np.pi * f0 / sr
                alpha = np.sin(w0) / (2 * S)
                cosw0 = np.cos(w0)
                b0 = A * ((A + 1) + (A - 1) * cosw0 + 2 * np.sqrt(A) * alpha)
                b1 = -2 * A * ((A - 1) + (A + 1) * cosw0)
                b2 = A * ((A + 1) + (A - 1) * cosw0 - 2 * np.sqrt(A) * alpha)
                a0 = (A + 1) - (A - 1) * cosw0 + 2 * np.sqrt(A) * alpha
                a1 = 2 * ((A - 1) - (A + 1) * cosw0)
                a2 = (A + 1) - (A - 1) * cosw0 - 2 * np.sqrt(A) * alpha
                b = np.array([b0, b1, b2], dtype=np.float64) / a0
                a = np.array([1.0, a1 / a0, a2 / a0], dtype=np.float64)
                sos = tf2sos(b, a)
                y = sosfilt(sos, sig)
                return np.asarray(y, dtype=np.float32)

            audio = highpass(audio, 55.0)
            audio = rbj_lowshelf(audio, 110.0, gain_db=4.0)
            audio = rbj_peak(audio, 280.0, gain_db=-2.5, Q=1.0)
            audio = rbj_peak(audio, 3000.0, gain_db=2.5, Q=1.1)
            audio = rbj_highshelf(audio, 7500.0, gain_db=0.5)
            audio = lowpass(audio, 9500.0)

            # 4) Mild static de-esser around 6.5 kHz
            audio = rbj_peak(audio, 6500.0, gain_db=-1.2, Q=1.3)

            # 5) Gentle dynamics
            def soft_compander(sig: np.ndarray, thresh: float = 0.68, ratio: float = 1.4) -> np.ndarray:
                x = sig.copy()
                mag = np.abs(x)
                over = mag > thresh
                x[over] = np.sign(x[over]) * (thresh + (mag[over] - thresh) / ratio)
                return x.astype(np.float32)

            audio = soft_compander(audio, thresh=0.68, ratio=1.4)

        # Normalize and write
        peak = float(np.max(np.abs(audio)) or 1.0)
        audio = (audio / peak) * 0.95
        sf.write(out_path, audio, sr, subtype="PCM_16")

        print("Accented text:", accented)
        print(f"Audio written to: {out_path}")
    except Exception as e:
        with open("tts_log.txt", "w", encoding="utf-8") as log:
            log.write("TTS demo failed:\n")
            log.write("".join(traceback.format_exception(e)))
        raise


if __name__ == "__main__":
    main()

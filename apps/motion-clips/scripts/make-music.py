# Composes the two original GoodStrata music beds from scratch (numpy additive
# synthesis — no samples, no licensed material) and writes them to
# public/audio/ via ffmpeg loudness-normalisation (-16 LUFS integrated).
#
#   music-clips.mp3  (~38s)  warm understated bed for the C1-C5 explainers:
#                            Dmaj pad + felt-piano pentatonic motif + sub.
#   music-ads.mp3    (~26s)  punchier bed for the AD1-AD4 verticals: Bm pulse
#                            bass, soft four-on-floor kick, offbeat hats,
#                            sparse plucks. Same D-family key as the clips bed.
#
# Deterministic (fixed seed). Rerun:  python3 scripts/make-music.py
import subprocess
import wave
from pathlib import Path

import numpy as np

SR = 44100
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "audio"
rng = np.random.default_rng(20260711)


def hz(midi: float) -> float:
    return 440.0 * 2.0 ** ((midi - 69) / 12)


def fft_shape(x: np.ndarray, shape) -> np.ndarray:
    """Apply a magnitude-only frequency shaping function to a mono signal."""
    n = len(x)
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    spec *= shape(f)
    return np.fft.irfft(spec, n)


def lowpass(x, fc):
    return fft_shape(x, lambda f: 1.0 / (1.0 + (f / fc) ** 2))


def highpass(x, fc):
    return fft_shape(x, lambda f: (f / fc) ** 2 / (1.0 + (f / fc) ** 2))


def smoothstep(n):
    t = np.linspace(0, 1, max(n, 2))
    return t * t * (3 - 2 * t)


def env_asr(n, attack_s, release_s):
    """Attack-sustain-release envelope over n samples."""
    e = np.ones(n)
    a = min(int(attack_s * SR), n)
    r = min(int(release_s * SR), n)
    if a > 0:
        e[:a] = smoothstep(a)
    if r > 0:
        e[-r:] *= smoothstep(r)[::-1]
    return e


def place(buf: np.ndarray, x: np.ndarray, t: float, pan: float = 0.0, gain: float = 1.0):
    """Mix mono x into stereo buf at time t with constant-power pan (-1..1)."""
    i = int(t * SR)
    if i >= buf.shape[1] or i < 0:
        return
    seg = x[: buf.shape[1] - i]
    th = (pan + 1) * np.pi / 4
    buf[0, i : i + len(seg)] += seg * gain * np.cos(th)
    buf[1, i : i + len(seg)] += seg * gain * np.sin(th)


# ---------------------------------------------------------------- instruments


def pad_note(midi, dur, brightness=1800.0, lfo_rate=0.13):
    """One warm pad voice: rolled-off harmonic stack, two detuned copies."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    f0 = hz(midi)
    out = np.zeros(n)
    for detune in (-3.5, 3.5):
        f = f0 * 2 ** (detune / 1200)
        x = np.zeros(n)
        for k in range(1, 7):
            amp = k**-1.4 / (1.0 + (k * f / brightness) ** 2)
            x += amp * np.sin(2 * np.pi * f * k * t + rng.uniform(0, 2 * np.pi))
        out += x
    lfo = 1.0 + 0.1 * np.sin(2 * np.pi * lfo_rate * t + rng.uniform(0, 2 * np.pi))
    return out * lfo * env_asr(n, 1.6, 2.2)


def felt_note(midi, dur=5.0, vel=0.7, bright=1.0, attack_s=0.012):
    """Felt-piano-ish struck tone: inharmonic partials, soft thump, dark top."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    f0 = hz(midi)
    partials = [(1, 1.0), (2, 0.5 * bright), (3, 0.26 * bright), (4, 0.1 * bright), (5, 0.05 * bright)]
    x = np.zeros(n)
    for k, amp in partials:
        fk = f0 * k * np.sqrt(1 + 2e-4 * k * k)
        tau = (1.5 / k**1.1) * (0.6 + 0.7 * vel)
        x += amp * np.sin(2 * np.pi * fk * t + rng.uniform(0, 2 * np.pi)) * np.exp(-t / tau)
    a = int(attack_s * SR)
    x[:a] *= smoothstep(a)
    thump_n = int(0.025 * SR)
    thump = lowpass(rng.standard_normal(thump_n), 320) * np.exp(-np.arange(thump_n) / (0.008 * SR))
    x[:thump_n] += 0.5 * thump
    return x * vel


def sub_note(midi, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f0 = hz(midi)
    x = np.sin(2 * np.pi * f0 * t) + 0.12 * np.sin(2 * np.pi * 2 * f0 * t)
    return x * env_asr(n, 0.8, 1.5)


def bass_note(midi, dur=0.24, vel=0.8):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f0 = hz(midi)
    x = np.zeros(n)
    for k, amp in [(1, 1.0), (2, 0.35), (3, 0.45), (4, 0.15), (5, 0.18)]:
        amp /= 1.0 + (k * f0 / 900) ** 2
        x += amp * np.sin(2 * np.pi * f0 * k * t)
    x = np.tanh(1.6 * x)
    e = np.ones(n)
    a = int(0.005 * SR)
    e[:a] = smoothstep(a)
    d = int(0.08 * SR)
    e[a : a + d] = 1.0 - 0.4 * smoothstep(d)[: max(0, min(d, n - a))]
    e[a + d :] = 0.6
    r = int(0.04 * SR)
    e[-r:] *= smoothstep(r)[::-1]
    return x * e * vel


def kick(vel=0.8):
    n = int(0.4 * SR)
    t = np.arange(n) / SR
    f = 45 + 95 * np.exp(-t / 0.035)
    phase = 2 * np.pi * np.cumsum(f) / SR
    x = np.sin(phase) * np.exp(-t / 0.16)
    click_n = int(0.005 * SR)
    x[:click_n] += 0.04 * highpass(rng.standard_normal(click_n), 2500)
    return np.tanh(1.4 * x) * vel


def hat(vel=0.4):
    n = int(0.03 * SR)
    x = highpass(rng.standard_normal(n), 6500)
    return x * np.exp(-np.arange(n) / (0.012 * SR)) * vel


def make_ir(seconds, tau, lp_hz, seed):
    r = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = np.stack([r.standard_normal(n), r.standard_normal(n)]) * np.exp(-t / tau)
    ir = np.stack([lowpass(ch, lp_hz) for ch in ir])
    fade = int(0.004 * SR)
    ir[:, :fade] *= smoothstep(fade)
    # Energy-normalise per channel so convolution preserves loudness instead
    # of multiplying it by the IR's length.
    return ir / np.sqrt(np.sum(ir**2, axis=1, keepdims=True))


def reverb(buf, ir, wet):
    n = buf.shape[1] + ir.shape[1] - 1
    size = 1 << (n - 1).bit_length()
    out = np.zeros_like(buf)
    for ch in range(2):
        w = np.fft.irfft(np.fft.rfft(buf[ch], size) * np.fft.rfft(ir[ch], size), size)[: buf.shape[1]]
        out[ch] = w
    return buf + wet * out


def master(buses_with_wet, ir, total_n):
    mix = np.zeros((2, total_n))
    for buf, wet in buses_with_wet:
        mix += reverb(buf, ir, wet)
    mix = np.tanh(1.15 * mix)
    mix *= 0.85 / max(np.max(np.abs(mix)), 1e-9)
    return mix


def write_track(mix, name, target_lufs=-16.0):
    wav = OUT / f"{name}.wav"
    pcm = (np.clip(mix.T, -1, 1) * 32767).astype("<i2")
    with wave.open(str(wav), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    # Measure integrated loudness, apply linear gain to target, encode mp3.
    probe = subprocess.run(
        ["ffmpeg", "-hide_banner", "-i", str(wav), "-af", "loudnorm=print_format=summary", "-f", "null", "-"],
        capture_output=True,
        text=True,
    ).stderr
    measured = next(
        float(line.split()[-2]) for line in probe.splitlines() if "Input Integrated" in line
    )
    gain_db = target_lufs - measured
    mp3 = OUT / f"{name}.mp3"
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-y", "-i", str(wav), "-af", f"volume={gain_db:.2f}dB",
         "-codec:a", "libmp3lame", "-q:a", "2", str(mp3)],
        check=True,
        capture_output=True,
    )
    wav.unlink()
    print(f"[music] {mp3.name}: measured {measured} LUFS, applied {gain_db:+.1f} dB -> {target_lufs} LUFS")


# ------------------------------------------------------------------ bed A: clips


def build_clips_bed():
    bpm = 72
    beat = 60 / bpm
    total = 38.5
    n = int(total * SR)
    pads = np.zeros((2, n))
    keys = np.zeros((2, n))
    subs = np.zeros((2, n))

    # (start_beat, end_beat, chord voicing, root) — I vi IV V, resolve on I.
    chords = [
        (0, 8, [50, 57, 64, 66, 69], 38),   # Dmaj9
        (8, 16, [47, 54, 57, 62, 66], 35),  # Bm7
        (16, 24, [43, 55, 59, 62, 66], 31), # Gmaj7
        (24, 32, [45, 52, 57, 61, 64], 33), # A(add9)
        (32, 44, [38, 50, 57, 62, 66, 69], 38),  # D, rings out
    ]
    for start, end, voicing, root in chords:
        dur = (end - start) * beat + 2.2  # release overlaps the next chord
        for i, m in enumerate(voicing):
            pan = (i / (len(voicing) - 1) - 0.5) * 0.7
            place(pads, pad_note(m, dur), start * beat, pan=pan, gain=0.16 / len(voicing) * 5)
        place(subs, sub_note(root, dur), start * beat, gain=0.35)

    # Felt-piano motif on the D major pentatonic; humanised.
    phrase = [
        (0.0, 74, 0.80), (1.5, 69, 0.60), (2.5, 71, 0.65), (4.0, 78, 0.75), (6.0, 76, 0.55),
        (8.0, 78, 0.70), (9.5, 74, 0.60), (10.5, 71, 0.60), (12.0, 69, 0.70), (14.0, 66, 0.50),
        (16.0, 71, 0.70), (17.5, 74, 0.60), (18.5, 76, 0.60), (20.0, 78, 0.75), (22.0, 81, 0.50),
        (24.0, 76, 0.70), (25.5, 73, 0.60), (26.5, 71, 0.60), (28.0, 69, 0.70), (30.0, 64, 0.45),
        (32.0, 78, 0.75), (33.5, 76, 0.60), (35.0, 71, 0.55), (36.5, 74, 0.85), (40.0, 69, 0.40),
    ]
    for b, midi, vel in phrase:
        t = b * beat + rng.normal(0, 0.012)
        place(keys, felt_note(midi, vel=vel), max(t, 0), pan=rng.uniform(-0.25, 0.25), gain=0.5)

    ir = make_ir(2.4, 0.55, 3800, seed=7)
    mix = master([(keys, 0.45), (pads, 0.22), (subs, 0.05)], ir, n)
    write_track(mix, "music-clips")


# ------------------------------------------------------------------- bed B: ads


def build_ads_bed():
    bpm = 100
    beat = 60 / bpm
    total = 26.5
    n = int(total * SR)
    pads = np.zeros((2, n))
    bass = np.zeros((2, n))
    drums = np.zeros((2, n))
    keys = np.zeros((2, n))

    chords = [
        (0, 8, [47, 54, 59, 62], 35),   # Bm
        (8, 16, [43, 50, 55, 59], 31),  # G
        (16, 24, [50, 57, 62, 66], 38), # D
        (24, 32, [45, 52, 57, 64], 33), # A
        (32, 40, [47, 54, 59, 62, 66], 35),  # Bm out
    ]
    for start, end, voicing, root in chords:
        dur = (end - start) * beat + 1.2
        for i, m in enumerate(voicing):
            pan = (i / (len(voicing) - 1) - 0.5) * 0.6
            place(pads, pad_note(m, dur, brightness=1400), start * beat, pan=pan, gain=0.14 / len(voicing) * 4)
        # Driving straight-eighth bass pulse on the chord root.
        vel_pattern = [1.0, 0.5, 0.7, 0.5, 0.85, 0.5, 0.7, 0.6]
        for b8 in range(int((end - start) * 2)):
            t = (start + b8 / 2) * beat
            place(bass, bass_note(root, vel=0.75 * vel_pattern[b8 % 8]), t, gain=0.6)

    last_beat = 40
    for b in range(last_beat):
        place(drums, kick(vel=0.95 if b % 4 == 0 else 0.75), b * beat, gain=0.5)
        if b >= 8:  # hats enter at bar 3
            place(drums, hat(vel=0.5 if b % 2 == 0 else 0.35), (b + 0.5) * beat, pan=0.3, gain=0.4)
    # Closing downbeat: kick + long low B.
    place(drums, kick(vel=1.0), last_beat * beat, gain=0.55)
    tail_n = int(1.4 * SR)
    t = np.arange(tail_n) / SR
    close = np.sin(2 * np.pi * hz(35) * t) * np.exp(-t / 0.5)
    place(bass, close, last_beat * beat, gain=0.5)

    # Sparse plucks (B minor pentatonic) from bar 5.
    plucks = [
        (16.5, 78, 0.60), (17.5, 76, 0.50), (19.0, 74, 0.60),
        (24.5, 71, 0.55), (26.0, 74, 0.60), (27.0, 76, 0.50),
        (32.0, 78, 0.70), (33.5, 74, 0.60), (35.0, 71, 0.55), (36.5, 74, 0.50),
    ]
    for b, midi, vel in plucks:
        t0 = b * beat + rng.normal(0, 0.008)
        place(keys, felt_note(midi, dur=2.5, vel=vel, bright=1.5, attack_s=0.004), t0,
              pan=rng.uniform(-0.3, 0.3), gain=0.45)

    # Gentle noise riser into the final section (beats 28-32).
    rise_n = int(4 * beat * SR)
    riser = fft_shape(rng.standard_normal(rise_n), lambda f: np.exp(-((np.log(np.maximum(f, 1) / 900)) ** 2)))
    riser *= (np.linspace(0, 1, rise_n) ** 2)
    place(drums, riser, 28 * beat, gain=0.05)

    # Sidechain-style duck of pad+bass on each kick.
    duck = np.ones(n)
    for b in range(last_beat + 1):
        i = int(b * beat * SR)
        seg = min(int(0.3 * SR), n - i)
        duck[i : i + seg] -= 0.4 * np.exp(-np.arange(seg) / (0.11 * SR))
    pads *= duck
    bass *= duck

    ir = make_ir(1.4, 0.3, 4500, seed=11)
    mix = master([(keys, 0.35), (pads, 0.18), (bass, 0.08), (drums, 0.12)], ir, n)
    write_track(mix, "music-ads")


build_clips_bed()
build_ads_bed()

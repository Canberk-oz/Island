#!/usr/bin/env python3
"""Synthesises every sound effect of Grove into assets/sounds/*.wav.

All sounds are generated from scratch (sine partials, filtered noise), so
there is nothing to license. Run:  python3 scripts/make-sounds.py
"""
import os
import wave

import numpy as np

SR = 44100
OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "sounds")
rng = np.random.default_rng(7)

NOTE = {
    "D4": 293.66, "F4": 349.23, "G4": 392.00, "A4": 440.00, "C5": 523.25, "D5": 587.33,
    "E5": 659.25, "G5": 783.99, "A5": 880.00, "B5": 987.77, "C6": 1046.50, "D6": 1174.66,
    "E6": 1318.51, "G6": 1567.98, "C7": 2093.00,
}


def silence(seconds):
    return np.zeros(int(SR * seconds))


def pluck(freq, seconds=0.9, decay=7.0, bright=0.35, detune=0.0):
    """A soft marimba-like note: a few partials with quick attack and exponential decay."""
    t = np.arange(int(SR * seconds)) / SR
    env = np.exp(-decay * t) * np.minimum(1.0, t / 0.004)
    out = np.sin(2 * np.pi * freq * t)
    out += bright * np.exp(-decay * 2.2 * t) * np.sin(2 * np.pi * freq * 2.0 * t)
    out += bright * 0.5 * np.exp(-decay * 4.0 * t) * np.sin(2 * np.pi * freq * 4.0 * t)
    if detune:
        out += 0.6 * np.sin(2 * np.pi * freq * (1 + detune) * t)
    return out * env


def noise_burst(seconds, decay, lowpass=0.2):
    n = int(SR * seconds)
    x = rng.standard_normal(n)
    # one-pole low-pass
    y = np.zeros(n)
    acc = 0.0
    for i in range(n):
        acc += lowpass * (x[i] - acc)
        y[i] = acc
    t = np.arange(n) / SR
    return y * np.exp(-decay * t)


def thunk(freq=170.0, seconds=0.22, drop=0.5):
    t = np.arange(int(SR * seconds)) / SR
    f = freq * (1 - drop * np.minimum(1.0, t / seconds))
    phase = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(phase) * np.exp(-22 * t) * np.minimum(1.0, t / 0.002)


def mix(*layers):
    """layers: (offset_seconds, signal, gain)"""
    length = max(int(SR * off) + len(sig) for off, sig, _ in layers)
    out = np.zeros(length)
    for off, sig, gain in layers:
        i = int(SR * off)
        out[i:i + len(sig)] += sig * gain
    return out


def shimmer(seconds, base=2093.0):
    t = np.arange(int(SR * seconds)) / SR
    out = np.zeros_like(t)
    for k in range(14):
        f = base * (1 + 0.5 * rng.random()) * (1 + (k % 3) * 0.5)
        start = rng.random() * seconds * 0.7
        env = np.where(t > start, np.exp(-9 * (t - start)), 0.0)
        out += np.sin(2 * np.pi * f * t) * env * 0.12
    return out


def write(name, signal, peak=0.7):
    signal = np.asarray(signal, dtype=np.float64)
    # short fade out so nothing clicks at the end
    fade = min(len(signal), int(SR * 0.03))
    signal[-fade:] *= np.linspace(1, 0, fade)
    m = np.max(np.abs(signal)) or 1.0
    pcm = np.int16(signal / m * peak * 32767)
    path = os.path.join(OUT, name + ".wav")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f"{name}.wav  {len(pcm) / SR:.2f}s")


def chord(notes, seconds=1.4, decay=3.5, spread=0.0):
    return mix(*[(i * spread, pluck(NOTE[n], seconds, decay), 1.0) for i, n in enumerate(notes)])


def main():
    os.makedirs(OUT, exist_ok=True)

    write("tap", pluck(NOTE["A5"], 0.09, 55, 0.2), 0.35)
    write("tick", mix((0, pluck(NOTE["E6"], 0.05, 110, 0.1), 1.0), (0, noise_burst(0.02, 300, 0.5), 0.3)), 0.25)

    write("start", mix(
        (0.00, pluck(NOTE["G4"], 0.7, 6), 0.9),
        (0.11, pluck(NOTE["D5"], 0.9, 5), 1.0),
        (0.22, pluck(NOTE["G5"], 1.1, 4.5), 0.8),
        (0.00, noise_burst(0.5, 7, 0.04), 0.5),
    ), 0.6)

    for i, n in enumerate(["C5", "E5", "G5", "C6"]):
        write(f"leaf{i + 1}", mix(
            (0, pluck(NOTE[n], 0.8, 7), 1.0),
            (0.0, noise_burst(0.05, 80, 0.3), 0.15),
        ), 0.5)

    write("complete", mix(
        (0.00, pluck(NOTE["C5"], 1.6, 3.2), 1.0),
        (0.09, pluck(NOTE["E5"], 1.6, 3.2), 0.9),
        (0.18, pluck(NOTE["G5"], 1.6, 3.2), 0.9),
        (0.29, pluck(NOTE["C6"], 1.8, 2.6), 1.0),
        (0.29, shimmer(1.4), 0.6),
    ), 0.7)

    write("drop", mix((0, thunk(190, 0.2), 1.0), (0, noise_burst(0.03, 160, 0.4), 0.35)), 0.6)
    write("crack", mix(
        (0, noise_burst(0.07, 60, 0.6), 1.0),
        (0, thunk(320, 0.09, 0.3), 0.7),
        (0.01, pluck(NOTE["C7"], 0.08, 60, 0.1), 0.2),
    ), 0.55)

    write("reveal_common", mix(
        (0, thunk(240, 0.14), 0.7),
        (0.02, chord(["C5", "E5", "G5"], 1.0, 4.5, 0.05), 0.8),
    ), 0.6)
    write("reveal_rare", mix(
        (0, thunk(240, 0.14), 0.7),
        (0.02, chord(["D5", "G5", "B5", "D6"], 1.3, 3.6, 0.06), 0.8),
        (0.2, shimmer(0.9), 0.5),
    ), 0.68)
    write("reveal_epic", mix(
        (0, thunk(200, 0.18), 0.8),
        (0.02, chord(["E5", "A5", "C6", "E6"], 1.6, 3.0, 0.07), 0.8),
        (0.30, pluck(NOTE["A5"] * 2, 1.4, 3.0), 0.5),
        (0.2, shimmer(1.4), 0.7),
    ), 0.72)
    write("reveal_legendary", mix(
        (0, thunk(150, 0.3, 0.6), 1.0),
        (0.00, noise_burst(0.6, 6, 0.05), 0.5),
        (0.04, chord(["C5", "G5", "C6", "E6", "G6"], 2.4, 2.0, 0.09), 0.8),
        (0.55, chord(["E6", "G6", "C7"], 2.0, 2.2, 0.08), 0.55),
        (0.2, shimmer(2.2), 0.9),
        (0.9, shimmer(1.6, 2637.0), 0.6),
    ), 0.78)

    write("wither", mix(
        (0.00, pluck(NOTE["A4"], 1.2, 3.0, 0.2, 0.012), 0.9),
        (0.32, pluck(NOTE["F4"], 1.3, 2.8, 0.2, 0.014), 0.9),
        (0.70, pluck(NOTE["D4"], 1.8, 2.2, 0.2, 0.018), 1.0),
        (0.00, noise_burst(1.6, 2.5, 0.02), 0.35),
    ), 0.55)

    write("plant", mix(
        (0, thunk(150, 0.2, 0.4), 1.0),
        (0.07, pluck(NOTE["G5"], 0.5, 9), 0.5),
        (0.13, pluck(NOTE["C6"], 0.6, 8), 0.5),
    ), 0.6)

    write("coin", mix(
        (0.00, pluck(NOTE["B5"], 0.25, 16, 0.5), 0.8),
        (0.07, pluck(NOTE["E6"], 0.5, 9, 0.5), 1.0),
    ), 0.45)

    write("warn", mix(
        (0.00, pluck(NOTE["D5"], 0.3, 12, 0.3, 0.02), 1.0),
        (0.16, pluck(NOTE["A4"], 0.5, 8, 0.3, 0.02), 1.0),
    ), 0.5)

    write("grow", mix(
        (0.00, noise_burst(0.9, 4, 0.03), 0.7),
        (0.05, chord(["G4", "D5", "G5", "B5", "D6"], 1.8, 2.6, 0.08), 0.8),
        (0.4, shimmer(1.4), 0.6),
    ), 0.7)


if __name__ == "__main__":
    main()

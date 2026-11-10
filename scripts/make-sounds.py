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


def write(name, signal, peak=0.7, fade_out=True):
    signal = np.asarray(signal, dtype=np.float64)
    # short fade out so nothing clicks at the end (loops must not fade: they wrap around)
    if fade_out:
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


# ---------------------------------------------------------------------------
# Wildlife calls and ambience
#
# Everything here is shaped for phone speakers, which reproduce very little
# below ~300 Hz: every sound keeps most of its energy between 300 Hz and 6 kHz,
# and nothing is gated abruptly (abrupt gates are heard as clicks).
# ---------------------------------------------------------------------------

def white(seconds):
    return rng.standard_normal(int(SR * seconds))


def band(x, lo, hi):
    """Zero-phase band-pass with soft (one octave) edges, done in the frequency domain."""
    X = np.fft.rfft(x)
    f = np.maximum(np.fft.rfftfreq(len(x), 1 / SR), 1e-3)
    gain = 1 / (1 + (lo / f) ** 4) / (1 + (f / hi) ** 4)
    return np.fft.irfft(X * gain, len(x))


def norm(x):
    m = np.max(np.abs(x))
    return x / m if m else x


def ramp(n_samples, attack=0.008, release=0.03):
    """Envelope with smooth raised-cosine edges."""
    env = np.ones(n_samples)
    a, r = min(n_samples // 2, int(SR * attack)), min(n_samples // 2, int(SR * release))
    if a:
        env[:a] = 0.5 - 0.5 * np.cos(np.pi * np.arange(a) / a)
    if r:
        env[-r:] = 0.5 + 0.5 * np.cos(np.pi * np.arange(r) / r)
    return env


def pulses(t, rate, duty=0.5, phase=0.0):
    """Smooth 0..1 pulse train (no hard edges)."""
    s = np.sin(2 * np.pi * rate * t + phase)
    thr = np.cos(np.pi * duty)
    return np.clip((s - thr) / (1 - thr + 1e-9), 0, 1) ** 1.5


def saw(freq_curve):
    """Band-limited sawtooth for a per-sample frequency curve (additive, no aliasing)."""
    phase = 2 * np.pi * np.cumsum(freq_curve) / SR
    out = np.zeros(len(freq_curve))
    k = 1
    top = np.max(freq_curve)
    while k * top < min(9000, SR / 2 - 500):
        out += np.sin(k * phase) / k
        k += 1
    return out


def sweep(f0, f1, seconds, decay=0.0, shape=1.0):
    """A sine whose pitch glides from f0 to f1."""
    t = np.arange(int(SR * seconds)) / SR
    k = (t / seconds) ** shape
    f = f0 + (f1 - f0) * k
    phase = 2 * np.pi * np.cumsum(f) / SR
    env = np.sin(np.pi * np.minimum(1.0, t / seconds)) * np.exp(-decay * t)
    return np.sin(phase) * env


def knock(f=520.0, seconds=0.16):
    """A small wooden knock: the part of a thud a phone speaker can actually play."""
    t = np.arange(int(SR * seconds)) / SR
    body = np.sin(2 * np.pi * f * t) * np.exp(-38 * t) + 0.5 * np.sin(2 * np.pi * f * 1.9 * t) * np.exp(-60 * t)
    click = band(white(seconds), 900, 4000) * np.exp(-180 * t) * 0.5
    return (body + click) * np.minimum(1.0, t / 0.0015)


def bird_phrase(base=3000.0, notes=4, style=0):
    parts = []
    at = 0.0
    for i in range(notes):
        f0 = base * (1 + 0.2 * rng.random())
        if style == 0:      # rising and falling chirps
            sig = sweep(f0, f0 * (1.3 if i % 2 else 0.78), 0.07 + 0.04 * rng.random())
        elif style == 1:    # two-tone whistle "tee-oo"
            sig = np.concatenate([sweep(f0 * 1.2, f0 * 1.25, 0.11), sweep(f0 * 0.95, f0 * 0.85, 0.16)])
        else:               # fast trill
            sig = sweep(f0, f0 * 1.12, 0.035)
        parts.append((at, sig, 1.0 - 0.08 * i))
        at += (0.05 if style == 2 else 0.13) + 0.05 * rng.random()
    return mix(*parts)


def quack_one(f_start=470.0, f_end=330.0, seconds=0.19):
    n = int(SR * seconds)
    t = np.arange(n) / SR
    src = saw(f_start + (f_end - f_start) * (t / seconds) ** 0.6)
    # A duck's nasal colour: two formants, plus a rattle in the amplitude.
    voiced = band(src, 850, 1500) * 1.0 + band(src, 2000, 3000) * 0.55 + src * 0.05
    rattle = 0.75 + 0.25 * np.sin(2 * np.pi * 62 * t)
    return norm(voiced * rattle * ramp(n, 0.012, 0.06))


def quack():
    return mix((0, quack_one(), 1.0), (0.26, quack_one(430, 300, 0.17), 0.85))


def ribbit():
    def croak(seconds, f0, f1, rate):
        n = int(SR * seconds)
        t = np.arange(n) / SR
        f = f0 + (f1 - f0) * t / seconds
        ph = 2 * np.pi * np.cumsum(f) / SR
        tone = np.sin(ph) + 0.6 * np.sin(1.5 * ph) + 0.45 * np.sin(2 * ph)
        return tone * pulses(t, rate, 0.55) * ramp(n, 0.01, 0.03)
    return norm(mix((0, croak(0.2, 760, 980, 48), 1.0), (0.24, croak(0.11, 1050, 1150, 60), 0.9)))


def splash():
    n = int(SR * 0.5)
    t = np.arange(n) / SR
    wash = band(white(0.5), 500, 5000) * np.exp(-9 * t) * np.minimum(1.0, t / 0.004)
    drops = [(0.03 + 0.05 * i, sweep(700 + 260 * i, 1500 + 380 * i, 0.045, decay=18), 0.35) for i in range(4)]
    return norm(mix((0, wash, 1.0), *drops))


def squeak():
    return mix((0, sweep(1800, 2600, 0.07), 1.0), (0.1, sweep(2000, 2900, 0.06), 0.8))


def sniff():
    def one():
        n = int(SR * 0.07)
        return band(white(0.07), 700, 3500) * ramp(n, 0.012, 0.03)
    return norm(mix(*[(i * 0.11, one(), 1.0 - 0.15 * i) for i in range(3)]))


def yip():
    return mix((0, sweep(700, 1400, 0.09, shape=0.5), 1.0), (0.16, sweep(800, 1500, 0.08, shape=0.5), 0.8))


def snort():
    n = int(SR * 0.26)
    t = np.arange(n) / SR
    breath = band(white(0.26), 350, 1800) * (0.6 + 0.4 * np.sin(2 * np.pi * 38 * t))
    return norm(breath * ramp(n, 0.015, 0.12))


def buzz(seconds=0.9):
    n = int(SR * seconds)
    t = np.arange(n) / SR
    f = 235 + 14 * np.sin(2 * np.pi * 5 * t) + 20 * np.sin(2 * np.pi * 0.9 * t)
    wings = band(saw(f), 350, 2600)
    env = np.sin(np.pi * t / seconds) ** 0.7 * (0.75 + 0.25 * np.sin(2 * np.pi * 23 * t))
    return norm(wings * env)


def hoot():
    def one(f, seconds=0.34):
        n = int(SR * seconds)
        t = np.arange(n) / SR
        vib = 1 + 0.006 * np.sin(2 * np.pi * 5.5 * t)
        ph = 2 * np.pi * np.cumsum(f * vib) / SR
        tone = np.sin(ph) + 0.22 * np.sin(2 * ph) + 0.08 * np.sin(3 * ph)
        air = band(white(seconds), 500, 1600) * 0.05
        return (tone + air) * np.sin(np.pi * t / seconds) ** 2
    return norm(mix((0, one(440), 1.0), (0.44, one(415, 0.2), 0.8), (0.66, one(392, 0.4), 0.95)))


def twinkle():
    return mix(*[(i * 0.08, pluck(f, 0.4, 12, 0.2), 0.7) for i, f in enumerate([NOTE["E6"], NOTE["G6"], NOTE["C7"]])])


def flutter():
    def beat():
        n = int(SR * 0.045)
        return band(white(0.045), 450, 2600) * ramp(n, 0.01, 0.025)
    return norm(mix(*[(i * 0.055, beat(), 1.0 - 0.1 * i) for i in range(6)]))


def loop(signal, crossfade=1.0):
    """Make a seamless loop by crossfading the tail into the head."""
    n = int(SR * crossfade)
    head, body, tail = signal[:n], signal[n:-n], signal[-n:]
    k = np.linspace(0, 1, n)
    # equal-power crossfade keeps the loudness steady through the seam
    return np.concatenate([tail * np.cos(k * np.pi / 2) + head * np.sin(k * np.pi / 2), body])


def wind(seconds, lo=280, hi=950):
    n = int(SR * seconds)
    t = np.arange(n) / SR
    gusts = 0.55 + 0.25 * np.sin(2 * np.pi * t / 6.3 + 1.0) + 0.2 * np.sin(2 * np.pi * t / 3.7)
    return norm(band(white(seconds), lo, hi)) * gusts


def ambience(kind, seconds=14.0):
    total = seconds + 1.0
    n = int(SR * total)
    t = np.arange(n) / SR
    if kind == "day":
        layers = [(0, wind(total), 0.16)]
        at = 0.3
        i = 0
        while at < seconds - 1.2:
            near = rng.random()
            layers.append((at, bird_phrase(2400 + 1700 * rng.random(), 3 + i % 3, i % 3), 0.10 + 0.22 * near))
            at += 0.9 + 1.5 * rng.random()
            i += 1
        # a little leaf rustle now and then
        for _ in range(5):
            m = int(SR * 0.5)
            layers.append((rng.random() * (seconds - 1), band(white(0.5), 1800, 5000) * ramp(m, 0.2, 0.25), 0.03))
        sig = mix(*layers)
    elif kind == "night":
        crickets = np.zeros(n)
        for c, (f, group, level) in enumerate([(4300, 2.1, 1.0), (4650, 1.7, 0.6), (3950, 2.6, 0.4)]):
            groups = pulses(t, group, 0.42, c * 1.3)       # a chirp, a pause, a chirp...
            trill = pulses(t, 27 + c * 3, 0.6, c)           # ...and each chirp is a fast trill
            crickets += np.sin(2 * np.pi * f * t) * groups * trill * level
        sig = mix((0, norm(crickets), 0.2), (0, wind(total, 250, 700), 0.09), (5.2, hoot(), 0.06))
    else:  # water
        m = np.abs(band(white(total), 4, 14))
        brook = norm(band(white(total), 500, 3200)) * (0.5 + 0.5 * norm(m))
        layers = [(0, brook, 0.2)]
        for _ in range(70):
            f = 650 + 1500 * rng.random()
            layers.append((rng.random() * seconds, sweep(f, f * (1.3 + 0.5 * rng.random()), 0.03 + 0.04 * rng.random(), decay=14), 0.05 + 0.08 * rng.random()))
        sig = mix(*layers)
    return loop(sig[:n])


def main_wildlife():
    # Small thuds, rebuilt so that a phone speaker can play them.
    write("drop", mix((0, thunk(190, 0.2), 0.6), (0, knock(540), 1.0)), 0.6)
    write("plant", mix(
        (0, thunk(150, 0.2, 0.4), 0.6),
        (0, knock(430), 0.9),
        (0.07, pluck(NOTE["G5"], 0.5, 9), 0.5),
        (0.13, pluck(NOTE["C6"], 0.6, 8), 0.5),
    ), 0.6)
    write("place_stone", mix((0, thunk(130, 0.25, 0.5), 0.6), (0, knock(380, 0.2), 1.0), (0.03, knock(760, 0.1), 0.35)), 0.6)
    write("place_water", mix((0, splash(), 1.0), (0.05, pluck(NOTE["C6"], 0.5, 8), 0.2)), 0.55)

    write("animal_chirp", bird_phrase(3200, 4, 0), 0.5)
    write("animal_quack", quack(), 0.55)
    write("animal_ribbit", ribbit(), 0.5)
    write("animal_splash", splash(), 0.5)
    write("animal_squeak", squeak(), 0.4)
    write("animal_sniff", sniff(), 0.4)
    write("animal_yip", yip(), 0.45)
    write("animal_snort", snort(), 0.5)
    write("animal_buzz", buzz(), 0.4)
    write("animal_hoot", hoot(), 0.5)
    write("animal_twinkle", twinkle(), 0.35)
    write("animal_flutter", flutter(), 0.4)

    write("arrive", mix(
        (0.00, pluck(NOTE["G5"], 0.8, 6), 0.9),
        (0.10, pluck(NOTE["C6"], 0.9, 5), 0.9),
        (0.20, pluck(NOTE["E6"], 1.0, 4.5), 0.9),
        (0.30, pluck(NOTE["G6"], 1.2, 4), 0.8),
        (0.2, shimmer(1.0), 0.5),
    ), 0.6)
    write("levelup", mix(
        (0.00, chord(["C5", "E5", "G5"], 1.2, 3.5, 0.06), 0.9),
        (0.35, chord(["D5", "G5", "B5"], 1.2, 3.5, 0.06), 0.9),
        (0.70, chord(["E5", "G5", "C6", "E6"], 2.0, 2.2, 0.07), 1.0),
        (0.70, shimmer(1.6), 0.8),
    ), 0.72)

    global SR
    full = SR
    SR = 22050
    for kind in ("day", "night", "water"):
        write(f"amb_{kind}", ambience(kind), 0.5, fade_out=False)
    SR = full


if __name__ == "__main__":
    main()
    main_wildlife()

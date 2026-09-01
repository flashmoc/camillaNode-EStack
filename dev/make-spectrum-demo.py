#!/usr/bin/env python3
"""Generate a standalone CamillaDSP spectrum config for E-Stack cloud development.

The production Raspberry spectrum config is deliberately not read or modified.
The demo uses a white-noise SignalGenerator, creates 30 frequency bands for
left/right (60 playback channels), and writes the result to /dev/null.
"""

from pathlib import Path
import sys

OUTPUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("spectrum-demo.generated.yml")

FREQUENCIES = [
    25, 30, 40, 50, 63, 80, 100, 125, 160, 200,
    250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000,
    2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
]

lines = [
    "devices:",
    "  samplerate: 48000",
    "  chunksize: 1024",
    "  enable_rate_adjust: false",
    "  capture:",
    "    type: SignalGenerator",
    "    channels: 2",
    "    signal:",
    "      type: WhiteNoise",
    "      level: -30.0",
    "  playback:",
    "    type: File",
    "    filename: /dev/null",
    "    channels: 60",
    "    format: S32_LE",
    "",
    "filters:",
]

for index, frequency in enumerate(FREQUENCIES):
    lines.extend([
        f"  band_{index}:",
        "    type: Biquad",
        "    parameters:",
        "      type: Bandpass",
        f"      freq: {frequency}",
        "      q: 12.0",
    ])

lines.extend([
    "",
    "mixers:",
    "  spectrum_30band:",
    "    channels:",
    "      in: 2",
    "      out: 60",
    "    mapping:",
])

# Each frequency gets an L/R pair. The browser currently reads every other
# playback meter (the L channel) for its 30-band trace, while retaining the
# stereo layout used by the Raspberry analyzer.
for band_index in range(len(FREQUENCIES)):
    for side in range(2):
        dest = band_index * 2 + side
        lines.extend([
            f"      - dest: {dest}",
            "        sources:",
            f"          - channel: {side}",
            "            gain: 0.0",
        ])

lines.extend([
    "",
    "pipeline:",
    "  - type: Mixer",
    "    name: spectrum_30band",
])

# CamillaDSP 4.x Filter steps use `channels: [N]`, not legacy `channel: N`.
for band_index in range(len(FREQUENCIES)):
    for side in range(2):
        channel = band_index * 2 + side
        lines.extend([
            "  - type: Filter",
            f"    channels: [{channel}]",
            "    names:",
            f"      - band_{band_index}",
        ])

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
OUTPUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(OUTPUT)

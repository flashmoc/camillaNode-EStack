#!/usr/bin/env python3
"""Build a Codespaces-safe spectrum config from the Raspberry spectrum config."""

from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "setupFiles" / "spectrum.yml"
OUTPUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "dev" / "spectrum-demo.generated.yml"

text = SOURCE.read_text(encoding="utf-8")

text = text.replace("  enable_rate_adjust: true", "  enable_rate_adjust: false")

old_capture = '''  capture:\n    type: ALSA\n    device: "gadget"\n    channels: 2\n    format: S32LE\n'''
new_capture = '''  capture:\n    type: SignalGenerator\n    channels: 2\n    signal:\n      type: WhiteNoise\n      level: -30.0\n'''

if old_capture not in text:
    raise SystemExit("Could not find the expected ALSA capture block in setupFiles/spectrum.yml")
text = text.replace(old_capture, new_capture, 1)

# Keep analyzer bands exactly aligned with the E-Stack spectrum UI.
frequencies = [
    25, 30, 40, 50, 63, 80, 100, 125, 160, 200,
    250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000,
    2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
]

for index, frequency in enumerate(frequencies):
    pattern = re.compile(
        rf"(  band_{index}:\n    type: Biquad\n    parameters:\n      type: Bandpass\n      freq: )([0-9.]+)"
    )
    text, count = pattern.subn(rf"\g<1>{frequency}", text, count=1)
    if count != 1:
        raise SystemExit(f"Could not update analyzer band_{index}")

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
OUTPUT.write_text(text, encoding="utf-8")
print(OUTPUT)

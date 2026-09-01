#!/usr/bin/env python3
"""Generate an endless 8-channel S32_LE stream for the Codespaces demo.

Channels 1 and 2 contain deterministic pseudo-random noise at about -30 dBFS.
Channels 3 through 8 are digital silence. The block is precomputed once and then
repeated, keeping CPU use negligible while giving CamillaDSP real capture meters.
"""

import math
import random
import struct
import sys

CHANNELS = 8
FRAMES_PER_BLOCK = 4096
LEVEL_DBFS = -30.0
FULL_SCALE = (1 << 31) - 1
AMPLITUDE = int(FULL_SCALE * (10.0 ** (LEVEL_DBFS / 20.0)))

rng = random.Random(0xE57AC)
samples = []
for _ in range(FRAMES_PER_BLOCK):
    left = rng.randint(-AMPLITUDE, AMPLITUDE)
    right = rng.randint(-AMPLITUDE, AMPLITUDE)
    samples.extend((left, right, 0, 0, 0, 0, 0, 0))

block = struct.pack(f"<{len(samples)}i", *samples)
out = sys.stdout.buffer

try:
    while True:
        out.write(block)
        out.flush()
except (BrokenPipeError, OSError):
    pass

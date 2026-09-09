# Output Processing

Status: **OUTPUT PROCESSING SOFTWARE PARITY ACCEPTED IN SIMULATION —
RASPBERRY HARDWARE ACCEPTANCE PENDING**.

## Ownership and topology

The Output Processing product page is a post-mixer editor. Its UI calls the
Output Processing domain service, which uses `EStackDSPBridge` and the existing
same-origin CamillaNode `/ws/dsp` transport. The page never builds a raw DSP
configuration upload itself.

The six operator ways are fixed:

| Channel | Way |
| --- | --- |
| 0 | SUB |
| 1 | KICK |
| 2 | MID L |
| 3 | MID R |
| 4 | HIGH L |
| 5 | HIGH R |

OUT7/OUT8 are intentionally not operator ways. Discovery begins after the
first mixer and requires verified post-mixer Gain, Delay and Limiter anchors,
so Input Processing filters such as `GLOBAL_EQ_*`, `ESTACK_INPUT_DELAY`,
`ESTACK_INPUT_PREAMP` and `INPUT_TRIM_*` are never discovered as output
filters.

## System Edit lock

Each new page session starts **LOCKED**. The lock is session/UI state only and
does not persist to browser storage, presets or DSP configuration. While
locked, Output Processing cannot change gain, mute, polarity, delay, phase,
crossover, PEQ or hard-limiter threshold. Reading topology and the magnitude
graph remains available. Unlocking enables explicit guarded commits; it is not
a mock apply/revert transaction.

## Existing output filters

Gain, mute and polarity use each way’s existing `Gain` filter:

- gain: `Gain.parameters.gain`, range `-60…+12 dB`, step `0.1 dB`;
- mute: `Gain.parameters.mute`;
- polarity: `Gain.parameters.inverted`.

The Gain identity is the same verified per-way identity as Control. Output
Processing has its own narrow writer because its calibration range intentionally
extends to `+12 dB`; Control keeps its narrower operator range.

Per-way delay changes only the existing Delay filter’s `parameters.delay`:
`0…100 ms`, step `0.01 ms`. Its `unit` and `subsample` properties are
preserved. Samples and distance shown by the UI are presentation calculations
using the live sample rate and 343 m/s.

## Crossovers

Stage 3A edits only existing `BiquadCombo` crossover filters. It can change
only `parameters.type`, `parameters.freq` and `parameters.order` for the exact
filter already in the output stage. Supported live families are
Linkwitz–Riley and Butterworth; slopes are 12/24/36/48 dB/oct.

Some anchors are shared deliberately:

- MID L/R share `mid_hpf_300_lr24` and `mid_lpf_2000_lr24`;
- HIGH L/R share `high_hpf_2000_lr24`.

The UI marks shared ownership. A shared edit changes that one definition while
the existing references in both channel stages must remain unchanged. Missing
edges (for example the current HIGH LPF) are read-only `NOT PRESENT`; Stage 3A
does not invent new crossover edges.

## Phase trim and PEQ

Phase trim uses a first-order all-pass Biquad named
`ESTACK_PHASE_CH0` through `ESTACK_PHASE_CH5`. It is `AllpassFO`, uses the live
sample rate and a reference selected from existing description metadata, then
LPF, then HPF, then 1000 Hz. Its historical description is retained:
`E-Stack phase trim <WAY> (<degrees> deg @ <reference> Hz)`. The edit range is
`-179…0°`, step `0.1°`. At less than `0.05°` magnitude it removes only that
phase filter and its reference. An active phase trim is placed after crossover
and user PEQ, before Gain.

Each channel owns ten stable PEQ identities:

`USER_CH0_PEQ_01…10` through `USER_CH5_PEQ_01…10`.

Defaults are Peaking / 31, 63, 125, 250, 500, 1000, 2000, 4000, 8000 or
16000 Hz / 0 dB / Q 0.70. Supported types are Peaking, Lowshelf and Highshelf;
ranges are frequency `20…20000 Hz`, gain `-20…+20 dB` and Q `0.1…20`.

`+ ADD PEQ` chooses the first unused stable slot. Deleting removes only that
filter and references and never renumbers another slot. A neutral band
(`abs(gain) < 0.05 dB`) or a disabled band remains defined but is absent from
the processing stage. Disabled state is UI-only browser storage at
`estack.peq.disabled.<channel>.<slot>`; it is not an invented DSP parameter.
Active PEQs are deterministically ordered by slot before phase, Gain and Delay.

## Protection and graph

Existing Compressor protection processors are read-only metrics in Stage 3A.
Hard Limiter filters remain mandatory and cannot be bypassed or removed by this
page. When System Edit is unlocked, the exact existing limiter can change only
`parameters.clip_limit`, range `-60…0 dBFS`, step `0.1`; type, soft clipping,
description and placement are preserved.

The dense calibration workspace follows the per-way operator layout: six
compact output selectors, response graph, Output/Align/Protection rack, and
simultaneously accessible PEQ/Crossover controls. It does not load the mock
per-way prototype at runtime.

The response graph is read-only and works while System Edit is locked. Its
**Magnitude** mode remains a live-config theoretical plot on a logarithmic
20 Hz…20 kHz axis: crossover, active user PEQ and output Gain are included;
input processing, dynamics and limiter non-linearity are excluded. **Phase**
uses the actual output filter stage and sample rate: BiquadCombo crossover,
USER PEQ, Delay, Gain inversion and `ESTACK_PHASE_CHx` AllpassFO all
contribute to the wrapped phase trace. **XO Align** provides SUB/KICK,
KICK/MID L, KICK/MID R, MID L/HIGH L and MID R/HIGH R pairs; its region and
marker come from the current lower LPF and upper HPF (geometric mean when both
exist). Compare and All XOs are graph overlays only.

The analyzer is a live `/ws/spectrum` read through `EStackDSPBridge`, using
the historical thirty fixed analyzer bands and straight segments between actual
samples. It never fabricates FFT points. RAW, FAST and SLOW smoothing, optional
Infinite averaging/reset, and FULL/SUB/LOW/MID/HIGH graph views are
presentation-only. A failed spectrum transport reports unavailable without
affecting theoretical graph modes or DSP configuration.

## Transaction protection

Every mutation uses GetConfig → validated narrow clone → SetConfig → GetConfig
readback. Guards are transaction-specific: delay, crossover, limiter, phase
and per-channel PEQ operations each allow only their own explicit scope. All
pipeline Mixer/Filter/Processor references are validated before upload. Shared
crossover operations additionally assert that both original shared references
remain in place.

The standalone `/prototypes/per-way/` editor remains mock-only design
reference. Live Output Processing does not load its fixtures, scenario state,
fake analyzer or apply/revert model.

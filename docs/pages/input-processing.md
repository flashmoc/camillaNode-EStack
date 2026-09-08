# Input Processing

## Status

**SOFTWARE PARITY ACCEPTED IN SIMULATION — RASPBERRY HARDWARE ACCEPTANCE
PENDING**

Live Input Processing is available through:

```text
/estack-dsp/?transport=camillanode#input-processing
```

The page is product-owned. Its UI calls `EStackInputProcessingService`, which
uses `EStackDSPBridge` as the only browser transport to the existing
CamillaNode `/ws/dsp` and `/ws/spectrum` proxies. The local prototype remains
separate; it is never an operational fallback in `transport=camillanode` mode.

## Global EQ

There are always ten stable UI slots; they are never reordered or spliced:

```text
GLOBAL_EQ_01  31 Hz       GLOBAL_EQ_06  1000 Hz
GLOBAL_EQ_02  63 Hz       GLOBAL_EQ_07  2000 Hz
GLOBAL_EQ_03  125 Hz      GLOBAL_EQ_08  4000 Hz
GLOBAL_EQ_04  250 Hz      GLOBAL_EQ_09  8000 Hz
GLOBAL_EQ_05  500 Hz      GLOBAL_EQ_10  16000 Hz
```

Each reset slot is `Peaking`, its canonical frequency, `0 dB` and `Q 0.70`.
Types are `Peaking`, `Lowshelf` and `Highshelf`. Ranges are frequency
`20…20000 Hz`, gain `−12…+12 dB`, and Q `0.1…20`.

The on/off presentation state is browser-only and is stored separately for
each named slot, for example `estack.globalEq.disabled.GLOBAL_EQ_01`. It is
not stored in CamillaDSP. Global EQ presets serialize that presentation state
as each band's `enabled` field, which is copied back to those browser keys
when a preset or import is applied. A disabled slot, or a slot whose gain is
within `abs(gain) < 0.05 dB`, is excluded from the active EQ pipeline while
retaining its stable UI identity.

Active filters are represented by the dedicated pre-mixer filter step:

```yaml
type: Filter
channels: [0, 1]
names: [GLOBAL_EQ_01, ...]
description: E-Stack global input EQ
bypassed: false
```

The service puts that exact step immediately before the first mixer. Its
guarded transaction reads the live config, changes only `GLOBAL_EQ_*` filters
and that dedicated step, uploads, reads back, and verifies all other DSP
structure is unchanged.

## Input Delay

Input Delay is shared by Input L/R before the mixer. It is `0…2000 ms` in
`0.1 ms` steps. A non-zero value uses only:

```yaml
filters:
  ESTACK_INPUT_DELAY:
    type: Delay
    parameters: { delay: <ms>, unit: ms, subsample: false }
pipeline:
  - type: Filter
    channels: [0, 1]
    names: [ESTACK_INPUT_DELAY]
    description: E-Stack input delay
    bypassed: false
```

At exactly `0 ms`, the service removes only that filter and dedicated step.
It does not alter Global EQ, output delays, mixer routing, crossovers,
protection or other processing.

## Presentation and analyzer

The compact rotary controls are presentation-only: pointer/touch vertical
drag, keyboard arrows, optional wheel movement and numerical fields call the
same service mutations. They retain the old Camilla E-Stack control feel—a
small circular technical body, a radial position mark and an embedded value—
while using the new product layout.

The cyan theoretical line is calculated in
`shared/domain/input-processing-model.js` using RBJ biquad equations at the
sample rate from the live CamillaDSP config, over a logarithmic `20 Hz…20 kHz`
axis. It is separate from the analyzer. The analyzer reads real
`GetPlaybackSignalPeak` samples through `/ws/spectrum`; FAST smoothing is
`0.58` and SLOW smoothing is `0.16`. If spectrum transport is unavailable the
page shows an unavailable analyzer state and never creates synthetic data.

## Global EQ presets and import

Global EQ presets use the existing same-origin CamillaNode saved-config APIs:
`GET /getConfigFile` and `POST /saveConfigFile`. They remain a mixed
`savedConfigs.dat` collection, so product writes always load the complete
collection, change only the intended `global-eq` record, and save the complete
collection again. Filtering by type is presentation-only: a Global EQ save or
delete must never remove `estack-system` or any other record type.

The product's shared `EStackSavedConfigClient` owns those collection
operations. A preset has the historical contract below; exactly ten bands are
saved in stable slot order and Input Delay is deliberately excluded.

```json
{
  "id": "<generated or existing id>",
  "type": "global-eq",
  "name": "My EQ",
  "createdDate": "<ISO date>",
  "data": {
    "format": "estack-global-eq-v1",
    "bands": [
      { "type": "Peaking", "freq": 63, "gain": -2.5, "q": 0.7, "enabled": true }
    ]
  }
}
```

Imports accept REW/Equalizer APO (`PK`, `LS`/`LSC`, `HS`/`HSC`, including
`OFF`), comma or whitespace tables (with optional leading index), E-Stack JSON
arrays/preset records, and CamillaDSP configuration JSON containing
`GLOBAL_EQ_01`…`GLOBAL_EQ_10`. Values are normalized through the Global EQ
model and capped at ten bands; missing slots become canonical neutral slots.
Parsing has no DSP side effects. The operator explicitly applies the parsed
data, then `applyBands()` performs one guarded live DSP transaction affecting
only `GLOBAL_EQ_*` filters and `E-Stack global input EQ`. It preserves
`ESTACK_INPUT_DELAY`, `E-Stack input delay`, and all unrelated DSP state.

## Acceptance boundary

The Input Processing simulation test performs reversible Global EQ, delay,
import and preset mutations through the product, verifies protected
configuration, and restores the exact demo DSP configuration and complete
saved-config collection. `SIMULATION/E2E PASS != RASPBERRY HARDWARE
ACCEPTANCE`.

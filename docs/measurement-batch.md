# E-Stack Measurement Batch

Measurement Batch is the repeatable measurement-campaign layer for CamillaNode. It is designed for crossover, polarity, delay, variable-phase and level-alignment work with REW while keeping CamillaDSP hardware devices unchanged.

## Design invariants

1. **The live DSP state at `START BATCH` is the baseline.** Every measurement is rebuilt from that same captured baseline plus a small validated delta. Steps never accumulate changes from the previous step.
2. **Hardware devices are never replaced by the batch runner.** Capture/playback device ownership stays with the current live CamillaDSP configuration. Mixer routing is normally copied from the captured baseline; when `measurementInput` is configured, only the first E-Stack mixer's OUT1..OUT6 source routing is temporarily replaced so the selected physical input feeds the measurement ways.
3. **Physical input numbering is one-based.** `measurementInput: 4` means physical `IN4`, which is CamillaDSP source channel `3` internally. The selected input is validated against the active mixer/capture channel count before any DSP state is changed.
4. **Master volume is attenuated during graph swaps.** The runner transitions at at most `-60 dB`, applies and verifies the processing graph and mixer routing, then restores the previous master volume.
5. **Unlisted ways are muted with their existing output Gain filters.** Crossovers, hard limiters and protection processors stay present.
6. **A batch may attenuate a way but cannot boost it above the captured baseline.** `gainOffsetDb` is limited to `-60..0 dB`.
7. **`disabledFilters` is input-processing only.** It cannot bypass output Gain, Delay, crossover, limiter or protection stages.
8. **Crossover exploration is guarded around the captured baseline.** A requested crossover frequency must remain within `0.4x..2.5x` the corresponding baseline HPF/LPF frequency. Supported families are Linkwitz-Riley and Butterworth, order 2..8; LR orders must be even.
9. **Variable phase uses the same first-order CamillaDSP `AllpassFO` law as the manual Output Processing PHASE control.** A batch phase value is applied only after that step's crossover overrides, so an `hpf` or `lpf` phase reference follows the actual crossover frequency being measured. The phase filter description stores both requested degrees and reference frequency so Output Processing displays the same reference instead of reinterpreting a band-pass all-pass at another crossover.
10. **The exact baseline processing and mixer routing are restored on finish or abort.** A same-boot CamillaNode restart also restores the baseline. After a full Raspberry reboot the stale session is discarded so normal startup recall owns the new boot state.
11. **The E-Stack Signal Generator must be stopped before starting a batch.** The batch runner refuses to start while the managed Signal Generator snapshot is active.

## Batch format — v1

```json
{
  "schema": "estack.measurement-batch",
  "version": 1,
  "name": "KICK ↔ MID optimisation",
  "description": "Broad exploration pass",
  "defaults": {
    "muteUnlisted": true,
    "settleMs": 500,
    "measurementInput": 4,
    "disabledFilters": []
  },
  "steps": [
    {
      "id": "M01",
      "name": "KICK + MID test",
      "position": "Mic on-axis, 2.00 m",
      "instruction": "Run the sweep, then press NEXT on the iPhone.",
      "activeWays": ["KICK", "MID_L"],
      "ways": {
        "MID_L": {
          "delayOffsetMs": 0.5,
          "polarity": "normal",
          "gainOffsetDb": -1.0,
          "phase": {
            "degrees": -45,
            "reference": "hpf"
          }
        }
      },
      "crossovers": {
        "KICK": {
          "lpf": { "freqHz": 285, "family": "LinkwitzRiley", "order": 4 }
        },
        "MID_L": {
          "hpf": { "freqHz": 285, "family": "LinkwitzRiley", "order": 4 }
        }
      },
      "disabledFilters": [],
      "rew": {
        "measurementName": "M01_KICK_MID_285_PHASE_M45",
        "startHz": 120,
        "endHz": 1200,
        "levelDbfs": -20,
        "timingReference": true,
        "notes": "Crossover + phase exploration"
      }
    }
  ]
}
```

### Measurement input

`defaults.measurementInput` is optional and uses the labels printed on the physical E-Stack input side:

```json
"measurementInput": 4
```

means **physical IN4**. Internally the runner routes CamillaDSP source channel `3` at `0 dB`, non-inverted, to E-Stack mixer destinations OUT1..OUT6. Output selection is then handled by the normal per-way Gain mutes from `activeWays`.

If `measurementInput` is omitted, the batch preserves the captured baseline mixer routing. The CamillaNode Batch Editor exposes this as `BASELINE ROUTING / IN1 ... IN8`, and the active measurement page shows the selected source explicitly.

The routing is temporary. `FINISH & RESTORE`, `ABORT & RESTORE`, and same-boot restart recovery restore the exact mixer mapping captured at `START BATCH`.

### Ways

Canonical keys:

- `SUB` → OUT1 / channel 0
- `KICK` → OUT2 / channel 1
- `MID_L` → OUT3 / channel 2
- `MID_R` → OUT4 / channel 3
- `HIGH_L` → OUT5 / channel 4
- `HIGH_R` → OUT6 / channel 5

Human aliases such as `MID L`, `MID-L`, `HIGH R` are accepted and normalized.

### Way deltas

- `delayMs`: absolute delay for the measurement.
- `delayOffsetMs`: offset from the captured baseline delay. Cannot be used together with `delayMs`.
- `polarity`: `normal` or `inverted`.
- `gainOffsetDb`: attenuation relative to baseline; positive values are rejected.
- `phase`: variable phase trim from `-179..0°` implemented with a first-order all-pass. `0°` removes the E-Stack phase filter for that step.

The compact phase form uses the same automatic reference rule as the manual PHASE control:

```json
"phase": -45
```

For crossover optimisation, explicit references are preferred:

```json
"phase": { "degrees": -45, "reference": "hpf" }
```

or:

```json
"phase": { "degrees": -45, "reference": "lpf" }
```

This matters for a band-pass way such as `MID_L`, which has both an HPF and an LPF. For a KICK↔MID campaign the MID phase should normally reference its **HPF**; for a MID↔HIGH campaign it should normally reference the MID **LPF**. A fixed experimental reference is also supported:

```json
"phase": { "degrees": -45, "referenceHz": 300 }
```

When `reference` is `hpf` or `lpf`, the phase all-pass is calculated **after** the step's crossover change. Example: if the MID HPF is changed from 300 Hz to 275 Hz in the same step, `-45° @ hpf` is recalculated as `-45° @ 275 Hz` rather than reusing the previous all-pass frequency.

### Crossover deltas

`hpf` and `lpf` may be a frequency number or an object containing:

- `freqHz`
- `family`: `LinkwitzRiley` or `Butterworth`
- `order`: integer 2..8; Linkwitz-Riley must be even.

The runner discovers the actual post-routing crossover filter on the requested way from the live baseline. It does not depend on frequency-bearing filter names such as `kick_lpf_300_lr24`.

### REW metadata

The `rew` object is informational in the first semi-automatic implementation. CamillaNode displays it and returns it through the API so the user knows exactly what sweep/name to use. The schema is intentionally compatible with a future REW API agent.

## REST API

### State

```http
GET /api/measurement-batch/status
```

Returns batch metadata, complete sequence, progress, current measurement, next measurement and a human-readable `message` suitable for an iPhone Shortcut notification. `batch.defaults.measurementInput` identifies the physical measurement source when configured.

### Import

```http
POST /api/measurement-batch/import
Content-Type: application/json

{ "batch": { ... } }
```

The UI performs this automatically when a JSON file is selected or the structured Batch Editor saves a draft.

### Start / advance

```http
POST /api/measurement-batch/next
```

`next` is intentionally smart:

- no active session → captures the live DSP baseline and prepares measurement 1;
- active session → marks the current step complete and prepares the next;
- current step is the final one → restores the baseline and returns `phase: "complete"`.

This makes it the preferred single-button iPhone workflow.

### Other controls

```http
POST /api/measurement-batch/previous
POST /api/measurement-batch/retry
POST /api/measurement-batch/goto   { "number": 7 }
POST /api/measurement-batch/abort
POST /api/measurement-batch/clear
```

`abort` always restores the captured processing and mixer routing before ending the session.

## iPhone Shortcut

The minimal shortcut is one action:

- **Get Contents of URL / Obtenir le contenu de l’URL**
- URL: `http://estack-dsp.local:8080/api/measurement-batch/next`
- Method: `POST`

The response field `message` can be displayed as a notification. For a richer shortcut, read `batch.defaults.measurementInput`, `current.name`, `current.activeWayLabels`, `current.rew.measurementName`, `current.rew.startHz` and `current.rew.endHz`.

## Future automatic REW mode

The batch schema already carries the REW metadata required by an automatic runner. The intended second-stage architecture is:

```text
iPhone / CamillaNode UI
          |
          v
Measurement Batch runner (Raspberry)
       |                 |
       v                 v
  CamillaDSP       E-Stack REW Agent (Windows)
                         |
                         v
                    REW localhost API
```

The Windows agent should keep REW bound to localhost, expose only the narrow E-Stack operations needed by the Raspberry, verify REW readiness, start the sweep, wait for completion, name the measurement and save the `.mdat`. The existing batch format should not need to change when this layer is added.

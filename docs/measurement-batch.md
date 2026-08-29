# E-Stack Measurement Batch

Measurement Batch is the repeatable measurement-campaign layer for CamillaNode. It is designed for crossover, polarity, delay and level-alignment work with REW while keeping CamillaDSP hardware ownership unchanged.

## Design invariants

1. **The live DSP state at `START BATCH` is the baseline.** Every measurement is rebuilt from that same captured baseline plus a small validated delta. Steps never accumulate changes from the previous step.
2. **Hardware devices and mixer routing are never replaced by the batch runner.** `devices` and `mixers` are taken from the current live CamillaDSP config at every transition. The batch owns temporary processing only (`filters`, `pipeline`, `processors`).
3. **Master volume is attenuated during graph swaps.** The runner transitions at at most `-60 dB`, applies and verifies the processing graph, then restores the previous master volume.
4. **Unlisted ways are muted with their existing output Gain filters.** Crossovers, hard limiters and protection processors stay present.
5. **A batch may attenuate a way but cannot boost it above the captured baseline.** `gainOffsetDb` is limited to `-60..0 dB`.
6. **`disabledFilters` is input-processing only.** It cannot bypass output Gain, Delay, crossover, limiter or protection stages.
7. **Crossover exploration is guarded around the captured baseline.** A requested crossover frequency must remain within `0.4x..2.5x` the corresponding baseline HPF/LPF frequency. Supported families are Linkwitz-Riley and Butterworth, order 2..8; LR orders must be even.
8. **The exact baseline processing is restored on finish or abort.** A same-boot CamillaNode restart also restores the baseline. After a full Raspberry reboot the stale session is discarded so normal startup recall owns the new boot state.
9. **The E-Stack Signal Generator must be stopped before starting a batch.** The batch runner refuses to start while the managed Signal Generator snapshot is active.

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
    "disabledFilters": []
  },
  "steps": [
    {
      "id": "M01",
      "name": "KICK + MID baseline",
      "position": "Mic on-axis, 2.00 m",
      "instruction": "Run the sweep, then press NEXT on the iPhone.",
      "activeWays": ["KICK", "MID_L"],
      "ways": {
        "MID_L": {
          "delayOffsetMs": 0.5,
          "polarity": "normal",
          "gainOffsetDb": -1.0
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
        "measurementName": "M01_KICK_MID_285",
        "startHz": 120,
        "endHz": 1200,
        "levelDbfs": -20,
        "timingReference": true,
        "notes": "Crossover exploration"
      }
    }
  ]
}
```

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

Returns batch metadata, complete sequence, progress, current measurement, next measurement and a human-readable `message` suitable for an iPhone Shortcut notification.

### Import

```http
POST /api/measurement-batch/import
Content-Type: application/json

{ "batch": { ... } }
```

The UI performs this automatically when a JSON file is selected.

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

`abort` always restores the captured processing before ending the session.

## iPhone Shortcut

The minimal shortcut is one action:

- **Get Contents of URL / Obtenir le contenu de l’URL**
- URL: `http://estack-dsp.local:8080/api/measurement-batch/next`
- Method: `POST`

The response field `message` can be displayed as a notification. For a richer shortcut, read `current.name`, `current.activeWayLabels`, `current.rew.measurementName`, `current.rew.startHz` and `current.rew.endHz`.

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

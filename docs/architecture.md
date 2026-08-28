# E-Stack architecture

## Design rules

1. **One screen per responsibility.** Output Processing owns speaker-way processing; Signal Generator is a measurement utility and does not duplicate crossover/PEQ controls.
2. **One DSP owner per setting.** UI components call the existing DSP/model functions instead of maintaining a second copy of crossover, PEQ, delay or limiter state.
3. **Runtime state is machine-local.** Hardware config and saved presets are not source-controlled.
4. **Safety paths are server-owned.** A browser closing must not be able to strand a test signal or bypass the normal configuration restore path.
5. **UI can be replaced without changing DSP semantics.** The model/mutation layer and server safety layer should survive future visual redesigns.

## Runtime topology

```text
Browser
  │
  ├─ HTTP ───────────────► CamillaNode / Express
  │                         │
  │                         ├─ static E-Stack UI
  │                         ├─ saved configuration API
  │                         └─ protected Signal Generator API
  │
  └─ WSS /ws/dsp ────────► CamillaNode WebSocket proxy
                            │
                            ├─ ws://127.0.0.1:1234  CamillaDSP main
                            └─ ws://127.0.0.1:6413  spectrum CamillaDSP
```

Codespaces additionally proxies CamillaGUI through the CamillaNode origin. That proxy is disabled on hardware.

## UI ownership

### Shell

- `public/html/main.html`
- `public/src/main.js`
- `public/src/preferences.js`
- `public/src/camillaDSP.js`

The shell owns navigation, the parent DSP connection, status indicators, saved configurations and global preferences.

### Control

- `public/html/basic.html`
- `public/src/estackBasic.js`
- the `estackControl*` modules

Owns operational output levels/mutes and input monitoring. It does not define crossover or protection topology.

### Input Processing

- `public/html/global-eq.html`
- `estackGlobalEq*`
- `estackInputDelay.js`

Owns processing before output routing: shared L/R PEQ and global input delay.

### Output Processing

`public/html/equalizer.html` is the only speaker-management page.

The current dependency order is intentional:

1. `estackEqualizer.js` — core output state, DSP access and base response functions.
2. `estackPeqModel.js` — stable USER PEQ slots and PEQ mutations.
3. `estackPeqPipelineOrder.js` / `estackOutputScope.js` — E-Stack pipeline/output invariants.
4. `estackSpectrumPro.js` — analyzer data.
5. `estackEqEight.js` — rotary UI primitives, PEQ strips and analyzer components.
6. `estackEqEightV2.js` — crossover and Output/Protection surfaces.
7. `estackOutputPhase.js` — AllpassFO phase mutation.
8. `estackEqV4.js` — final channel identity and magnitude-view presentation.
9. `estackOutputPeq.js` — final dynamic PEQ rack, local response graph and graph interaction.
10. `estackPhaseGraph.js` — final graph-mode wrapper for Magnitude / Phase / XO Align.

The old `estackPeqIsolationFix.js` + `estackDynamicPeq.js` double layer was collapsed into `estackOutputPeq.js`. The old renderer-heavy `estackPeqRack.js` was reduced to `estackPeqModel.js`.

### Signal Generator

- `public/html/signal-generator.html`
- `public/src/estackSignalGeneratorPage.js`
- `public/css/estackSignalGenerator.css`
- `server/signalGenerator.js`

The server module snapshots the exact normal CamillaDSP configuration, replaces capture with `SignalGenerator`, restricts the first mixer to selected output destinations, then restores the original configuration on manual stop, timeout, page exit or CamillaNode restart recovery.

White noise is full-band. Frequency controls exist only for sine.

## Hardware boundary

Source control owns the CamillaNode application. It does not own the live Raspberry audio stack during normal updates. The following are outside `pi-update.sh`:

- CamillaDSP binary/service
- ALSA configuration
- RASPIAUDIO device setup
- current hardware DSP YAML
- amplifier calibration

That separation is deliberate: updating the web UI must not be able to reorder or replace the live audio hardware configuration.

## Future refactors

Prefer replacing a module cleanly rather than adding `Fix`, `V3`, `V4`, `Final`, or duplicate pages. If a visual redesign is required, keep the model/API names stable and replace only the presentation module that owns that surface.

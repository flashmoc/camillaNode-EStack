# E-Stack DSP product surface

`/estack-dsp/` is the product entry point for the new E-Stack DSP workspace.
It is served by the existing CamillaNode Node process and therefore shares its
origin, authentication boundary, HTTP port and CamillaDSP proxy.

## Connection contract

The product never opens a browser connection to CamillaDSP directly.

```text
E-Stack DSP browser
  ├─ same-origin HTTP → /api/*
  └─ same-origin WebSocket → /ws/dsp
                              └─ CamillaNode → ws://127.0.0.1:1234
```

This is the exact path used by the existing CamillaNode E-Stack interface.
`CAMILLADSP_PROXY_HOST` and `CAMILLADSP_PORT` remain the only runtime
configuration for the main DSP endpoint. Spectrum remains on the existing
`/ws/spectrum` → `CAMILLA_SPECTRUM_PORT` path.

## Modes

Default product mode is local and makes no network request. To enable the
same-origin CamillaNode transport, use:

```text
http://<camillanode-host>:<port>/estack-dsp/?transport=camillanode#connections
```

The **Connections** page opens `/ws/dsp` only after the user presses
**CONNECT CAMILLADSP**. It first reads `/api/runtime` and `GetConfigJson`; it
does not write DSP state. Measurement Batch uses the existing
`/api/measurement-batch/*` runner and retains its baseline/restore safeguards.

## Compatibility

The product reuses the established server modules without a second runner:

- `server/measurementBatch.js`
- `server/signalGenerator.js`
- `server/wiimLoudnessApi.js`
- `server/startupConfiguration.js`

Future product pages must use `public/prototypes/estack-ui/shared/estack-dsp-bridge.js`
for any same-origin API or DSP-proxy transport. Direct sockets to port `1234`
and direct browser DSP writes are intentionally not allowed.

## Control domain contract

Control is implemented as a product UI over reusable domain transactions, not
as a collection of page-specific CamillaDSP patches:

- `shared/estack-dsp-bridge.js` owns the only browser transport. It serializes
  `/ws/dsp` commands and owns the independent `/ws/spectrum` connection.
- `shared/domain/pipeline.js` normalizes both CamillaDSP pipeline schemas
  (`channel: N` and `channels: [N]`) and exposes the first mixer context,
  explicit active destinations, plus direct ordered post-mixer Filter chains.
- `shared/domain/control-model.js` contains pure E-Stack configuration
  discovery and structural invariants.
- `shared/domain/control-service.js` owns Control reads, meter polling and all
  scoped mutation transactions. UI code may call the service but must never
  construct a DSP configuration write itself.

When `?transport=camillanode` is active, Control reads its master with
`GetVolume`, input levels with `GetCaptureSignalPeak`, output levels with one
shared `GetPlaybackSignalPeak` loop, and spectrum through `/ws/spectrum`.
There is no fixture or generated analyzer fallback in this mode.

Way gain and mute operations discover the actual `Gain` filter in the live
per-channel pipeline, snapshot the full configuration, alter only the chosen
`gain`/`mute` parameters, upload, read back and prove that device settings,
pipeline, mixers, processors, crossover, PEQ and limiter filters are unchanged.
MID/HIGH link state uses the established `estack.control.link.*` local-storage
keys. The 4-second peak hold, live Compressor threshold discovery, live Limiter
`clip_limit` discovery and calibrated E-Stack voltage model are likewise owned
by the service.

Input Trim and normalize operations retain the historical transaction: they
reject an active Measurement Batch or Signal Generator, snapshot the live
configuration, attenuate the master temporarily to `−60 dB`, apply only their
scoped change, upload and read back, verify the invariant, then restore the
original master even after a failed operation.

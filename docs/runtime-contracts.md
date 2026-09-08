# Runtime and API contracts

E-Stack DSP migrations reuse these CamillaNode contracts. Do not rename,
replace or bypass them without an explicit architectural decision.

## Browser transport

| Contract | Purpose | Runtime target |
| --- | --- | --- |
| `/ws/dsp` | Main CamillaDSP command channel | `CAMILLADSP_PROXY_HOST` / `CAMILLADSP_PORT` (default `127.0.0.1:1234`) |
| `/ws/spectrum` | Separate analyser command channel | `CAMILLA_SPECTRUM_PORT` (default `6413`) |
| `/api/runtime` | Public runtime mode and port metadata | Existing CamillaNode server |

Browsers connect only to the same-origin paths. They never open a direct
socket to CamillaDSP ports.

## Saved configuration interfaces

| Contract | Role |
| --- | --- |
| `GET /getConfigFile` | Reads the complete `savedConfigs.dat` collection |
| `POST /saveConfigFile` | Replaces that validated collection atomically at the application layer |
| `GET /getConfigList`, `GET /getConfig` | Named configuration listing/read |
| `POST /saveConfig`, `/saveConfigName` | Named/current configuration persistence |

## Server-owned workflows

| Contract family | Owner | Notes |
| --- | --- | --- |
| `/api/startup-config/*` | `server/startupConfiguration.js` | Startup mode and selected system preset/recall |
| `/api/loudness/*` | `server/wiimLoudnessApi.js` | WiiM/loudness settings and guarded preset application |
| `/api/measurement-batch/*` | `server/measurementBatch.js` | Baseline capture, sequencing and restore |
| `/api/test-signal/*` | `server/signalGenerator.js` | Signal-generator snapshot, routing and automatic restore |

The product must call these APIs for their owned workflows. A frontend service
must not reimplement their state files, restore timers or DSP routing logic.

## Compatibility requirement

Existing storage names, URL shapes, request/response meanings and baseline
semantics are part of the E-Stack runtime contract. Product work can add a
typed domain façade above them, but may not silently fork the backend or create
a second server.

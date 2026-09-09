# E-Stack DSP product architecture

## Product boundary

**E-Stack DSP** is the canonical future frontend for E-Stack. Its mount point
is `/estack-dsp/`, served by the existing CamillaNode Node process. The legacy
frontend remains temporarily in the repository as a behavioral specification;
it is not a runtime dependency of the product and must not be extended as the
future architecture.

```text
E-Stack DSP UI
    ↓
page UI modules
    ↓
shared E-Stack domain / services
    ↓
EStackDSPBridge
    ↓
same-origin CamillaNode
    ├── /ws/dsp
    ├── /ws/spectrum
    └── /api/*
            ↓
existing backend safety services
            ↓
CamillaDSP / WiiM / persisted configuration
```

## Ownership rules

| Layer | Owns | Must not own |
| --- | --- | --- |
| Page modules | Presentation, layout, input events and rendering service state | DSP graph mutation rules or direct transport |
| `shared/domain/` | E-Stack graph discovery, validation, scoped mutations and readback invariants | Visual layout or arbitrary server workflow replacement |
| `shared/estack-dsp-bridge.js` | The only browser transport: same-origin WebSocket/API requests and command serialization | DSP policy or page-specific config merging |
| `server/` modules | Long-lived/host-side safety workflows, persistence and recovery | Product visual state |
| CamillaDSP | Live audio processing and device/routing runtime | Product UI preferences |

This separation lets the UI be redesigned without rewriting safety-critical DSP
behavior. Page code calls a domain service; it must not assemble arbitrary
`SetConfigJson` operations or connect directly to DSP port `1234`.

## Product source layout

```text
public/prototypes/estack-ui/
  index.html                 product shell
  pages/<page>/              page UI, layout and page-specific presentation
  shared/estack-dsp-bridge.js browser transport
  shared/domain/             reusable E-Stack semantics and transactions
```

The first migrated domain is Control. `pipeline.js` is deliberately generic:
future Input Processing and Output Processing must reuse its modern/legacy
CamillaDSP pipeline schema normalization rather than reimplement it.

## Runtime reuse

The product shares the CamillaNode origin, authentication boundary and runtime
services. Existing server modules remain authoritative for Measurement Batch,
Signal Generator, loudness and startup recall. See
[runtime contracts](runtime-contracts.md) and [DSP safety](dsp-safety.md).

## Migration rule

Study legacy browser modules to port their behavior, algorithms and invariants
into product-owned modules. Do not embed legacy pages, iframes, globals or
compatibility wrappers that require the legacy UI to remain loaded. A migrated
capability belongs in the product page plus a reusable domain/service layer.

## Current status

- **Control:** product domain implementation; code parity accepted at `d1c803e`;
  Raspberry acceptance pending.
- **Other product pages:** visual/product scaffolding exists; their live DSP
  semantics are migrated only when an explicit task covers them.
- **Legacy frontend:** retained as behavioral reference until each capability
  has a product-owned replacement.

## Persistent system overview and phone layout

The product shell owns a read-only telemetry loop in `shared/system-status.js`,
using `EStackDSPBridge` independently of the selected iframe. It reads
`GetConfigJson`, `GetPlaybackSignalPeak`, `GetProcessingLoad` and `GetVolume`,
then schedules the next poll one second after completion (no overlapping polls).
Navigation does not reset these values to preview fixtures.

`shared/domain/system-status.js` derives display states using the existing
Control/pipeline discovery helpers. SYSTEM LOAD is main CamillaDSP processing
load, not operating-system CPU utilization: green below 70%, orange from 70%,
red from 90%. Unsupported/invalid load is unknown, never zero.

HARD LIMITER reports ARMED only when every active output has an enabled hard
limiter. It reports MISSING for incomplete coverage. For unmuted outputs with
signal above -90 dBFS, the smallest sampled margin is shown as HEADROOM;
NEAR LIMIT means at most 3 dB remaining, AT LIMIT means at most 0.1 dB.
These are sampled post-processing peak comparisons, not limiter gain-reduction
telemetry or proof of an actual limiting event. Silent/muted outputs provide no
headroom estimate. Failed/stale telemetry clears the readings and protection
state instead of retaining a green status. Local preview uses unknown readings.

`shared/mobile.css`, loaded after each page stylesheet, owns the common phone
spacing, 44 px touch targets, 16 px editable fields and page-specific responsive
arrangements. The shell occupies the viewport; only the selected workspace
scrolls, keeping the system overview and navigation visible.

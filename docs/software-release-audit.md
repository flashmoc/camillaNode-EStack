# E-Stack DSP software release audit

**E-STACK DSP SOFTWARE PRODUCT COMPLETE**

**SOFTWARE ACCEPTED IN SIMULATION — RASPBERRY HARDWARE ACCEPTANCE PENDING**

Base: `83cce580a9627c6b50dab70777e4d023bfac52c6`, branch
`feature/estack-dsp-product`. This is a software completion record, not physical
acceptance. No release/raspi-rc1 branch, SSH, hardware write, deployment, ALSA
change, hardware YAML edit or Raspberry service change was performed.

## Auditable changes

1. System/Startup: `d462662` — guarded system presets and startup workflow.
2. Advanced: `0e34007` — read-only live topology inspector.
3. Shell: `e13c97e` — product navigation and live/preview separation.
4. Release audit: the commit containing this document — maintainable formatting,
   canonical contracts, ownership/mock audit and the verified release gate.

## System and startup contract

See [System Presets](pages/system-presets.md) for the full schema and endpoints.
The canonical historical `estack-system` / `data.version: 1` record is reused.
Server capture saves filters, processors, pipeline, display title and Master.
Live devices, ALSA endpoints, sample rate, chunksize, hardware channels/clock,
physical mixer definitions/mappings and Raspberry configuration are excluded.
No browser graph is accepted for apply; an existing saved record ID is required.

Apply reads live config, attenuates Master to -60 dB, validates references and
live topology, merges only allowed processing, verifies complete config readback,
restores/verifies intended Master, then marks active and last used. Failure
retains safe attenuation where DSP transport permits and never falsely activates
the requested preset. Missing legacy Master uses -40 dB, not 0 dB.
Current MODIFIED state is computed on the server from processing and Master.

Capture/save is explicit; overwrite retains ID and creation date. Rename is not
exposed. Deletion is blocked for active, specific startup or last-used references.
Files are written through temporary-file/fsync/atomic rename with permissions
preserved. Mixed record collections remain intact. Stale complete collection
writes receive 409, and the generic endpoint cannot change system records.
The product Global EQ client supplies the compare-and-swap base automatically.
Legacy whole-array clients must supply If-Match; this compatibility tightening is
intentional and documented in [runtime contracts](runtime-contracts.md).

Startup YAML, SPECIFIC and LAST remain canonical. Startup choice changes future
boot only. Missing/invalid targets are visible errors; existing YAML fallback
and boot-error reporting are retained. Last boot status is separate from current
runtime source. The unchanged Raspberry restart integration continues to reuse
the startup service's strengthened applyRecord implementation; its physical
service lifecycle remains part of the later hardware acceptance.

System capture/apply refuse while Signal Generator or Measurement Batch retains
its temporary session. Their transition, timeout and recovery operations now
share an ordering gate inside CamillaNode, closing the check/start race while
preserving existing routing limits, snapshot and exact restore semantics.

## Product surface audit

Advanced shows live devices, rate/chunksize, ordered stages, channels, referenced
filters/processors and structured definitions/mixer mappings. Known anchors link
to their owning workspace. Unknown definitions stay inspectable, not editable.
Raw JSON is secondary and read-only. There are no Advanced DSP writes.

Navigation groups the ten workspaces into Processing, Systems, Tools and System.
The grouped mobile select reaches all pages while retaining live transport and
persistent shell health. The obsolete live banner and Design System navigation
are removed. Development reference assets remain on disk without live imports.

[Ownership matrix](operational-ownership.md) covers every operational feature,
read/write path, persistence and hardware status. [Live/mock audit](live-mock-audit.md)
classifies every retained adapter/fixture/reference hit. No category C remains.

## Regression boundary

- Control/Input/Output page and domain files: byte-for-byte unchanged from base.
- Gain ranges, PEQ identities, EQ maths, delays, phase, shared crossover ownership
  and limiter semantics: unchanged.
- Loudness: formatting only, unchanged backend ownership and behavior.
- Signal/Measurement: existing operations preserved; their queues participate in
  the new system workflow ordering gate. Safety caps and exact restore unchanged.
- Connections/Preferences/shared helpers: maintainable source formatting. Existing
  density/contrast now also applies to System Presets and Advanced.
- Babel AST comparison verified unchanged JavaScript for the reformatted
  Loudness, Signal, Connections, Preferences, Measurement entry and shared helper.
- Existing E2E shell-banner assertions now check the final live transport marker;
  no DSP invariant or test was removed. Global EQ cleanup uses persistence CAS.
- dev/check-demo.sh now recognizes the final product title. This is only the Linux
  development readiness check; Raspberry deployment/update scripts are unchanged.

## Release gate

Canonical Linux Dev Container, real demo CamillaDSP, one E2E worker:

| Command | Final result |
|---|---|
| npm run demo:restart | PASS |
| npm run demo:check | PASS — all four services and product/runtime route |
| npm test | PASS — repository check plus 18 selftest scripts, 0 failures |
| npm run e2e | PASS — 25 passed, 0 failed |

The added system selftest covers schema/capture, explicit overwrite, mixed
persistence, transition ordering, safe/fallback Master, full readback failure,
metadata after success only, dirty state, all startup modes, missing/invalid
references, referenced deletion, both workflow exclusions, queued start race,
write interruption and exact permissions. Live System E2E covers actual DSP
processing/hardware preservation, CAS conflict and exact original config/Master/
file restoration. Advanced and shell E2E verify real reads, no writes/mocks,
transport continuity, mobile navigation and health.

## Responsive review

Every one of the ten pages was captured and inspected at 1920x1080, 1440x900,
1024x768 and 390x844 at 100%. Desktop 125% was checked at the three desktop sizes
using equivalent CSS viewport/DPR emulation, **not native browser zoom**.
No native browser zoom result is claimed. The 70 page/size cases reported no
horizontal overflow, outer-shell overflow, JavaScript errors or stale live mock
wording. Supplemental populated-preset/startup and expanded Advanced reviews
were captured at 1440 and 390 widths. Mixer details were refined into structured
source/destination disclosures after visual review.

Local review artifacts: artifacts/ui-review/release-responsive.json,
release-*.png and release-overview-*.png. They are generated review evidence,
not runtime dependencies. Functional touch regressions remain in full E2E.

## Remaining work

**Raspberry hardware acceptance only.** No hardware acceptance is implied by
these software tests, and no Raspberry release branch was created.

# Signal Generator

Live product uses only EStackDSPBridge GET /api/test-signal/status and POST
/api/test-signal/start and /stop. No raw DSP writes or prototype adapter.
Backend owns routing, level clamping, duration, exact snapshot, recovery and
Measurement Batch exclusion. The approved ceiling is displayed from START's
response; it is not reconstructed in the browser. State polling supplies the
countdown and actual level. Missing status disables START, never invents idle.
STOP remains available when status is unavailable. Page exit requests a
keepalive stop; server timeout and crash recovery remain authoritative.
Mobile has persistent Start/Stop actions. Offline preview is disabled.
Demo E2E verifies timeout and navigation restoration against the full snapshot.
Hardware acceptance is separate.
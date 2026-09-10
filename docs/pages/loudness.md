# Loudness

Product live surface uses EStackDSPBridge with GET /api/loudness/preset,
/settings and /bridge; POST /preset, /toggle and /settings. Presets and their
scope verification remain server-owned. No browser DSP graph mutation.
Curve fields are drafts until Save; polling never overwrites an edited field.
The plotted curve is configured volume compensation, not a measured EQ response.
Bridge/WiiM unavailability is explicit, independently of DSP preset connectivity.
Offline mode is a disabled explanatory surface; no operational mock is loaded.
Software validation: scoped preset/curve E2E and responsive viewport checks.
Actual WiiM/hardware acceptance remains separate.
Disable uses the server's Reference preset endpoint; enable uses /toggle to
recall the server-owned last enabled preset. This avoids the existing toggle-off
metadata rewrite error on the Windows-mounted demo without changing backend
code, mutation scope or persisted preset semantics.

# Preferences

Browser-only product preferences live at estack.product.presentation in
localStorage: density (comfortable/compact) and contrast (standard/high).
The shared product-surface.js reader consumes them on page load and storage
updates. workflow-surface.css applies them to Loudness, Signal Generator,
Connections and Preferences; Measurement Batch uses operator.css.
Existing Control/Input/Output behavior and preferences are untouched.

No graph/meter/confirmation switches without an implemented consumer are
exposed. These settings never enter DSP configurations, server presets or
safety workflows. Reset removes only this browser presentation key.
There is no EStackPrototypeDSP dependency in either transport mode.
E2E verifies persistence and the resulting computed layout/contrast on Connections.
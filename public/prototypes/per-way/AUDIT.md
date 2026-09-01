# Per Way UI prototype — design direction and audit notes

## Scope

This directory is an isolated mock HMI. It does not import E-Stack DSP client scripts, does not use the parent iframe DSP object, and intentionally has no control transport. The page is served as a static asset only.

## Baseline observations carried into the prototype

The current Output Processing surface has strong technical content but the information hierarchy is diluted by section containers, small labels, uneven density and presentation logic inherited from several historical layers. The graph is useful and should remain dominant. Gain, delay, phase, polarity, mute and protection are the highest-frequency controls during calibration; PEQ is next; crossover changes are less frequent and can sit after PEQ.

The current shared design system already provides an appropriate dark, compact, technical visual language. The prototype therefore keeps its surface vocabulary, restrained borders, semantic status colours and tabular numeric treatment rather than introducing a separate visual brand.

## Layout options considered

### A. Dense simultaneous console

Graph, output/alignment/protection, PEQ and crossover remain visible in one continuous operator surface.

- Fastest access on desktop and laptop.
- Lowest navigation cost during measurement and alignment.
- Best at preserving cross-context between graph and numeric parameters.
- Risk: can become visually noisy or too small on tablet/mobile if desktop density is merely scaled down.

### B. Progressive specialist panels

A permanent way summary remains visible while PEQ, crossover and protection are opened as dedicated panels.

- Lower initial cognitive load.
- Easier to make comfortable on small touch displays.
- Slower for calibration because the operator must repeatedly open/close contexts.
- More likely to hide an important protection or crossover state while editing another domain.

## Chosen direction

A hybrid biased toward **A** is implemented: simultaneous dense console on desktop/laptop, then progressive reflow on tablet/mobile without hiding the active-way context. The active way becomes sticky on small screens, controls expand vertically, and PEQ rows become touch-friendly editor blocks. This keeps calibration speed on large displays while avoiding a desktop dashboard compressed into a phone.

## HMI rules exercised by the prototype

- No decorative cards where a line/group boundary is sufficient.
- Units are always adjacent to values.
- Precise parameters always expose numeric inputs; ranges are only coarse companions.
- Output/Align/Protection appears before PEQ, then Crossover.
- Selected way is encoded by name, colour, border and active state—not colour alone.
- Warning/critical states use text labels in addition to colour.
- Mock transaction feedback explicitly distinguishes MODIFIED, PENDING and APPLIED.
- Graph geometry remains stable when switching modes.
- Hover is never required for functionality.
- Focus-visible and reduced-motion behaviour are defined.

## Prototype-only tokens that may later merit promotion

- `--prototype-panel`: denser panel surface derived from the shared surfaces.
- `--prototype-row-h`: common compact row height for technical tabular editors.
- `--prototype-muted`: graph annotation colour independent from component labels.

These stay local until the product-wide visual direction is approved.

## Architecture backlog intentionally not addressed

- DSP reconnection strategy.
- Request broker/listener lifecycle.
- Global state ownership and revision handling.
- Legacy globals and monkey-patches.
- Hidden DOM compatibility mounts.
- Server-authoritative write arbitration.
- Multi-client consistency for browser-owned UI state.
- Advanced page pipeline model cleanup.

## Manual QA target

Reference viewport checks: 1440×900, 1280×800, 1024×768 and 390×844. The mock scenario selector exposes normal, dirty, pending, warning, critical, disconnected and disabled states for visual review.

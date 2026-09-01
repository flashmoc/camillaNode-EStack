# E-Stack UI architecture

## Goal

E-Stack uses one product-wide visual system so a redesign can be applied across the application without stacking page-specific override files.

## Ownership

### `public/css/estackDesignSystem.css`

This is the **single source of truth for visual language**:

- colours and surfaces
- typography scale
- spacing and radii
- borders
- buttons, selects and number inputs
- field labels
- shared rotary knobs
- semantic states (`ok`, `warn`, `danger`, `info`)
- page-title grammar
- responsive shared sizing

A product-wide redesign starts here. Do not copy these values into page stylesheets unless the value is genuinely page-specific.

### `public/css/estackTheme.css`

Compatibility entrypoint only. It imports `estackDesignSystem.css` so older pages can migrate without breaking. **Do not add rules to this file.**

### Page stylesheets

Each major screen should have one layout stylesheet. Page files own geometry and workflow-specific composition, not the global visual language.

Current Processing pages:

- Output Processing: `public/css/estackOutputProcessing.css`
- Input Processing: `public/css/estackInputProcessingPage.css`

Feature-specific styles are acceptable when the feature is genuinely isolated, but a sequence such as `PageV2.css`, `PageV3.css`, `PageV4.css` is not.

## JavaScript rule

UI code should construct its final DOM once. Avoid presentation layers that wrap or rearrange the previous version's DOM after render.

For Output Processing:

- `estackOutputWorkspace.js` owns the final per-way workspace DOM.
- `estackPhaseGraph.js` owns theoretical phase/XO calculations and graph-mode controls.
- `estackOutputPeq.js` owns PEQ graph interaction.
- `estackEqEight.js` owns the shared rotary control implementation.
- DSP mutations continue to use the existing safe/guarded upload paths.

Do not add `estackOutputWorkspaceV2.js`, `V3`, etc. Refactor the owning module instead.

## Output Processing hierarchy

The intended workflow order is:

1. Response graph
2. Stable graph-mode / channel / analyzer command surface
3. Output / Align / Protection
4. Parametric EQ
5. Crossover

This order follows measurement/calibration frequency of use and should not be reversed merely for visual symmetry.

## Refactor checklist

When changing the global look:

1. Change tokens/components in `estackDesignSystem.css`.
2. Verify Control, Loudness, Input Processing, Output Processing, Advanced, Signal Generator, Measurement Batch, Preferences and Connections.
3. Only edit a page stylesheet when its layout must change.
4. Never fix a shared visual problem by adding a new late-loading override stylesheet.
5. Keep desktop and phone layouts in the same owning page stylesheet.

When changing one page:

1. Change its owning layout stylesheet.
2. Change its owning UI module if DOM hierarchy changes.
3. Preserve shared component classes whenever possible.
4. Run `npm test` before deployment.

## Repository guard

`scripts/repo-check.js` validates active HTML assets and rejects the retired Output Processing V2–V6 presentation stack. This is intentional: a new numbered override layer is an architecture regression, not a normal way to iterate on the UI.

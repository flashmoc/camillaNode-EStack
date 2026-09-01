# E-Stack UI prototype foundation

## Direction

The UI is an operator surface: dark low-glare canvas, layered functional surfaces, explicit state text, data-aligned values, and restrained way accents. Density is preserved through grouping, not through undersized type.

## Tokens and shared components

`shared/tokens.css` owns semantic colors, spacing, type, radii, control dimensions, focus, and elevation. `base.css` owns the minimum document reset and accessibility baseline. `components.css` owns buttons, fields, sliders, toggles, badges/status, tabs, panels, toolbars, tables, meters, and alerts. `shell.css` owns only the outer application frame and navigation.

Raw color names are not part of the public token contract. Way colors are data accents: SUB, KICK, MID, and HIGH.

## Page contract

Every tab is a directory containing `page.html`, `page.css`, `page.js`, and `fixtures.js`. A page imports shared tokens, base, and components before its own stylesheet. Page CSS may lay out its domain but must not redefine `:root`, duplicate shared components, style the shell, target another page, or introduce undocumented global rules.

To add a tab: create the four files, add its shell link and route key, use fixture-only state, run both guards and syntax checks, then test direct URL, shell URL, keyboard order, and responsive layouts.

## Responsive and accessibility

Desktop uses available width up to wide operator displays. Tablet reorganizes clusters and progressively discloses secondary data. Mobile retains a sticky horizontal way selector and active-way summary, enlarges numeric controls, avoids global horizontal scroll, and never requires hover. All interactive elements require visible focus, text labels, sufficient target size, and state communicated by text or shape in addition to color. Reduced-motion preferences are honored.

Required visual viewports are 1440×900, 1280×800, 1024×768, and 390×844. Validate selection visibility, no global horizontal overflow, readable secondary text, usable numerical fields, nav access, focus sequence, and all scenario states.

## Mock-only security

Prototype documents use `connect-src 'none'`. DSP commands, DSP/spectrum sockets, parent DSP access, network request APIs, and socket constructors are forbidden. Fixtures are local and disposable. No production file is required or modified by this suite.

## Component matrix

| Component | Shell | Output Processing | Pending pages | Design System |
|---|---:|---:|---:|---:|
| Semantic tokens / type / focus | ✓ | ✓ | ✓ | ✓ |
| Navigation | ✓ | — | — | reference |
| Buttons / numeric fields / selects | context | ✓ | — | ✓ |
| Sliders / toggles | — | ✓ | — | ✓ |
| Badges / connection status | ✓ | ✓ | ✓ | ✓ |
| Panels / toolbars / tabs | — | ✓ | — | ✓ |
| Tables / meters / alerts | status | ✓ | alert | ✓ |
| Way-selection pattern | — | ✓ | — | future |

Output Processing embeds the canonical `/prototypes/per-way/` implementation. That canonical page imports the shared foundation, so the shell does not maintain a second divergent editor.

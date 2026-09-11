# E-Stack DSP frontend source

The product entry is `/estack-dsp/?transport=camillanode`. The historical
`public/prototypes/estack-ui/` source directory is retained to avoid a risky path
migration; it is not the product's name or an operational mock layer.

Canonical contracts: [architecture](../../../docs/estack-dsp-architecture.md),
[safety](../../../docs/dsp-safety.md), [runtime](../../../docs/runtime-contracts.md)
and [ownership](../../../docs/operational-ownership.md).

Specialist workspaces retain their validated domain services and layouts.
`workflow-surface.css` and `product-surface.js` serve the secondary workflows,
System Presets and the Advanced inspector. Tokens, base and components remain
shared presentation primitives. No page owns direct network transport beyond
EStackDSPBridge, and no inspector offers arbitrary raw DSP writes.

Preview/reference fixtures remain isolated outside camillanode mode. See the
[complete live/mock audit](../../../docs/live-mock-audit.md). Design System is a
developer reference only, removed from normal navigation.

Validate using the canonical Linux Dev Container demo, npm test and npm run e2e.
Software acceptance does not replace Raspberry hardware acceptance.

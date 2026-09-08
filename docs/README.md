# E-Stack DSP documentation

This directory is the canonical entry point for developers and coding agents.
The current product frontend starts at **`/estack-dsp/`**. It is a replacement
frontend that reuses the established CamillaNode runtime; it is not a second
DSP backend.

## Read in this order

1. [E-Stack DSP architecture](estack-dsp-architecture.md) — product layers,
   ownership and migration boundary.
2. [Runtime contracts](runtime-contracts.md) — stable WebSocket and HTTP
   interfaces that product migrations must preserve.
3. [DSP safety model](dsp-safety.md) — required configuration-transaction
   sequence and server-owned workflows.
4. [Persistence](persistence.md) — saved presets, startup recall and browser
   preferences.
5. [Control](pages/control.md) — the current migrated page and its hardware
   acceptance state.
6. [Input Processing](pages/input-processing.md) — live Global EQ/Input Delay
   core and its Stage 2B boundary.
7. [Development simulation and E2E](development.md) — canonical Linux
   Dev Container/Codespaces workflow and software-validation gate.

## Supporting documents

- [Raspberry deployment](raspberry.md) — CamillaNode installation/update and
  the boundary with the physical audio stack.
- [Measurement Batch](measurement-batch.md) — batch format and its existing
  server-owned safety workflow.
- [Product entry and migration status](estack-dsp-product.md) — launch modes
  and product mount path.

## Legacy reference material

[architecture.md](architecture.md) and [ui-architecture.md](ui-architecture.md)
document the still-present **legacy CamillaNode frontend** under `public/html/`,
`public/src/` and `public/css/`. They are behavioral/reference material during
migration. New product work belongs under `public/prototypes/estack-ui/` and
must follow the canonical documents above.

## Hardware status

Control is **CODE ACCEPTED — HARDWARE ACCEPTANCE PENDING** at `d1c803e`.
The Raspberry acceptance protocol must be run only when the E-Stack hardware is
available and the task explicitly authorizes real DSP writes.

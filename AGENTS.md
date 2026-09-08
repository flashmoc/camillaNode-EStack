# E-Stack DSP agent guide

1. Read [docs/README.md](docs/README.md) first.
2. `/estack-dsp/` is the product frontend. The legacy UI is a behavioral
   reference, not the architecture to extend.
3. Reuse the existing CamillaNode backend; do not create a second backend.
4. `EStackDSPBridge` is the only browser transport. UI components must not own
   arbitrary DSP configuration mutations.
5. Reuse server-owned safety APIs for Measurement Batch, Signal Generator,
   loudness and startup recall.
6. Update canonical docs when architecture/contracts change and add regression
   tests for every safety-critical change.
7. Do not create patch stacks named `Fix`, `V2`, `V3` or `Final`.
8. Real hardware writes require an explicit hardware-acceptance task.

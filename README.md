# E-Stack CamillaNode

E-Stack CamillaNode is a focused web control layer for a multi-way CamillaDSP loudspeaker system. This branch keeps the useful CamillaNode core but removes the old headphone/AutoEQ-oriented surface and adds speaker-management, measurement and protection workflows.

## Current UI

- **Control** — input meters, output levels and mutes.
- **Loudness** — master-linked loudness compensation.
- **Input Processing** — global L/R PEQ and input delay.
- **Output Processing** — per-way crossover, PEQ, gain, delay, polarity, phase, dynamics/limiter, magnitude graph, phase graph and XO Align.
- **Signal Generator** — protected internal sine or full-band white-noise source with per-way routing and automatic restore.
- **Advanced** — direct CamillaDSP pipeline inspection/editing.
- **Preferences / Connections** — E-Stack UI and DSP endpoints.

The internal test generator is injected as the CamillaDSP **capture source**, so the test signal traverses the real downstream chain:

`SignalGenerator → mixer/routing → crossover → PEQ → gain/delay/phase → protection → output`

For REW sweeps, leave the internal generator off and send the REW sweep through the normal E-Stack input.

## Repository layout

```text
index.js                     CamillaNode HTTP/WebSocket server
server/                      server-only E-Stack features
public/html/                 active pages
public/src/                  browser DSP/UI modules
public/css/                  active UI styles
dev/                         Codespaces/demo CamillaDSP environment
scripts/                     repository checks and Raspberry deployment
docs/                        E-Stack architecture/deployment notes
config/                      machine-local saved configs (.gitkeep only)
```

Machine-local runtime state is intentionally not tracked by Git:

- `camillaNodeConfig.json`
- `currentConfig.json`
- `savedConfigs.dat`
- `config/*.json`

## Codespaces / development

```bash
cd /workspaces/camillaNode-EStack
git switch camilladsp-4.1-estack
git pull
npm run demo
```

The demo starts the main CamillaDSP instance, spectrum DSP, CamillaGUI backend and CamillaNode. Open the forwarded CamillaNode port `8080`.

Static repository checks:

```bash
npm run check
```

## Raspberry Pi

This repository deliberately does **not** install, replace or reconfigure CamillaDSP, ALSA, the RASPIAUDIO device or the DSP YAML during an application update.

For an existing E-Stack checkout:

```bash
cd ~/camillanode
bash pi-update.sh
```

The updater preserves machine-local runtime state, performs a fast-forward-only Git update, installs production Node dependencies, runs repository checks, restarts `camillanode.service` when present and verifies `/api/runtime`.

For a fresh CamillaNode application/service install after cloning the repository:

```bash
bash setup.sh
```

See [docs/raspberry.md](docs/raspberry.md) before a first hardware deployment.

## Architecture

See [docs/architecture.md](docs/architecture.md). The main rule for future work is that each DSP function has one owner: DSP mutation/model code is kept separate from visual components, and patch-style duplicate pages are not added.

## License

MIT. The project is derived from CamillaNode by Ismail Ataman; the original copyright and MIT terms are retained in [LICENSE](LICENSE).

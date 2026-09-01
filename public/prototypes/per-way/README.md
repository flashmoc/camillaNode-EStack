# E-Stack Per Way UI prototype

Isolated, mock-only prototype for visual/interaction review. It is not linked from the active E-Stack navigation and does not import any DSP client module.

## Run with the existing CamillaNode server

From the repository root:

```bash
npm start
```

Open:

```text
http://localhost:<CamillaNode-port>/prototypes/per-way/
```

## Run the prototype alone on a separate port

From the repository root:

```bash
python3 -m http.server 8091 --directory public
```

Open:

```text
http://localhost:8091/prototypes/per-way/
```

This standalone path is preferred for visual review because it does not start CamillaNode or any DSP service.

## Static safety check

```bash
node public/prototypes/per-way/prototype-guard.mjs
```

The guard scans the executable prototype files for DSP/control transport tokens. The HTML also sets `connect-src 'none'` in its Content Security Policy, so browser-side connection attempts are blocked by construction.

## Review targets

- 1440 × 900
- 1280 × 800
- 1024 × 768
- 390 × 844

Use the `SCENARIO` selector to inspect normal, dirty, pending, warning, critical, disconnected and disabled states.

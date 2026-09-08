# E-Stack persistence

## Server-persisted state

| Storage | Owner | Meaning |
| --- | --- | --- |
| `savedConfigs.dat` | CamillaNode saved-config API | Collection of user presets, including historical `global-eq` and `estack-system` records |
| `startupConfig.json` | Startup Configuration service | Startup mode (`yaml`, `specific`, `last`) and last/active system preset metadata |
| `currentConfig.json` | CamillaNode | Current named configuration selection metadata |
| `config/*.json` | CamillaNode | Named configuration records |
| `camillaNodeConfig.json` | CamillaNode deployment | Application HTTP port/runtime configuration |

`estack-system` records are full processing snapshots used by the server-owned
startup recall workflow. `global-eq` records are input/global EQ presets. The
legacy saved-config client keeps type/name/id semantics; the product must retain
those data formats and APIs while it migrates the related pages.

## Browser-local preferences

Browser storage is for presentation/operator preferences only. It is not DSP
state and must never be treated as the live source of truth. Current examples:

- `estack.control.link.mid`
- `estack.control.link.high`
- historical local saved-config UI cache keys such as `savedConfigs`

The MID/HIGH keys control linked **gain** interaction only. They do not persist
or imply a DSP mute state.

## Raspberry runtime state outside source control

The physical CamillaDSP YAML, ALSA/RASPIAUDIO devices, amplifier calibration
and live hardware routing are not owned by source control. The normal updater
preserves the runtime files above and must not rewrite the hardware graph during
a UI update. See [Raspberry deployment](raspberry.md).

## Rule for product services

Read live DSP state through CamillaDSP for operational controls. Use persisted
server APIs only for their designated preset/configuration workflows. Do not
invent a browser persistence format for processing, limiter, mixer or device
state.

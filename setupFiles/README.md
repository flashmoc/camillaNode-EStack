# Legacy hardware templates

These files come from the original CamillaNode installation flow and are **not used** by the E-Stack `setup.sh` or `pi-update.sh` scripts.

They are kept temporarily only to avoid silently breaking an existing Raspberry installation that may still reference one of these paths. Do not use the old CamillaDSP service/YAML templates as a source of truth for the current E-Stack hardware.

New CamillaNode service installation is owned by `scripts/pi-install.sh`. Normal updates never modify CamillaDSP, ALSA or the live DSP YAML.

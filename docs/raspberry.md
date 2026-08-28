# Raspberry Pi deployment

## Scope

The deployment scripts in this repository manage **CamillaNode only**. They do not install or rewrite CamillaDSP, ALSA, RASPIAUDIO configuration or the live DSP YAML.

## Existing E-Stack Raspberry

From the existing checkout:

```bash
cd ~/camillanode
bash pi-update.sh
```

The update sequence is:

1. abort if local application code has uncommitted edits;
2. copy machine-local runtime files to a temporary backup;
3. fast-forward the `camilladsp-4.1-estack` branch;
4. restore runtime state;
5. run `npm ci --omit=dev`;
6. run `npm run check`;
7. restart `camillanode.service` if it exists;
8. verify the local `/api/runtime` endpoint.

Runtime files preserved by the updater:

```text
camillaNodeConfig.json
currentConfig.json
savedConfigs.dat
config/
```

If the update script reports local **code** changes, inspect them before continuing. Do not force/reset a Raspberry that contains unidentified hardware-specific edits.

## Fresh CamillaNode service

Clone the branch, then run:

```bash
git clone --branch camilladsp-4.1-estack --single-branch \
  https://github.com/flashmoc/camillaNode-EStack.git ~/camillanode
cd ~/camillanode
bash setup.sh
```

`setup.sh` installs production Node dependencies, creates `camillaNodeConfig.json` with port `8080` when missing, validates the repository and creates `/etc/systemd/system/camillanode.service` for the current Linux user.

The generated unit uses the actual `node` binary path and current checkout path. `CAP_NET_BIND_SERVICE` is granted so an existing low HTTP port can still be used without running the whole Node process as root.

## Useful checks

```bash
sudo systemctl status camillanode --no-pager
journalctl -u camillanode -n 80 --no-pager
ss -ltnp | grep -E '8080|80|1234|6413'
npm run check
```

The application health endpoint is:

```text
/api/runtime
```

It exposes only runtime mode and endpoint ports; it does not expose the DSP configuration.

## Safety

The Signal Generator stores its temporary normal-config snapshot under `/tmp` with restrictive permissions. If CamillaNode restarts while the capture device is still a test generator, the backend attempts to restore the normal configuration automatically.

The Raspberry updater never deliberately edits the main CamillaDSP configuration. A UI update should therefore remain separate from hardware routing and limiter commissioning.

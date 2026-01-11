# Installation Guide

## Prerequisites

Before installing CamillaNode, ensure you have the following installed:

### Required Software
- **Node.js** (v14 or higher) and **npm**
- **CamillaDSP** - The DSP engine that CamillaNode controls
- **Git** - For cloning the repository

### Installing Prerequisites

#### On Debian/Ubuntu-based systems:
```bash
sudo apt update
sudo apt install npm git
```

#### On other systems:
Download Node.js from [nodejs.org](https://nodejs.org/en/download)

## Quick Installation

The simplest way to install CamillaNode is using the provided `setup.sh` script:

```bash
chmod +x setup.sh
sudo bash setup.sh
```

This will:
1. Update system packages
2. Install npm if not present
3. Clone the CamillaNode repository
4. Install Node.js dependencies

## Manual Installation

If you prefer to install manually:

```bash
# Clone the repository
git clone https://github.com/ismailAtaman/camillaNode.git camillanode
cd camillanode

# Install dependencies
npm install
```

## Installing CamillaDSP

CamillaNode requires CamillaDSP to be installed and running. Use the provided `install.sh` script:

```bash
chmod +x install.sh
sudo bash install.sh
```

The script will:
1. Configure USB audio gadget mode (for devices supporting it)
2. Download and install CamillaDSP binary
3. Set up systemd services for CamillaDSP and CamillaNode
4. Configure ALSA audio routing

During installation, you'll be prompted for:
- **Username** - Your system username
- **Input device** - Audio capture device name (default: UAC2Gadget)
- **Output device** - Audio playback device name

### What Gets Installed

The install script copies several files:
- `camilladsp.service` → `/etc/systemd/system/`
- `camilladsp2.service` → `/etc/systemd/system/`
- `camillanode.service` → `/etc/systemd/system/`
- `default.yml` → `~/camilladsp/`
- `spectrum.yml` → `~/camilladsp/`
- `asound.conf` → `/etc/`

## Configuration

### CamillaNode Configuration

CamillaNode stores its configuration in `camillaNodeConfig.json`:

```json
{
  "port": 80
}
```

Edit this file to change the web server port. Default is port 80 (requires root/sudo).

### CamillaDSP Configuration

CamillaDSP must be started with WebSocket support enabled:

```bash
camilladsp -p 1234 -a 0.0.0.0 config.yml
```

Where:
- `-p 1234` - WebSocket port (default: 1234)
- `-a 0.0.0.0` - Bind to all network interfaces (required for remote access)
- `config.yml` - CamillaDSP configuration file

## Running as a Service

### Enable Services

After installation, enable and start the services:

```bash
sudo systemctl enable camilladsp.service
sudo systemctl enable camillanode.service
sudo systemctl start camilladsp.service
sudo systemctl start camillanode.service
```

### Check Service Status

```bash
sudo systemctl status camillanode
sudo systemctl status camilladsp
```

### Service Configuration

Edit `/etc/systemd/system/camillanode.service` to customize:

```ini
[Unit]
Description=camillaNode Service
After=network.target

[Service]
User=root
Group=nogroup
ExecStart=/usr/bin/node /home/USERNAME/camillanode/index.js
WorkingDirectory=/home/USERNAME/camillanode/
Environment=PATH=/home/USERNAME/camillanode/
Restart=always

[Install]
WantedBy=multi-user.target
```

Replace `USERNAME` with your actual username.

## Running Manually

For development or testing:

```bash
cd camillanode
node index.js
```

Or with nodemon (auto-restart on file changes):

```bash
npm start
```

## Accessing CamillaNode

Once running, access the web interface:

- **Local access**: `http://localhost` (or `http://localhost:PORT`)
- **Remote access**: `http://YOUR_IP_ADDRESS` (or with port if not 80)

Default port is 80 (configurable in `camillaNodeConfig.json`).

## Updating CamillaNode

Use the provided `update.sh` script:

```bash
sudo bash update.sh
```

Or manually:

```bash
sudo systemctl stop camillanode
cd /home/USERNAME/camillanode/
git pull https://github.com/ismailAtaman/camillaNode.git
npm install
sudo systemctl start camillanode
```

## Troubleshooting

### Port Permission Issues

If you get a permission error on port 80:
- Run with sudo: `sudo node index.js`
- Or change port to 3000 or 8080 in `camillaNodeConfig.json`

### Can't Connect to CamillaDSP

1. Check CamillaDSP is running: `sudo systemctl status camilladsp`
2. Verify WebSocket port in service file
3. Ensure CamillaDSP started with `-a 0.0.0.0` for network access
4. Check firewall settings

### Service Won't Start

```bash
# View service logs
sudo journalctl -u camillanode -n 50

# Check for errors in the service file
sudo systemctl cat camillanode
```

## Uninstalling

```bash
# Stop and disable services
sudo systemctl stop camillanode camilladsp
sudo systemctl disable camillanode camilladsp

# Remove service files
sudo rm /etc/systemd/system/camillanode.service
sudo rm /etc/systemd/system/camilladsp.service
sudo rm /etc/systemd/system/camilladsp2.service

# Reload systemd
sudo systemctl daemon-reload

# Remove application directory
rm -rf ~/camillanode
```

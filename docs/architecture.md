# Architecture

## Overview

CamillaNode is a web-based control interface for CamillaDSP, providing a graphical user interface to configure and manage audio DSP (Digital Signal Processing). The application follows a client-server architecture with a Node.js backend and vanilla JavaScript frontend.

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Browser                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │            Frontend (HTML/CSS/JavaScript)             │  │
│  │  - Static pages (public/html/*.html)                  │  │
│  │  - Client modules (public/src/*.js)                   │  │
│  │  - UI components and visualizations                   │  │
│  └──────────────┬────────────────────────────────────────┘  │
│                 │ HTTP/WebSocket                            │
└─────────────────┼───────────────────────────────────────────┘
                  │
┌─────────────────┼───────────────────────────────────────────┐
│                 │        CamillaNode Server                 │
│  ┌──────────────▼────────────────────────────────────────┐  │
│  │              Express.js (index.js)                    │  │
│  │  - Serves static files                                │  │
│  │  - REST API endpoints                                 │  │
│  │  - Configuration management                           │  │
│  └──────────────┬────────────────────────────────────────┘  │
│                 │ File I/O                                  │
│  ┌──────────────▼────────────────────────────────────────┐  │
│  │         Configuration Storage                         │  │
│  │  - savedConfigs.dat (user configs)                    │  │
│  │  - camillaNodeConfig.json (app config)                │  │
│  │  - currentConfig.json (active config)                 │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────┼───────────────────────────────────────────┘
                  │ WebSocket
┌─────────────────▼───────────────────────────────────────────┐
│                    CamillaDSP                               │
│  - Audio processing engine                                  │
│  - WebSocket server (port 1234)                             │
│  - Spectrum analyzer (port 1235)                            │
└─────────────────────────────────────────────────────────────┘
```

## Components

### Backend (Node.js)

#### index.js - Main Server

The Express.js server that handles:
- **Static file serving**: Serves HTML, CSS, JavaScript, and assets from `/public`
- **Routing**: Maps URLs to HTML pages
- **Configuration API**: REST endpoints for saving/loading configurations
- **File management**: Reads/writes configuration files

**Key Dependencies:**
- `express` - Web framework
- `ws` - WebSocket client for CamillaDSP communication
- `fs` - File system operations

**Port Configuration:**
```javascript
{
  "port": 80  // Configurable in camillaNodeConfig.json
}
```

#### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Main page (dashboard) |
| GET | `/basic` | Simple tone controls page |
| GET | `/equalizer` | Parametric EQ page |
| GET | `/advanced` | Advanced configuration |
| GET | `/connections` | Server connection settings |
| GET | `/preferences` | Application preferences |
| GET | `/room` | Room correction tools |
| GET | `/spectrum` | Spectrum analyzer |
| POST | `/saveConfigFile` | Save configuration to server |
| GET | `/getConfigFile` | Load configuration from server |
| POST | `/saveConfigName` | Save current config name |
| GET | `/getConfigName` | Get current config name |
| GET | `/configExists` | Check if config exists |
| GET | `/deleteConfig` | Delete a configuration |

### Frontend (HTML/CSS/JavaScript)

#### Page Structure

```
public/
├── html/           # Page templates
│   ├── main.html           # Dashboard/navigation
│   ├── basic.html          # Basic tone controls
│   ├── equalizer.html      # Parametric EQ
│   ├── advanced.html       # Advanced config
│   ├── connections.html    # Connection settings
│   ├── preferences.html    # App preferences
│   ├── room.html           # Room correction
│   └── spectrum.html       # Spectrum analyzer
├── src/            # JavaScript modules
│   ├── main.js             # Main app logic & navigation
│   ├── basic.js            # Basic controls logic
│   ├── equalizer.js        # EQ editor logic
│   ├── advanced.js         # Advanced config logic
│   ├── preferences.js      # Preferences management
│   ├── camillaDSP.js       # CamillaDSP WebSocket client
│   ├── savedConfigs.js     # Configuration persistence
│   ├── autoeq.js           # AutoEQ database integration
│   ├── eqplot.js           # EQ frequency response plotting
│   ├── filter.js           # Filter parameter handling
│   └── knob.js             # Knob UI component
├── css/
│   └── main.css            # Application styles
└── img/            # Icons and images
```

#### Key Frontend Modules

**main.js** - Application core
- Navigation between pages
- DSP connection management
- Status indicator updates
- Configuration management UI
- AutoEQ integration
- Import/Export functionality

**camillaDSP.js** - CamillaDSP WebSocket Client
- Connects to CamillaDSP via WebSocket
- Sends commands (SetVolume, GetConfig, etc.)
- Receives status updates
- Manages configuration upload/download
- Handles spectrum analyzer connection

**equalizer.js** - Parametric EQ Editor
- Filter list management
- Visual frequency response graph
- Filter parameter editing
- Drag-and-drop filter adjustment
- Filter type selection

**savedConfigs.js** - Configuration Persistence
- Save/load configurations to server
- Browser localStorage for local settings
- Configuration search and filtering
- Per-page configuration storage

**autoeq.js** - AutoEQ Integration
- Fetches headphone profiles from GitHub
- Parses AutoEQ text format
- Searches AutoEQ database
- Imports filters from profiles

**eqplot.js** - Frequency Response Visualization
- Calculates frequency response curve
- Renders interactive graph using Canvas
- Shows filter effects visually
- Handles mouse interaction for filter editing

**preferences.js** - Settings Management
- Theme customization (color hue)
- Default page selection
- Feature toggles (DC protection, etc.)
- Stores preferences in localStorage

### Configuration Storage

#### savedConfigs.dat
Primary configuration storage file containing an array of saved configurations:

```json
[
  {
    "type": "equalizer",
    "name": "My EQ Preset",
    "createdDate": "2026-01-09T...",
    "data": {
      "title": "My EQ Preset",
      "filters": { /* filter definitions */ },
      "mixers": { /* mixer definitions */ },
      "pipeline": [ /* processing chain */ ]
    }
  }
]
```

**Configuration Types:**
- `equalizer` - Filter configurations
- `basic` - Simple tone control settings
- `connections` - Server connection profiles

#### camillaNodeConfig.json
Application configuration:
```json
{
  "port": 80
}
```

#### currentConfig.json
Tracks the currently active configuration:
```json
{
  "configName": "My EQ Preset",
  "configShortcut": ""
}
```

## Communication Flow

### WebSocket Communication with CamillaDSP

CamillaNode communicates with CamillaDSP using WebSocket protocol:

```javascript
// Example: Set volume
DSP.sendDSPMessage({"SetVolume": -10.5})

// Example: Get configuration
let config = await DSP.sendDSPMessage("GetConfigJson")

// Example: Upload new configuration
await DSP.uploadConfig(config)
```

**Common Commands:**
- `GetConfigJson` - Retrieve current configuration
- `SetConfigJson` - Upload new configuration
- `GetVolume` / `SetVolume` - Volume control
- `GetCaptureRate` - Sample rate
- `GetClippedSamples` - Clipping detection
- `GetProcessingLoad` - CPU utilization
- `ResetClippedSamples` - Clear clipping counter

### Real-time Status Updates

Status indicators update via polling:

```javascript
// Every 2 seconds: Sample rate, clipping, utilization
setInterval(async function(){
    let rate = await DSP.sendDSPMessage("GetCaptureRate");
    let clipped = await DSP.sendDSPMessage("GetClippedSamples");
    // Update UI...
}, 2000);

// Every 4 seconds: Balance, crossfeed, filter count
setInterval(async function(){
    let balance = await DSP.getBalance();
    let crossfeed = await DSP.getCrossfeed();
    // Update UI...
}, 4000);
```

## Data Models

### Filter Object

```javascript
{
  "FilterName": {
    "type": "Biquad",
    "parameters": {
      "type": "Peaking",  // Peaking, Lowshelf, Highshelf, etc.
      "freq": 1000,       // Frequency in Hz
      "gain": 3.5,        // Gain in dB
      "q": 1.0            // Q factor
    }
  }
}
```

### Mixer Object

```javascript
{
  "MixerName": {
    "channels": {
      "in": 2,
      "out": 2
    },
    "mapping": [
      {"dest": 0, "sources": [{"channel": 0, "gain": 0, "inverted": false}]},
      {"dest": 1, "sources": [{"channel": 1, "gain": 0, "inverted": false}]}
    ]
  }
}
```

### Pipeline Array

Defines the processing chain:
```javascript
[
  {"type": "Mixer", "name": "MixerName"},
  {"type": "Filter", "channel": 0, "names": ["Filter1", "Filter2"]},
  {"type": "Filter", "channel": 1, "names": ["Filter1", "Filter2"]}
]
```

## Security Considerations

### Port Access
- Default port 80 requires root/sudo privileges
- Consider using higher ports (3000, 8080) for non-root operation
- Use reverse proxy (nginx) for production deployments

### Network Exposure
- CamillaDSP WebSocket must bind to `0.0.0.0` for remote access
- No authentication implemented - use firewall rules to restrict access
- Consider VPN or SSH tunneling for remote administration

### File Permissions
- Configuration files should be readable/writable by server user
- Service runs as root by default (see camillanode.service)
- Consider running as dedicated user with appropriate permissions

## Performance Characteristics

### Resource Usage
- **CPU**: Minimal (< 5% on typical hardware)
- **Memory**: ~50-100 MB
- **Network**: Low bandwidth (WebSocket commands only)
- **Disk**: Configuration files typically < 1 MB total

### Scalability
- Single-user application (no multi-user support)
- Can control multiple CamillaDSP instances (via connection profiles)
- Handles hundreds of filters without performance issues

### Bottlenecks
- WebSocket latency to CamillaDSP (typically < 10ms local)
- Browser rendering for complex EQ graphs
- File I/O for configuration save/load

## Technology Stack

### Backend
- **Runtime**: Node.js
- **Framework**: Express.js 4.19.2
- **WebSocket**: ws 8.13.0
- **Dev Tools**: nodemon 3.1.0

### Frontend
- **HTML5**: Semantic markup
- **CSS3**: Custom styling, CSS variables for theming
- **JavaScript**: ES6+ modules, async/await
- **Canvas API**: For EQ graph visualization
- **Web Storage API**: localStorage for preferences
- **Fetch API**: For AutoEQ database access

### External Services
- **AutoEQ Database**: GitHub API for headphone profiles
- **CamillaDSP**: WebSocket server for DSP control

## Deployment

### System Services

Three systemd services work together:

1. **camilladsp.service** - Main DSP engine
2. **camilladsp2.service** - Secondary DSP instance (optional)
3. **camillanode.service** - Web interface

Services start in order:
```
network.target → camilladsp.service → camillanode.service
```

### Directory Structure

```
/home/USERNAME/camillanode/     # Application root
├── index.js                     # Server entry point
├── package.json                 # Dependencies
├── public/                      # Static files
├── setupFiles/                  # Service templates
├── docs/                        # Documentation
├── savedConfigs.dat             # User configurations
├── camillaNodeConfig.json       # App config
└── currentConfig.json           # Active config

/home/USERNAME/camilladsp/       # CamillaDSP directory
├── default.yml                  # Default DSP config
└── spectrum.yml                 # Spectrum analyzer config
```

## Extension Points

### Adding New Pages

1. Create HTML file in `public/html/`
2. Add route in `index.js`:
   ```javascript
   app.get('/newpage', (req, res) => {
       res.sendFile(__dirname + '/public/html/newpage.html');
   })
   ```
3. Add navigation link in `main.html`
4. Create JavaScript module in `public/src/` if needed

### Custom Filter Types

Extend `filter.js` to support new CamillaDSP filter types:
```javascript
// Add to filter type list
const filterTypes = [
    "Peaking", "Lowshelf", "Highshelf",
    "CustomType"  // New type
];
```

### AutoEQ Sources

Extend `autoeq.js` to support additional AutoEQ repositories:
```javascript
const repoSources = {
    "Oratory1990": "...",
    "Crinacle": "...",
    "NewSource": "https://api.github.com/repos/..."
};
```

## Troubleshooting Architecture Issues

### WebSocket Connection Failures
- Check CamillaDSP is bound to correct interface (`-a 0.0.0.0`)
- Verify firewall rules allow WebSocket port
- Ensure CamillaDSP WebSocket server is enabled

### Configuration Not Persisting
- Check file permissions on `savedConfigs.dat`
- Verify working directory in systemd service
- Ensure sufficient disk space

### Performance Issues
- Monitor CamillaDSP CPU usage (primary bottleneck)
- Reduce filter count in complex configurations
- Check network latency for remote connections
- Clear browser cache if UI is slow

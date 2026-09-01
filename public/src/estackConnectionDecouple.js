// E-Stack connection layer.
// The main DSP connection is authoritative, while the spectrum connection is
// optional. Both browser WebSockets are routed through CamillaNode on port 8080
// so Chrome never needs to open direct local-network sockets to 1234/6413.
export default function installEStackConnectionDecouple(camillaDSP) {
    if (!camillaDSP?.prototype || camillaDSP.prototype.__estackConnectionDecoupled) return;

    const p = camillaDSP.prototype;
    p.__estackConnectionDecoupled = true;

    // Same-origin proxy. CamillaNode forwards these paths internally to
    // 127.0.0.1:1234 and 127.0.0.1:6413.
    p.connectToDSP = function(server, port) {
        return new Promise((resolve, reject) => {
            const isSpectrum = String(port) === String(this.spectrumPort);
            const proxyPath = isSpectrum ? "/ws/spectrum" : "/ws/dsp";
            const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
            const url = `${protocol}//${window.location.host}${proxyPath}`;
            const ws = new WebSocket(url);

            let settled = false;
            const fail = (event) => {
                if (settled) return;
                settled = true;
                reject([false, event]);
            };

            ws.addEventListener("open", () => {
                if (settled) return;
                settled = true;
                resolve([true, ws]);
            }, { once: true });
            ws.addEventListener("error", fail, { once: true });
        });
    };

    p.connect = async function(server, port, spectrumPort) {
        if (server === undefined) {
            server = window.localStorage.getItem("server") || window.location.hostname;
            port = window.localStorage.getItem("port") || "1234";
            spectrumPort = window.localStorage.getItem("spectrumPort") || "6413";
        }

        // Keep the visible connection settings meaningful, even though the
        // browser transport itself now uses the same-origin proxy.
        if (server === undefined || server === null || server === "") server = window.location.hostname;
        if (port === undefined || port === null || String(port) === "") port = "1234";
        if (spectrumPort === undefined || spectrumPort === null || String(spectrumPort) === "") spectrumPort = "6413";

        this.server = server;
        this.port = port;
        this.spectrumPort = spectrumPort;
        this.connected = false;
        this.spectrum_connected = false;
        this.ws = undefined;
        this.ws_spectrum = undefined;

        // 1) Main DSP: required.
        try {
            const result = await this.connectToDSP(server, port);
            this.ws = result[1];
            this.connected = true;
            console.log(`Connected to main DSP through CamillaNode proxy (${server}:${port}).`);

            this.ws.addEventListener("close", () => {
                this.connected = false;
                console.warn("Main DSP WebSocket disconnected.");
            });
        } catch (error) {
            this.connected = false;
            console.error("Main DSP connection error", error);
            return false;
        }

        // 2) Spectrum: optional and independent.
        try {
            const spectrumResult = await this.connectToDSP(server, spectrumPort);
            this.ws_spectrum = spectrumResult[1];
            this.spectrum_connected = true;
            console.log(`Connected to spectrum through CamillaNode proxy (${server}:${spectrumPort}).`);

            this.ws_spectrum.addEventListener("close", () => {
                this.spectrum_connected = false;
                console.warn("Spectrum WebSocket disconnected; main DSP remains available.");
            });
        } catch (error) {
            this.spectrum_connected = false;
            this.ws_spectrum = undefined;
            console.warn(
                `Spectrum unavailable on ${server}:${spectrumPort}; continuing with the main DSP.`,
                error
            );
        }

        // Initialization only needs the main DSP socket.
        try {
            const initSuccess = await this.initAfterConnection();
            if (initSuccess === undefined || initSuccess === false) {
                console.error("Main DSP configuration initialization failed.");
                this.connected = false;
                return false;
            }
        } catch (error) {
            console.error("Main DSP configuration initialization failed", error);
            this.connected = false;
            return false;
        }

        return this.connected;
    };
}

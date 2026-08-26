// E-Stack: the main DSP connection is authoritative.
// The optional spectrum WebSocket must never make CamillaNode report the
// whole DSP as disconnected when only the analyzer is unavailable.
export default function installEStackConnectionDecouple(camillaDSP) {
    if (!camillaDSP?.prototype || camillaDSP.prototype.__estackConnectionDecoupled) return;

    camillaDSP.prototype.__estackConnectionDecoupled = true;

    camillaDSP.prototype.connect = async function(server, port, spectrumPort) {
        if (server === undefined) {
            server = window.localStorage.getItem("server");
            port = window.localStorage.getItem("port");
            spectrumPort = window.localStorage.getItem("spectrumPort");
        }

        if (server === undefined || server === null || server === "") return false;

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
            console.log(`Connected to main DSP on ${server}:${port}.`);

            this.ws.addEventListener("close", () => {
                this.connected = false;
                console.warn("Main DSP WebSocket disconnected.");
            });
        } catch (error) {
            this.connected = false;
            console.error("Main DSP connection error", error);
            return false;
        }

        // 2) Spectrum: optional and independent from the main DSP.
        if (spectrumPort !== undefined && spectrumPort !== null && String(spectrumPort) !== "") {
            try {
                const spectrumResult = await this.connectToDSP(server, spectrumPort);
                this.ws_spectrum = spectrumResult[1];
                this.spectrum_connected = true;
                console.log(`Connected to spectrum on ${server}:${spectrumPort}.`);

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

        // Return the state of the real DSP only. Spectrum status is exposed
        // separately through spectrum_connected.
        return this.connected;
    };
}

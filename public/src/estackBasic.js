let DSP;

function waitForDSP() {
    return new Promise(resolve => {
        const timer = setInterval(() => {
            if (window.parent?.DSP) {
                clearInterval(timer);
                resolve(window.parent.DSP);
            }
        }, 50);
    });
}

async function loadBasic() {
    DSP = await waitForDSP();
    await DSP.downloadConfig();

    const volume = document.getElementById("masterVolume");
    const value = document.getElementById("masterVolumeValue");
    const current = Number(await DSP.sendDSPMessage("GetVolume"));
    volume.value = current;
    value.textContent = `${current.toFixed(1)} dB`;

    volume.addEventListener("input", () => {
        value.textContent = `${Number(volume.value).toFixed(1)} dB`;
    });
    volume.addEventListener("change", async () => {
        const gain = Number(volume.value);
        await DSP.sendDSPMessage({ SetVolume: gain });
    });

    const outputs = document.getElementById("estackOutputSummary");
    const labels = ["SUB", "KICK", "MID L", "MID R", "HIGH L", "HIGH R"];
    for (const ch of DSP.getActiveOutputChannels().filter(ch => ch <= 5)) {
        const item = document.createElement("div");
        item.className = "estack-basic-output";
        item.innerHTML = `<strong>${labels[ch] || `CH ${ch}`}</strong><span>OUT ${ch + 1}</span><small>${DSP.getChannelFiltersList(ch).length} DSP filters</small>`;
        outputs.appendChild(item);
    }
}

document.addEventListener("DOMContentLoaded", loadBasic);

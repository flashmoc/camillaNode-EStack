// E-Stack global input delay.
// One shared L/R delay before routing so relative SUB/KICK/MID/HIGH alignment is
// preserved. Intended for whole-system multiroom / external-speaker sync.

const ESTACK_INPUT_DELAY_FILTER = "ESTACK_INPUT_DELAY";
const ESTACK_INPUT_DELAY_STEP = "E-Stack input delay";
const ESTACK_INPUT_DELAY_MAX_MS = 2000;

let inputDelayDSP;
let inputDelayValue = 0;
let inputDelayApplying = false;

function inputDelayWaitForDSP() {
    return new Promise(resolve => {
        const timer = setInterval(() => {
            if (window.parent?.DSP) {
                clearInterval(timer);
                resolve(window.parent.DSP);
            }
        }, 50);
    });
}

function inputDelayClamp(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.round(Math.max(0, Math.min(ESTACK_INPUT_DELAY_MAX_MS, numeric)) * 10) / 10;
}

function inputDelayCaptureChannels() {
    const count = Math.max(1, Number(inputDelayDSP?.config?.devices?.capture?.channels || 2));
    return Array.from({ length: Math.min(2, count) }, (_, index) => index);
}

function inputDelayFirstMixerIndex() {
    return (inputDelayDSP?.config?.pipeline || []).findIndex(step => step?.type === "Mixer");
}

function inputDelayStep() {
    return (inputDelayDSP?.config?.pipeline || []).find(step =>
        step?.type === "Filter" && (
            step?.description === ESTACK_INPUT_DELAY_STEP ||
            (step.names || []).includes(ESTACK_INPUT_DELAY_FILTER)
        )
    ) || null;
}

function inputDelayRead() {
    const filter = inputDelayDSP?.config?.filters?.[ESTACK_INPUT_DELAY_FILTER];
    const step = inputDelayStep();
    if (!filter || filter.type !== "Delay" || !step) return 0;
    return inputDelayClamp(filter.parameters?.delay || 0);
}

function inputDelayEnsureStep() {
    const pipeline = inputDelayDSP.config.pipeline || (inputDelayDSP.config.pipeline = []);
    let mixerIndex = inputDelayFirstMixerIndex();
    if (mixerIndex < 0) throw new Error("No Mixer stage found");

    let step = inputDelayStep();
    if (!step) {
        step = {
            type: "Filter",
            channels: inputDelayCaptureChannels(),
            names: [ESTACK_INPUT_DELAY_FILTER],
            description: ESTACK_INPUT_DELAY_STEP,
            bypassed: false
        };
        pipeline.splice(mixerIndex, 0, step);
        return step;
    }

    const currentIndex = pipeline.indexOf(step);
    if (currentIndex >= mixerIndex) {
        pipeline.splice(currentIndex, 1);
        mixerIndex = inputDelayFirstMixerIndex();
        pipeline.splice(mixerIndex, 0, step);
    }

    step.channels = inputDelayCaptureChannels();
    delete step.channel;
    step.names = [ESTACK_INPUT_DELAY_FILTER];
    step.description = ESTACK_INPUT_DELAY_STEP;
    step.bypassed = false;
    return step;
}

function inputDelayRemove() {
    const pipeline = inputDelayDSP.config.pipeline || [];
    for (const step of pipeline) {
        if (step?.type !== "Filter" || !Array.isArray(step.names)) continue;
        step.names = step.names.filter(name => name !== ESTACK_INPUT_DELAY_FILTER);
    }
    inputDelayDSP.config.pipeline = pipeline.filter(step =>
        !(step?.type === "Filter" && step?.description === ESTACK_INPUT_DELAY_STEP && (step.names || []).length === 0)
    );
    if (inputDelayDSP.config.filters) delete inputDelayDSP.config.filters[ESTACK_INPUT_DELAY_FILTER];
}

function inputDelayStatus(message, state = "info") {
    const el = document.getElementById("inputDelayStatus");
    if (!el) return;
    el.textContent = message;
    el.dataset.state = state;
}

function inputDelayRender(value = inputDelayValue) {
    const next = inputDelayClamp(value);
    const number = document.getElementById("inputDelayNumber");
    const range = document.getElementById("inputDelayRange");
    const readout = document.getElementById("inputDelayReadout");
    const state = document.getElementById("inputDelayState");

    if (number && document.activeElement !== number) number.value = next.toFixed(1);
    if (range) range.value = String(Math.min(500, next));
    if (readout) readout.textContent = `${next.toFixed(1)} ms`;
    if (state) {
        state.textContent = next > 0 ? "ACTIVE" : "BYPASS";
        state.classList.toggle("active", next > 0);
    }

    document.querySelectorAll(".input-delay-control").forEach(control => {
        control.disabled = inputDelayApplying;
    });
}

async function inputDelayCommit(value, reason = "Input delay") {
    if (!inputDelayDSP || inputDelayApplying) return false;
    const next = inputDelayClamp(value);
    inputDelayApplying = true;
    inputDelayRender(next);
    inputDelayStatus(`Applying ${next.toFixed(1)} ms…`, "busy");

    try {
        await inputDelayDSP.downloadConfig();
        const beforeConfig = inputDelayDSP.estackConfigSnapshot?.() || JSON.parse(JSON.stringify(inputDelayDSP.config));
        if (!inputDelayDSP.config.filters) inputDelayDSP.config.filters = {};

        if (next <= 0) {
            inputDelayRemove();
        } else {
            inputDelayDSP.config.filters[ESTACK_INPUT_DELAY_FILTER] = {
                type: "Delay",
                description: "E-Stack global L/R input delay",
                parameters: {
                    delay: next,
                    unit: "ms",
                    subsample: false
                }
            };
            inputDelayEnsureStep();
        }

        if (typeof inputDelayDSP.uploadConfigGuarded !== "function") throw new Error("E-Stack config guard is unavailable");
        await inputDelayDSP.uploadConfigGuarded(beforeConfig, {
            name: "Input Delay",
            allowedFilterNames: [ESTACK_INPUT_DELAY_FILTER],
            allowedStepDescriptions: [ESTACK_INPUT_DELAY_STEP]
        });
        await inputDelayDSP.downloadConfig();

        inputDelayValue = inputDelayRead();
        if (next > 0) {
            const filter = inputDelayDSP.config.filters?.[ESTACK_INPUT_DELAY_FILTER];
            const step = inputDelayStep();
            const mixerIndex = inputDelayFirstMixerIndex();
            if (!step || inputDelayDSP.config.pipeline.indexOf(step) >= mixerIndex) throw new Error("Input Delay is not before routing");
            if (filter?.type !== "Delay" || filter?.parameters?.unit !== "ms" || filter?.parameters?.subsample !== false) {
                throw new Error("Input Delay validation failed");
            }
        }

        inputDelayStatus(`${reason} · ${inputDelayValue.toFixed(1)} ms · guarded`, "ok");
        inputDelayRender();
        return true;
    } catch (error) {
        console.error("Input Delay update failed", error);
        inputDelayStatus(`ERROR: ${error?.message || error}`, "error");
        try {
            await inputDelayDSP.downloadConfig();
            inputDelayValue = inputDelayRead();
        } catch (_) {}
        inputDelayRender();
        return false;
    } finally {
        inputDelayApplying = false;
        inputDelayRender();
    }
}

function inputDelayWireControls() {
    const number = document.getElementById("inputDelayNumber");
    const range = document.getElementById("inputDelayRange");
    const reset = document.getElementById("inputDelayReset");

    number?.addEventListener("change", () => inputDelayCommit(number.value));
    number?.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            number.blur();
            inputDelayCommit(number.value);
        }
    });

    range?.addEventListener("input", () => inputDelayRender(Number(range.value)));
    range?.addEventListener("change", () => inputDelayCommit(range.value));
    reset?.addEventListener("click", () => inputDelayCommit(0, "Input delay reset"));

    document.querySelectorAll("[data-delay-step]").forEach(button => {
        button.addEventListener("click", () => {
            const step = Number(button.dataset.delayStep || 0);
            inputDelayCommit(inputDelayValue + step, `Input delay ${step > 0 ? "+" : ""}${step} ms`);
        });
    });
}

async function inputDelayRefresh() {
    if (!inputDelayDSP) return;
    await inputDelayDSP.downloadConfig();
    inputDelayValue = inputDelayRead();
    inputDelayRender();
}

async function inputDelayInit() {
    try {
        inputDelayDSP = await inputDelayWaitForDSP();
        await inputDelayDSP.downloadConfig();
        inputDelayValue = inputDelayRead();
        inputDelayWireControls();
        inputDelayRender();
        inputDelayStatus(`Ready · global L/R · ${inputDelayValue.toFixed(1)} ms`, "ok");
        window.estackInputDelay = {
            refresh: inputDelayRefresh,
            setDelay: inputDelayCommit,
            getDelay: () => inputDelayValue,
            filterName: ESTACK_INPUT_DELAY_FILTER,
            stepDescription: ESTACK_INPUT_DELAY_STEP
        };
    } catch (error) {
        console.error("Input Delay init failed", error);
        inputDelayStatus(`ERROR: ${error?.message || error}`, "error");
    }
}

document.addEventListener("DOMContentLoaded", inputDelayInit);

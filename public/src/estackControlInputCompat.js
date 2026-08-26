// Control-page compatibility once INPUT_TRIM_L/R are present before the mixer.
// getChannelFiltersList() intentionally aggregates all filter stages that touch a
// channel number, so channel 0/1 can contain both pre-mixer input trims and the
// post-mixer SUB/KICK chain. Output faders must therefore select the explicit
// loudspeaker-way Gain filter, never INPUT_TRIM_*.

const ESTACK_OUTPUT_GAIN_NAMES = {
    0: "sub_gain",
    1: "kick_gain",
    2: "mid_l_gain",
    3: "mid_r_gain",
    4: "high_l_gain",
    5: "high_r_gain"
};

if (typeof gainEntryForChannel === "function") {
    gainEntryForChannel = function(channel) {
        const expected = ESTACK_OUTPUT_GAIN_NAMES[Number(channel)];
        const expectedFilter = DSP?.config?.filters?.[expected];
        if (expectedFilter?.type === "Gain") return [expected, expectedFilter];

        // Fallback for renamed future configs: choose a Gain from the channel
        // pipeline, but explicitly exclude pre-mixer input trims.
        const names = DSP?.getChannelFiltersList?.(channel) || [];
        for (let i = names.length - 1; i >= 0; i--) {
            const name = names[i];
            if (/^INPUT_TRIM_/i.test(name)) continue;
            const filter = DSP?.config?.filters?.[name];
            if (filter?.type === "Gain") return [name, filter];
        }
        return null;
    };
}

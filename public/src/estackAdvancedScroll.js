// Advanced-page compatibility/scroll layer for E-Stack.
// Plain mouse-wheel remains vertical page scrolling. Hold Shift to scroll a
// long pipeline/filter row horizontally.

(function installAdvancedFixes() {
    function channelsForStep(step) {
        if (Array.isArray(step?.channels)) return step.channels.map(Number);
        if (step?.channel !== undefined && step?.channel !== null) return [Number(step.channel)];
        return [];
    }

    // CamillaDSP 4.x uses channels:[N]. The original Advanced page only looked
    // for the legacy channel:N form, which could leave the Filters section empty
    // or throw before the whole page had finished rendering.
    if (typeof loadFilters === "function") {
        loadFilters = function(element, config, channelCount) {
            element.replaceChildren();
            const DSP = window.parent.DSP;

            for (let channelNo = 0; channelNo < channelCount; channelNo++) {
                const filterChannel = document.createElement("div");
                filterChannel.className = "filterChannel";
                filterChannel.setAttribute("label", `Channel ${channelNo}`);

                let names = [];
                if (typeof DSP?.getChannelFiltersList === "function") {
                    names = DSP.getChannelFiltersList(channelNo) || [];
                } else {
                    for (const step of (config?.pipeline || [])) {
                        if (step?.type !== "Filter") continue;
                        if (!channelsForStep(step).includes(channelNo)) continue;
                        for (const name of (step.names || [])) {
                            if (!names.includes(name)) names.push(name);
                        }
                    }
                }

                for (const filterName of names) {
                    if (!config?.filters?.[filterName]) continue;
                    try {
                        filterChannel.appendChild(loadFilter(filterName));
                    } catch (error) {
                        console.warn(`Advanced: unable to render ${filterName}`, error);
                    }
                }
                element.appendChild(filterChannel);
            }
        };
    }

    document.addEventListener("wheel", event => {
        const row = event.target?.closest?.(".pipelineChannel, .filterChannel");
        if (!row) return;

        // Block the old anonymous wheel handlers before they can convert every
        // wheel movement into horizontal scrolling.
        event.stopImmediatePropagation();

        if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
            event.preventDefault();
            row.scrollLeft += event.shiftKey ? event.deltaY : event.deltaX;
        }
        // Otherwise do not preventDefault: the iframe/body scrolls vertically.
    }, { capture: true, passive: false });
})();

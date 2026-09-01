// Restore the compact MID/HIGH stereo gain-link controls on Control.
// The explanatory mixer status remains hidden; this file only renders the two
// useful LINKED/FREE toggles and reuses the existing E-Stack gain-link state.

function estackRenderLinkControls() {
    const root = document.getElementById("linkControls");
    if (!root || typeof EStackGainLinks === "undefined" || typeof gainLinks === "undefined") return;

    root.replaceChildren();

    for (const [key, link] of Object.entries(EStackGainLinks)) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "estack-link-button";
        button.classList.toggle("active", !!gainLinks[key]);
        button.setAttribute("aria-pressed", String(!!gainLinks[key]));
        button.innerHTML = `<span>${link.label}</span><strong>${gainLinks[key] ? "LINKED" : "FREE"}</strong>`;
        button.title = gainLinks[key]
            ? `${link.label} gains are linked. Click to unlink.`
            : `${link.label} gains are independent. Click to link.`;

        button.addEventListener("click", () => {
            gainLinks[key] = !gainLinks[key];
            if (typeof saveGainLink === "function") saveGainLink(key);
            estackRenderLinkControls();
        });

        root.appendChild(button);
    }
}

function estackInitRestoredLinkControls() {
    try {
        if (typeof loadGainLinks === "function") loadGainLinks();
        estackRenderLinkControls();
    } catch (error) {
        console.error("E-Stack link controls restore failed", error);
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(estackInitRestoredLinkControls, 80));
} else {
    setTimeout(estackInitRestoredLinkControls, 80);
}

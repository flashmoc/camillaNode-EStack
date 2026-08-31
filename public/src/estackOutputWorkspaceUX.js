// E-Stack Output Workspace interaction shortcuts.
// One-tap edit lock, per-tab edit-state persistence and keyboard way navigation.

(function installEStackOutputWorkspaceUX() {
    const EDIT_KEY = 'estack.output.workspace.editing';

    try {
        systemEditEnabled = window.sessionStorage.getItem(EDIT_KEY) === 'true';
    } catch (_) {}

    const edit = document.getElementById('systemEditToggle');
    if (edit) {
        // Capture phase deliberately intercepts the legacy confirmation handler.
        // The persistent amber EDITING state is the safety cue; normal use no
        // longer pays a confirmation-click penalty every time this page reloads.
        edit.addEventListener('click', event => {
            event.preventDefault();
            event.stopImmediatePropagation();
            systemEditEnabled = !systemEditEnabled;
            try { window.sessionStorage.setItem(EDIT_KEY, String(systemEditEnabled)); } catch (_) {}
            renderAll(false);
            setStatus(systemEditEnabled
                ? 'System editing enabled for this tab · crossover, alignment and protection are live.'
                : 'System editing locked.', systemEditEnabled ? 'ok' : 'info');
        }, true);
    }

    document.addEventListener('keydown', event => {
        const target = event.target;
        if (target && (target.matches?.('input, select, textarea, button') || target.isContentEditable)) return;
        if (event.altKey || event.ctrlKey || event.metaKey) return;

        const channels = typeof activeChannels === 'function' ? activeChannels() : [];
        if (!channels.length) return;

        // 1..6 select outputs directly while measuring.
        if (/^[1-6]$/.test(event.key)) {
            const channel = Number(event.key) - 1;
            if (channels.includes(channel)) {
                event.preventDefault();
                if (typeof estackV4SelectChannel === 'function') estackV4SelectChannel(channel);
            }
            return;
        }

        // [ and ] step through active ways without moving the mouse.
        if (event.key !== '[' && event.key !== ']') return;
        const index = Math.max(0, channels.indexOf(selectedChannel));
        const delta = event.key === ']' ? 1 : -1;
        const next = channels[(index + delta + channels.length) % channels.length];
        event.preventDefault();
        if (typeof estackV4SelectChannel === 'function') estackV4SelectChannel(next);
    });
})();

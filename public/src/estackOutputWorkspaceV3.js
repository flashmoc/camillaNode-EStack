// E-Stack Output Workspace V3 — merge protection into Output / Align.
// Loaded after V2. This is a presentation/DOM composition layer only: all DSP
// mutation handlers remain the ones created by the existing workspace modules.

(function installEStackOutputWorkspaceV3() {
    const baseRenderControls = renderControls;

    function mergeProtectionIntoAlignment() {
        const workspace = document.querySelector('#moduleControls .estack-ws-workspace-v2');
        if (!workspace) return;

        const alignment = workspace.querySelector('.estack-ws-alignment-v2');
        const protection = workspace.querySelector('.estack-ws-protection');
        if (!alignment || !protection || protection.dataset.merged === 'true') return;

        const alignmentTitle = alignment.querySelector(':scope > .estack-ws-section-head strong');
        if (alignmentTitle) alignmentTitle.textContent = 'OUTPUT / ALIGN / PROTECTION';
        alignment.classList.add('estack-ws-alignment-v3');

        const protectionBody = protection.querySelector('.estack-ws-protection-body');
        if (!protectionBody) {
            protection.remove();
            return;
        }

        protection.dataset.merged = 'true';
        protectionBody.classList.add('estack-ws-protection-inline');

        const zone = document.createElement('section');
        zone.className = 'estack-ws-inline-protection';

        const head = document.createElement('div');
        head.className = 'estack-ws-inline-protection-head';
        const title = document.createElement('strong');
        title.textContent = 'PROTECTION';
        const state = document.createElement('span');
        state.textContent = systemEditEnabled ? 'LIVE EDIT' : 'LOCKED';
        head.append(title, state);

        zone.append(head, protectionBody);
        alignment.appendChild(zone);
        protection.remove();
    }

    renderControls = function() {
        baseRenderControls();
        mergeProtectionIntoAlignment();
    };

    document.addEventListener('DOMContentLoaded', () => {
        requestAnimationFrame(mergeProtectionIntoAlignment);
    });
})();

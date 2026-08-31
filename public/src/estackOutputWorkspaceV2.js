// E-Stack Output Workspace V2 — visual/interaction refinement.
// Loaded after the measurement-first workspace. This layer keeps every existing
// DSP mutation path intact and only reorganises the established controls into a
// graph-first, low-click layout for desktop, laptop and phone use.

(function installEStackOutputWorkspaceV2() {
    const baseRenderControls = renderControls;
    const baseRenderHeader = renderHeader;

    function v2Element(tag, className, text) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (text !== undefined) el.textContent = text;
        return el;
    }

    function v2Head(title) {
        const head = v2Element('header', 'estack-ws-section-head estack-ws-v2-head');
        head.append(v2Element('strong', '', title));
        return head;
    }

    function ensureUnderGraphToolbar() {
        const workspace = document.querySelector('.venu-workspace');
        const graph = document.querySelector('.venu-graph-wrap');
        if (!workspace || !graph) return null;

        let shell = document.getElementById('estackWsUndergraph');
        if (!shell) {
            shell = v2Element('div', 'estack-ws-undergraph');
            shell.id = 'estackWsUndergraph';

            const modes = v2Element('div', 'estack-ws-undergraph-modes');
            modes.id = 'estackWsModeMount';

            const tools = v2Element('div', 'estack-ws-undergraph-tools');
            const legend = v2Element('div', 'estack-ws-legend-mount');
            legend.id = 'estackWsLegendMount';
            const analyzer = v2Element('div', 'estack-ws-analyzer-mount');
            analyzer.id = 'estackWsAnalyzerMount';
            const edit = v2Element('div', 'estack-ws-edit-mount');
            edit.id = 'estackWsEditMount';
            tools.append(legend, analyzer, edit);
            shell.append(modes, tools);

            graph.insertAdjacentElement('afterend', shell);
        }

        const modeMount = document.getElementById('estackWsModeMount');
        const legendMount = document.getElementById('estackWsLegendMount');
        const editMount = document.getElementById('estackWsEditMount');
        const analyzerMount = document.getElementById('estackWsAnalyzerMount');

        const modebar = document.getElementById('estackGraphModebar');
        if (modebar && modeMount && modebar.parentElement !== modeMount) modeMount.appendChild(modebar);

        const legend = document.querySelector('.venu-graph-legend');
        if (legend && legendMount && legend.parentElement !== legendMount) legendMount.appendChild(legend);

        const edit = document.getElementById('systemEditToggle');
        if (edit && editMount && edit.parentElement !== editMount) editMount.appendChild(edit);

        // XO metrics belong to the graph controls, but should never sit above the
        // graph. Keep them immediately below the new under-graph command bar.
        const xoReadout = document.getElementById('estackXoReadout');
        if (xoReadout && shell.nextElementSibling !== xoReadout) shell.insertAdjacentElement('afterend', xoReadout);

        return { shell, analyzerMount };
    }

    function removeRepeatedStateMeta(card) {
        card?.querySelectorAll(':scope > .estack-ws-section-head > span').forEach(el => el.remove());
    }

    function transformCrossoverPane(pane) {
        if (!pane) return;
        pane.classList.remove('estack-ws-compact-card');
        pane.classList.add('estack-ws-xo-pane');
        removeRepeatedStateMeta(pane);

        const title = pane.querySelector(':scope > .estack-ws-section-head strong');
        if (title) title.textContent = pane.classList.contains('estack-ws-hpf') ? 'HIGH PASS' : 'LOW PASS';
    }

    function alignmentKey(node) {
        if (node.classList?.contains('estack-ws-field')) {
            const label = node.querySelector('.estack-ws-field-label')?.textContent?.trim().toUpperCase() || '';
            if (label === 'GAIN') return 0;
            if (label === 'DELAY') return 1;
            if (label.startsWith('PHASE')) return 2;
        }
        if (node.classList?.contains('estack-ws-state-button')) {
            const label = node.querySelector('span')?.textContent?.trim().toUpperCase() || '';
            if (label === 'POLARITY') return 3;
            if (label === 'OUTPUT') return 4;
        }
        return 99;
    }

    function transformAlignment(card) {
        if (!card) return;
        card.classList.remove('estack-ws-compact-card');
        card.classList.add('estack-ws-card', 'estack-ws-alignment-v2');
        removeRepeatedStateMeta(card);

        const title = card.querySelector(':scope > .estack-ws-section-head strong');
        if (title) title.textContent = 'OUTPUT / ALIGN';

        const controls = card.querySelector('.estack-ws-align-controls');
        if (!controls) return;
        const items = [...controls.children].sort((a, b) => alignmentKey(a) - alignmentKey(b));
        for (const item of items) {
            item.classList.add('estack-ws-align-item');
            controls.appendChild(item);
        }
    }

    function transformEssentials(workspace) {
        const essentials = workspace.querySelector('.estack-ws-essentials');
        if (!essentials) return;

        const hpf = essentials.querySelector('.estack-ws-hpf');
        const lpf = essentials.querySelector('.estack-ws-lpf');
        const alignment = essentials.querySelector('.estack-ws-alignment');
        if (!hpf && !lpf && !alignment) return;

        transformCrossoverPane(hpf);
        transformCrossoverPane(lpf);
        transformAlignment(alignment);

        const tuning = v2Element('div', 'estack-ws-tuning');

        if (hpf || lpf) {
            const crossover = v2Element('section', 'estack-ws-card estack-ws-crossover-v2');
            crossover.append(v2Head('CROSSOVER'));
            const panes = v2Element('div', 'estack-ws-crossover-panes');
            if (hpf) panes.appendChild(hpf);
            if (lpf) panes.appendChild(lpf);
            crossover.appendChild(panes);
            tuning.appendChild(crossover);
        }

        if (alignment) tuning.appendChild(alignment);
        essentials.replaceWith(tuning);
    }

    function metric(label, value) {
        const item = v2Element('span', 'estack-ws-protection-metric');
        item.append(v2Element('small', '', label), v2Element('strong', '', value));
        return item;
    }

    function transformProtection(workspace) {
        const card = workspace.querySelector('.estack-ws-protection');
        const body = card?.querySelector('.estack-ws-protection-body');
        if (!card || !body) return;
        removeRepeatedStateMeta(card);
        body.classList.add('estack-ws-protection-grid');

        const limitField = body.querySelector('.estack-ws-limit-field');
        if (limitField && !limitField.closest('.estack-ws-protection-module')) {
            const module = v2Element('article', 'estack-ws-protection-module estack-ws-limit-module');
            const head = v2Element('div', 'estack-ws-protection-module-head');
            head.append(v2Element('strong', '', 'HARD LIMITER'), v2Element('span', '', 'CEILING'));
            const label = limitField.querySelector('.estack-ws-field-label');
            if (label) label.textContent = 'THRESHOLD';
            limitField.insertAdjacentElement('beforebegin', module);
            module.append(head, limitField);
        }

        body.querySelectorAll('.estack-ws-processor-summary').forEach(summary => {
            if (summary.classList.contains('estack-ws-processor-v2')) return;
            summary.classList.add('estack-ws-protection-module', 'estack-ws-processor-v2');
            const title = summary.querySelector('strong');
            const detail = summary.querySelector('span');
            const details = (detail?.textContent || '').split(' · ').map(part => part.trim()).filter(Boolean);
            const metrics = v2Element('div', 'estack-ws-protection-metrics');

            for (const part of details) {
                let label = 'VALUE';
                let value = part;
                if (part.startsWith('THR ')) { label = 'THRESH'; value = part.slice(4); }
                else if (part.startsWith('A ')) { label = 'ATTACK'; value = part.slice(2); }
                else if (part.startsWith('R ')) { label = 'RELEASE'; value = part.slice(2); }
                else if (part.startsWith('RATIO ')) { label = 'RATIO'; value = part.slice(6); }
                metrics.appendChild(metric(label, value));
            }

            const head = v2Element('div', 'estack-ws-protection-module-head');
            head.append(v2Element('strong', '', title?.textContent || 'PROCESSOR'), v2Element('span', '', 'ACTIVE'));
            summary.replaceChildren(head, metrics);
        });
    }

    function transformWorkspace() {
        const root = document.getElementById('moduleControls');
        const workspace = root?.querySelector('.estack-ws-workspace');
        if (!workspace) return;

        const toolbar = ensureUnderGraphToolbar();
        const analyzer = workspace.querySelector('.estack-ws-analyzerbar');
        if (analyzer && toolbar?.analyzerMount) toolbar.analyzerMount.replaceChildren(analyzer);

        transformEssentials(workspace);
        transformProtection(workspace);
        workspace.classList.add('estack-ws-workspace-v2');
    }

    // The old stepper duplicated the visible channel selector. Keep one clear
    // selector only: the coloured output buttons directly under the graph.
    renderModuleTabs = function() {
        activeModule = 'peq';
        const root = document.getElementById('moduleTabs');
        if (root) root.replaceChildren();
    };

    renderHeader = function() {
        baseRenderHeader();
        ensureUnderGraphToolbar();
    };

    renderControls = function() {
        baseRenderControls();
        transformWorkspace();
    };

    document.addEventListener('DOMContentLoaded', () => {
        requestAnimationFrame(() => {
            ensureUnderGraphToolbar();
            transformWorkspace();
        });
    });
})();

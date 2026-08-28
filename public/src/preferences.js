class preferences {
    constructor() {
        this.preferenceObject = this.loadSettings();
    }

    getDefaults() {
        return {
            sections: {
                general: 'E-Stack Preferences',
                ui: 'User Interface',
                basic: 'Control',
                equalizer: 'Output Processing'
            },
            general: [
                {
                    id: 'enableSpectrum',
                    name: 'Enable spectrum analyzers',
                    value: true,
                    type: 'boolean',
                    enabled: true
                },
                {
                    id: 'loadLastOnStartup',
                    name: 'Load last configuration on startup',
                    value: true,
                    type: 'boolean',
                    enabled: true
                }
            ],
            ui: [
                {
                    id: 'defaultPage',
                    name: 'Default page',
                    value: 'basic',
                    type: 'select',
                    options: { Control: 'basic' },
                    enabled: false
                },
                {
                    id: 'backgroundHue',
                    name: 'Background hue',
                    value: 180,
                    type: 'range',
                    options: { min: 0, max: 330, step: 1 },
                    enabled: true,
                    callback: 'backgroundHueChange'
                }
            ],
            basic: [
                {
                    id: 'showBasicSpectrum',
                    name: 'Show spectrum analyzer in Control',
                    value: false,
                    type: 'boolean',
                    dependsOn: 'enableSpectrum',
                    enabled: true
                }
            ],
            equalizer: [
                {
                    id: 'showEqualizerSpectrum',
                    name: 'Show spectrum analyzer in Output Processing',
                    value: true,
                    type: 'boolean',
                    dependsOn: 'enableSpectrum',
                    enabled: true
                }
            ]
        };
    }

    migrateStored(stored) {
        const next = this.getDefaults();
        if (!stored || typeof stored !== 'object') return next;

        for (const section of Object.keys(next.sections)) {
            const previous = Array.isArray(stored[section]) ? stored[section] : [];
            for (const item of next[section]) {
                const old = previous.find(candidate => candidate?.id === item.id);
                if (old && old.value !== undefined) item.value = old.value;
            }
        }

        // E-Stack always starts on Control. Old CamillaNode preferences may
        // still contain Equalizer/Room/Preferences as the default page.
        const defaultPage = next.ui.find(item => item.id === 'defaultPage');
        defaultPage.value = 'basic';
        return next;
    }

    loadSettings() {
        let stored = null;
        try {
            const raw = window.localStorage.getItem('preferences');
            if (raw) stored = JSON.parse(raw);
        } catch (_) {}

        this.preferenceObject = this.migrateStored(stored);
        this.saveSettings();
        return this.preferenceObject;
    }

    saveSettings() {
        window.localStorage.setItem('preferences', JSON.stringify(this.preferenceObject));
        return true;
    }

    createPreferencesElements(parentElement) {
        parentElement.replaceChildren();
        const controls = new Map();

        for (const section of Object.keys(this.preferenceObject.sections)) {
            const sectionElement = document.createElement('div');
            sectionElement.id = section;
            sectionElement.setAttribute('label', this.preferenceObject.sections[section]);
            sectionElement.className = 'preferenceSection';

            for (const item of this.preferenceObject[section]) {
                const line = document.createElement('div');
                line.className = 'preferenceItem';

                const name = document.createElement('div');
                name.className = 'preferenceName';
                name.textContent = item.name;

                let control;
                if (item.type === 'boolean') {
                    control = document.createElement('input');
                    control.type = 'checkbox';
                    control.checked = Boolean(item.value);
                } else if (item.type === 'select') {
                    control = document.createElement('select');
                    for (const [label, value] of Object.entries(item.options || {})) {
                        const option = document.createElement('option');
                        option.textContent = label;
                        option.value = value;
                        control.appendChild(option);
                    }
                    control.value = String(item.value);
                } else if (item.type === 'range') {
                    control = document.createElement('input');
                    control.type = 'range';
                    control.min = item.options.min;
                    control.max = item.options.max;
                    control.step = item.options.step;
                    control.value = item.value;
                } else {
                    control = document.createElement('input');
                    control.type = 'text';
                    control.value = item.value ?? '';
                }

                control.id = item.id;
                control.disabled = !item.enabled;
                control.addEventListener('change', () => {
                    const value = control.type === 'checkbox' ? control.checked : control.value;
                    this.applySetting(section, item.id, value);
                    this.saveSettings();
                    window.parent.activeSettings = this.getPreferences();
                    if (item.callback && typeof window[item.callback] === 'function') {
                        window[item.callback].call(control);
                    }
                    this.applyDependencies(controls);
                });

                controls.set(item.id, { control, item });
                line.append(name, control);
                sectionElement.appendChild(line);
            }
            parentElement.appendChild(sectionElement);
        }

        this.applyDependencies(controls);
        return true;
    }

    applyDependencies(controls) {
        for (const { control, item } of controls.values()) {
            if (!item.dependsOn) continue;
            const source = controls.get(item.dependsOn)?.control || document.getElementById(item.dependsOn);
            const allowed = source ? Boolean(source.checked) : true;
            control.disabled = !item.enabled || !allowed;
            if (!allowed && control.type === 'checkbox') control.checked = false;
        }
    }

    applySetting(section, setting, value) {
        const item = this.preferenceObject?.[section]?.find(candidate => candidate.id === setting);
        if (item) item.value = value;
    }

    getSettingValue(section, setting) {
        const item = this.preferenceObject?.[section]?.find(candidate => candidate.id === setting);
        if (item) return item.value;
        const fallback = this.getDefaults()?.[section]?.find(candidate => candidate.id === setting);
        return fallback?.value;
    }

    reset() {
        this.preferenceObject = this.getDefaults();
        this.saveSettings();
        return true;
    }

    applyBackgroundHue(doc, hue) {
        if (!doc) return;
        const value = Number.parseInt(hue, 10);
        doc.documentElement.style.setProperty('--bck-hue', value);
        doc.documentElement.style.setProperty('--hue-rotate', `${value - 230}deg`);
    }

    getPreferences() {
        const result = {};
        for (const section of Object.keys(this.preferenceObject.sections || {})) {
            for (const item of this.preferenceObject[section] || []) result[item.id] = item.value;
        }
        return result;
    }
}

export default preferences;

// E-Stack guarded configuration writes.
//
// CamillaNode edits the live CamillaDSP configuration over SetConfigJson.  A UI
// module should never be able to damage unrelated routing, crossovers or speaker
// protection as a side effect of changing one input-side feature.  This layer
// adds strict reference validation plus an opt-in guarded upload used by E-Stack
// modules with a narrow write scope.

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") {
        const result = {};
        for (const key of Object.keys(value).sort()) result[key] = stable(value[key]);
        return result;
    }
    return value;
}

function same(a, b) {
    return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

function allowedFilter(name, policy) {
    const exact = new Set(policy?.allowedFilterNames || []);
    if (exact.has(name)) return true;
    return (policy?.allowedFilterPrefixes || []).some(prefix => String(name).startsWith(prefix));
}

function protectedProjection(config, policy = {}) {
    const copy = clone(config || {});
    const allowedDescriptions = new Set(policy.allowedStepDescriptions || []);

    copy.filters = copy.filters || {};
    for (const name of Object.keys(copy.filters)) {
        if (allowedFilter(name, policy)) delete copy.filters[name];
    }

    copy.pipeline = (copy.pipeline || []).map(step => {
        if (step?.type !== "Filter") return step;
        if (allowedDescriptions.has(step?.description)) return null;

        const next = clone(step);
        if (Array.isArray(next.names)) {
            next.names = next.names.filter(name => !allowedFilter(name, policy));
        }
        return next;
    }).filter(Boolean);

    // UI labels/titles are not signal-path safety properties.
    delete copy.title;
    delete copy.description;

    return copy;
}

function validateReferences(config) {
    const errors = [];
    if (!config || typeof config !== "object") return ["configuration is missing"];
    if (!config.devices?.capture) errors.push("capture device is missing");
    if (!config.devices?.playback) errors.push("playback device is missing");

    const mixers = config.mixers || {};
    const filters = config.filters || {};
    const processors = config.processors || {};

    for (const [index, step] of (config.pipeline || []).entries()) {
        if (step?.type === "Mixer" && !mixers[step.name]) {
            errors.push(`pipeline ${index}: mixer '${step.name}' is missing`);
        }
        if (step?.type === "Processor" && !processors[step.name]) {
            errors.push(`pipeline ${index}: processor '${step.name}' is missing`);
        }
        if (step?.type === "Filter") {
            for (const name of (step.names || [])) {
                if (!filters[name]) errors.push(`pipeline ${index}: filter '${name}' is missing`);
            }
        }
    }
    return errors;
}

export default function installEStackConfigGuard(camillaDSP) {
    if (!camillaDSP || camillaDSP.__estackConfigGuardInstalled) return camillaDSP;
    camillaDSP.__estackConfigGuardInstalled = true;

    const p = camillaDSP.prototype;
    const legacyValidate = p.validateConfig;

    p.estackConfigSnapshot = function() {
        return clone(this.config);
    };

    p.estackValidateConfig = function(config = this.config) {
        const errors = validateReferences(config);
        return { ok: errors.length === 0, errors };
    };

    // Strengthen every CamillaNode upload, including legacy pages: Processor
    // references are now validated as well as Mixer/Filter references.
    p.validateConfig = function() {
        if (typeof legacyValidate === "function" && !legacyValidate.call(this)) return false;
        const result = this.estackValidateConfig(this.config);
        if (!result.ok) {
            console.error("E-Stack configuration validation failed:", result.errors);
            return false;
        }
        return true;
    };

    p.uploadConfigGuarded = async function(beforeConfig, policy = {}) {
        if (!beforeConfig) throw new Error("Guarded upload requires a pre-edit snapshot");

        const validation = this.estackValidateConfig(this.config);
        if (!validation.ok) {
            this.config = clone(beforeConfig);
            throw new Error(`Invalid DSP graph: ${validation.errors.join("; ")}`);
        }

        const beforeProtected = protectedProjection(beforeConfig, policy);
        const afterProtected = protectedProjection(this.config, policy);
        if (!same(beforeProtected, afterProtected)) {
            this.config = clone(beforeConfig);
            const scope = policy?.name ? ` (${policy.name})` : "";
            console.error("E-Stack guarded upload blocked an out-of-scope change", {
                scope: policy?.name,
                before: beforeProtected,
                after: afterProtected
            });
            throw new Error(`Protected DSP settings changed outside the allowed scope${scope}`);
        }

        const ok = await this.uploadConfig();
        if (!ok) {
            this.config = clone(beforeConfig);
            throw new Error("CamillaDSP rejected the guarded configuration");
        }
        return true;
    };

    return camillaDSP;
}

// Measurement Batch owns calibration mode: Loudness must remain flat until the
// captured normal-listening baseline is restored on FINISH / ABORT.
(function installLoudnessMeasurementLock() {
    const baseApply = window.loudnessApplyPreset;
    if (typeof baseApply !== 'function') return;

    async function measurementActive() {
        try {
            const response = await fetch('/api/measurement-batch/status', { cache: 'no-store' });
            if (!response.ok) return false;
            const state = await response.json();
            return state?.active === true;
        } catch (_) {
            return false;
        }
    }

    window.loudnessApplyPreset = async function loudnessApplyPresetWithMeasurementLock(key) {
        const disabledPreset = key === 'reference' || key === 'maxspl';
        if (!disabledPreset && await measurementActive()) {
            if (typeof window.loudnessStatus === 'function') {
                window.loudnessStatus('MEASUREMENT ACTIVE · Loudness is locked OFF until FINISH / ABORT', 'error');
            }
            return;
        }
        return baseApply(key);
    };
})();

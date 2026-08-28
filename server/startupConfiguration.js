'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

const SYSTEM_TYPE = 'estack-system';
const DEFAULT_STATE = {
    version: 1,
    mode: 'yaml',
    configId: null,
    configName: null,
    lastUsedId: null,
    lastUsedName: null,
    lastBootIdApplied: null,
    lastBootAppliedId: null,
    lastBootAppliedName: null,
    lastBootAppliedAt: null,
    lastBootStatus: 'never'
};

module.exports = function registerStartupConfiguration(app, options = {}) {
    const WebSocket = options.WebSocket;
    const host = options.host || '127.0.0.1';
    const port = Number(options.port || 1234);
    const root = options.root || path.resolve(__dirname, '..');
    const stateFile = options.stateFile || path.join(root, 'startupConfig.json');
    const savedConfigsFile = options.savedConfigsFile || path.join(root, 'savedConfigs.dat');
    const demo = options.demo === true;
    const jsonParser = express.json({ limit: '64kb' });

    if (!WebSocket) throw new Error('startupConfiguration requires a WebSocket implementation');

    function clone(value) {
        return value == null ? value : JSON.parse(JSON.stringify(value));
    }

    function readState() {
        if (!fs.existsSync(stateFile)) return { ...DEFAULT_STATE };
        try {
            const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
            return { ...DEFAULT_STATE, ...parsed };
        } catch (error) {
            console.error('Invalid startupConfig.json; using hardware YAML startup:', error.message);
            return { ...DEFAULT_STATE };
        }
    }

    function writeState(next) {
        const state = { ...DEFAULT_STATE, ...next, version: 1 };
        const tmp = `${stateFile}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
        fs.renameSync(tmp, stateFile);
        return state;
    }

    function readSavedConfigs() {
        if (!fs.existsSync(savedConfigsFile)) return [];
        try {
            const parsed = JSON.parse(fs.readFileSync(savedConfigsFile, 'utf8'));
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            throw new Error(`Saved configuration database is invalid: ${error.message}`);
        }
    }

    function findSystemConfig(id, name) {
        const configs = readSavedConfigs().filter(item => item?.type === SYSTEM_TYPE);
        let found = null;
        if (id !== undefined && id !== null && String(id).length) {
            found = configs.find(item => String(item.id) === String(id)) || null;
        }
        if (!found && name) found = configs.find(item => item.name === name) || null;
        return found;
    }

    function resolveConfiguredRecord(state) {
        if (state.mode === 'yaml') return null;
        if (state.mode === 'specific') {
            const record = findSystemConfig(state.configId, state.configName);
            if (!record) throw new Error(`Startup configuration '${state.configName || state.configId || 'unknown'}' no longer exists`);
            return record;
        }
        if (state.mode === 'last') {
            const record = findSystemConfig(state.lastUsedId, state.lastUsedName);
            if (!record) throw new Error('No valid last-used system configuration is available');
            return record;
        }
        throw new Error(`Unsupported startup mode '${state.mode}'`);
    }

    function currentBootId() {
        try {
            return fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
        } catch (_) {
            return null;
        }
    }

    function openDsp(timeoutMs = 2500) {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(`ws://${host}:${port}`);
            const timer = setTimeout(() => {
                try { ws.terminate?.(); } catch (_) {}
                reject(new Error('CamillaDSP connection timeout'));
            }, timeoutMs);

            ws.once('open', () => {
                clearTimeout(timer);
                resolve(ws);
            });
            ws.once('error', error => {
                clearTimeout(timer);
                reject(new Error(`CamillaDSP unavailable: ${error.message}`));
            });
        });
    }

    function dspRequest(ws, message, timeoutMs = 3500) {
        const command = typeof message === 'string' ? message : Object.keys(message || {})[0];
        if (!command) return Promise.reject(new Error('Invalid CamillaDSP command'));

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                ws.off('message', onMessage);
                reject(new Error(`${command} timed out`));
            }, timeoutMs);

            function onMessage(data) {
                let response;
                try { response = JSON.parse(String(data)); }
                catch (_) { return; }
                if (!Object.prototype.hasOwnProperty.call(response, command)) return;

                clearTimeout(timer);
                ws.off('message', onMessage);
                const payload = response[command] || {};
                if (payload.result !== 'Ok') {
                    reject(new Error(`${command} failed: ${payload.value || payload.result || 'unknown error'}`));
                    return;
                }

                let value = payload.value;
                if (command === 'GetConfigJson') {
                    try { value = JSON.parse(value); }
                    catch (_) {
                        reject(new Error('CamillaDSP returned invalid configuration JSON'));
                        return;
                    }
                }
                resolve(value);
            }

            ws.on('message', onMessage);
            try { ws.send(JSON.stringify(message)); }
            catch (error) {
                clearTimeout(timer);
                ws.off('message', onMessage);
                reject(error);
            }
        });
    }

    function validateProcessingSnapshot(processing, liveMixers) {
        if (!processing || typeof processing !== 'object') throw new Error('Saved processing snapshot is missing');
        if (!processing.filters || typeof processing.filters !== 'object') throw new Error('Saved filters are missing');
        if (!Array.isArray(processing.pipeline)) throw new Error('Saved pipeline is missing');

        const filters = processing.filters;
        const processors = processing.processors || {};
        const mixerNames = new Set(Object.keys(liveMixers || {}));

        for (const step of processing.pipeline) {
            if (step?.type === 'Mixer' && !mixerNames.has(step.name)) {
                throw new Error(`Saved configuration expects unavailable mixer '${step.name}'`);
            }
            if (step?.type === 'Filter') {
                for (const name of (step.names || [])) {
                    if (!filters[name]) throw new Error(`Saved pipeline references missing filter '${name}'`);
                }
            }
            if (step?.type === 'Processor') {
                for (const name of (step.names || [])) {
                    if (!processors[name]) throw new Error(`Saved pipeline references missing processor '${name}'`);
                }
            }
        }
    }

    async function applyRecord(record) {
        if (!record?.data?.processing) throw new Error('Selected startup item is not a full E-Stack system configuration');
        const ws = await openDsp();
        try {
            const live = await dspRequest(ws, 'GetConfigJson');
            validateProcessingSnapshot(record.data.processing, live?.mixers);

            const next = clone(live || {});
            next.filters = clone(record.data.processing.filters || {});
            next.pipeline = clone(record.data.processing.pipeline || []);
            next.processors = clone(record.data.processing.processors || {});
            next.title = record.name || record.data.processing.title || next.title || '';

            // Deliberately preserve the live hardware layer: devices, chunksize,
            // ALSA configuration and mixer routing stay exactly as CamillaDSP
            // loaded them from the Raspberry hardware YAML.
            await dspRequest(ws, { SetConfigJson: JSON.stringify(next) });
        } finally {
            try { ws.close(); } catch (_) {}
        }
    }

    function publicState() {
        const state = readState();
        let resolvedName = null;
        let resolutionError = null;
        try {
            resolvedName = resolveConfiguredRecord(state)?.name || null;
        } catch (error) {
            resolutionError = error.message;
        }
        return {
            mode: state.mode,
            configId: state.configId,
            configName: state.configName,
            lastUsedId: state.lastUsedId,
            lastUsedName: state.lastUsedName,
            resolvedName,
            resolutionError,
            lastBootAppliedName: state.lastBootAppliedName,
            lastBootAppliedAt: state.lastBootAppliedAt,
            lastBootStatus: state.lastBootStatus
        };
    }

    app.get('/api/startup-config', (_req, res) => {
        try { res.json(publicState()); }
        catch (error) { res.status(500).json({ status: 'error', reason: error.message }); }
    });

    app.post('/api/startup-config', jsonParser, (req, res) => {
        try {
            const mode = String(req.body?.mode || '').trim();
            if (!['yaml', 'specific', 'last'].includes(mode)) throw new Error('Invalid startup mode');

            const current = readState();
            const next = { ...current, mode };
            if (mode === 'specific') {
                const record = findSystemConfig(req.body?.configId, req.body?.configName);
                if (!record) throw new Error('Select an existing system configuration first');
                next.configId = record.id;
                next.configName = record.name;
            } else {
                next.configId = null;
                next.configName = null;
            }

            if (mode === 'last' && !findSystemConfig(current.lastUsedId, current.lastUsedName)) {
                throw new Error('No last-used system configuration is available yet');
            }

            writeState(next);
            res.json({ status: 'ok', ...publicState() });
        } catch (error) {
            res.status(400).json({ status: 'error', reason: error.message });
        }
    });

    app.post('/api/startup-config/last-used', jsonParser, (req, res) => {
        try {
            const record = findSystemConfig(req.body?.configId, req.body?.configName);
            if (!record) throw new Error('Applied system configuration no longer exists');
            const current = readState();
            writeState({
                ...current,
                lastUsedId: record.id,
                lastUsedName: record.name
            });
            res.json({ status: 'ok', ...publicState() });
        } catch (error) {
            res.status(400).json({ status: 'error', reason: error.message });
        }
    });

    async function runBootApply(bootId, attempt = 1) {
        const state = readState();
        if (!bootId || state.lastBootIdApplied === bootId) return;

        if (state.mode === 'yaml') {
            writeState({
                ...state,
                lastBootIdApplied: bootId,
                lastBootAppliedId: null,
                lastBootAppliedName: 'Hardware YAML',
                lastBootAppliedAt: new Date().toISOString(),
                lastBootStatus: 'yaml'
            });
            console.log('Startup configuration: using CamillaDSP hardware YAML.');
            return;
        }

        let record;
        try {
            record = resolveConfiguredRecord(state);
        } catch (error) {
            writeState({
                ...state,
                lastBootIdApplied: bootId,
                lastBootAppliedId: null,
                lastBootAppliedName: null,
                lastBootAppliedAt: new Date().toISOString(),
                lastBootStatus: `error: ${error.message}`
            });
            console.error(`Startup configuration skipped: ${error.message}`);
            return;
        }

        try {
            await applyRecord(record);
            const latest = readState();
            writeState({
                ...latest,
                lastBootIdApplied: bootId,
                lastBootAppliedId: record.id,
                lastBootAppliedName: record.name,
                lastBootAppliedAt: new Date().toISOString(),
                lastBootStatus: 'applied'
            });
            console.log(`Startup configuration applied: ${record.name}`);
        } catch (error) {
            if (attempt < 20) {
                setTimeout(() => runBootApply(bootId, attempt + 1), 1500);
                return;
            }
            const latest = readState();
            writeState({
                ...latest,
                lastBootIdApplied: bootId,
                lastBootAppliedId: null,
                lastBootAppliedName: record.name,
                lastBootAppliedAt: new Date().toISOString(),
                lastBootStatus: `error: ${error.message}`
            });
            console.error(`Startup configuration '${record.name}' could not be applied: ${error.message}`);
        }
    }

    function scheduleBootApply() {
        if (demo) return;
        const bootId = currentBootId();
        if (!bootId) {
            console.warn('Startup configuration: Linux boot id unavailable; automatic boot recall disabled.');
            return;
        }
        if (readState().lastBootIdApplied === bootId) return;
        setTimeout(() => runBootApply(bootId), 1500);
    }

    return {
        scheduleBootApply,
        getState: publicState,
        applyRecord
    };
};

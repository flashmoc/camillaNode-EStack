(() => {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const identifier = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  async function loadAll() {
    const records = await window.EStackDSPBridge.api('/getConfigFile');
    if (!Array.isArray(records)) throw new Error('CamillaNode returned an invalid saved configuration collection.');
    return clone(records);
  }
  async function writeAll(records) {
    if (!Array.isArray(records)) throw new Error('Saved configuration collection must be an array.');
    await window.EStackDSPBridge.api('/saveConfigFile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(records) });
  }
  async function listByType(type) { return (await loadAll()).filter(record => record?.type === type).sort((left, right) => String(left?.name || '').localeCompare(String(right?.name || ''))); }
  async function getById(id) { return (await loadAll()).find(record => String(record?.id) === String(id)) || null; }
  async function save(record, overwrite = false) {
    if (!record?.type || !String(record.name || '').trim()) throw new Error('Saved configuration needs a type and name.');
    const all = await loadAll(); const index = all.findIndex(item => item?.type === record.type && item?.name === record.name);
    const next = clone(record);
    if (index >= 0) {
      if (!overwrite) { const error = new Error(`A ${record.type} preset named '${record.name}' already exists.`); error.code = 'exists'; throw error; }
      next.id = all[index].id; all.splice(index, 1, next);
    } else { next.id = next.id || identifier(); all.push(next); }
    await writeAll(all); return clone(next);
  }
  async function remove(id) {
    const all = await loadAll(); const index = all.findIndex(record => String(record?.id) === String(id));
    if (index < 0) return false;
    all.splice(index, 1); await writeAll(all); return true;
  }
  window.EStackSavedConfigClient = Object.freeze({ loadAll, listByType, getById, save, delete: remove });
})();

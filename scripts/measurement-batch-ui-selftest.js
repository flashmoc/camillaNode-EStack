'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/html/measurement-batch.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/css/estackMeasurementBatchV2.css'), 'utf8');
const editor = fs.readFileSync(path.join(root, 'public/src/estackMeasurementBatchEditor.js'), 'utf8');
const inputUi = fs.readFileSync(path.join(root, 'public/src/estackMeasurementBatchInput.js'), 'utf8');

assert.ok(html.includes('/css/estackMeasurementBatchV2.css'), 'compact Measurement Batch stylesheet is not loaded');
assert.ok(html.includes('/src/estackMeasurementBatchEditor.js'), 'Measurement Batch editor is not loaded');
assert.ok(html.includes('/src/estackMeasurementBatchInput.js'), 'Measurement Batch input UI is not loaded');
assert.ok(html.includes('id="editBatch"'), 'EDIT button is missing');
assert.ok(html.includes('id="exportBatch"'), 'EXPORT button is missing');
assert.ok(html.includes('id="batchEditorDialog"'), 'Batch Editor dialog is missing');
assert.ok(html.includes('id="editorWayTable"'), 'structured way override editor is missing');
assert.ok(html.includes('id="editorXoTable"'), 'structured crossover editor is missing');

assert.ok(css.includes('body.estack-measurement-batch main.measure-page'), 'page does not override legacy global main layout');
assert.ok(css.includes('body.estack-measurement-batch section'), 'page does not override legacy global section height/scroll rules');
assert.ok(css.includes('grid-template-columns: 300px minmax(0, 1fr)'), 'desktop workspace is not compact sequence/current layout');
assert.ok(css.includes('.measure-input-quick'), 'prominent measurement input selector is not styled');
assert.ok(!css.includes('.measure-workspace {\n    display: grid;\n    grid-template-columns: minmax(0, 1.7fr) minmax(280px, .8fr);\n    gap: 7px;\n    min-height: 520px;'), 'legacy oversized workspace rule leaked into V2 override');

assert.ok(editor.includes("'/api/measurement-batch/import'"), 'editor does not save through authoritative import/validation endpoint');
assert.ok(editor.includes('phaseDegrees'), 'editor does not expose phase degrees');
assert.ok(editor.includes('phaseReferenceHz'), 'editor does not expose fixed phase reference');
assert.ok(editor.includes('hpfFreq') && editor.includes('lpfFreq'), 'editor does not expose crossover frequencies');
assert.ok(editor.includes('editorDuplicateStep') && editor.includes('editorMove'), 'editor step manipulation is incomplete');

assert.ok(inputUi.includes('measurementInputQuick'), 'main-page measurement input selector is missing');
assert.ok(inputUi.includes('BASELINE') && inputUi.includes('IN${input}'), 'measurement input selector options are incomplete');
assert.ok(inputUi.includes("postJson('/api/measurement-batch/import'"), 'quick input selector does not save through authoritative batch validation');
assert.ok(inputUi.includes('SOURCE · BASELINE ROUTING') && inputUi.includes('SOURCE · IN${input}'), 'runtime measurement source badge is incomplete');

console.log('OK:   compact editable Measurement Batch UI');

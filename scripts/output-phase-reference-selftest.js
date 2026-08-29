'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.resolve(__dirname, '../public/src/estackOutputPhase.js'), 'utf8');
assert.ok(source.includes('function phaseMetadata'), 'Output phase UI does not read stored phase metadata');
assert.ok(source.includes('function activeReferenceFrequency'), 'Output phase UI has no explicit stored reference-frequency path');
assert.ok(source.includes('if (metadata) return metadata.degrees'), 'Output phase knob still reinterprets metadata-backed all-pass at another crossover');
assert.ok(source.includes('phaseMetadata(channel)?.referenceHz || referenceFrequency(channel)'), 'Output phase UI does not preserve the stored reference frequency');
assert.ok(/Measurement Batch/.test(source), 'phase-reference rationale/comment was lost');

console.log('OK:   Output phase displays the stored all-pass reference');

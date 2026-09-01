'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.resolve(__dirname, '../public/src/estackOutputWorkspace.js'), 'utf8');
assert.ok(source.includes('function wsPhaseMetadata'), 'Unified Output Processing does not read stored phase metadata');
assert.ok(source.includes('function wsPhaseReference'), 'Unified Output Processing has no phase reference-frequency path');
assert.ok(source.includes('if (metadata?.referenceHz > 0) return metadata.referenceHz'), 'Output phase control does not preserve the stored all-pass reference frequency');
assert.ok(source.includes("return wsPhaseMetadata(channel)?.degrees || 0"), 'Output phase control does not display metadata-backed phase degrees');
assert.ok(source.includes('const reference = wsPhaseReference(channel)'), 'Output phase commit does not reuse the active reference frequency');
assert.ok(source.includes('allowedFilterPrefixes: [PHASE_PREFIX]'), 'Output phase commit is not using the guarded E-Stack phase path');

console.log('OK:   Unified Output Processing preserves stored all-pass phase reference');

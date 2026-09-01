#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const scan = ['index.html', 'prototype.css', 'prototype.js', 'fixtures.js'];
const forbidden = [
  'Set' + 'ConfigJson',
  'Set' + 'Volume',
  '/ws/' + 'dsp',
  '/ws/' + 'spectrum',
  'window' + '.parent.DSP',
  'new ' + 'WebSocket',
  'fetch' + '(',
  'XMLHttp' + 'Request'
];

let failed = false;
for (const file of scan) {
  const source = fs.readFileSync(path.join(here, file), 'utf8');
  for (const token of forbidden) {
    if (!source.includes(token)) continue;
    failed = true;
    console.error(`FAIL ${file}: forbidden prototype transport token detected`);
  }
}

if (failed) process.exit(1);
console.log(`OK: ${scan.length} prototype files contain no DSP/control transport tokens.`);

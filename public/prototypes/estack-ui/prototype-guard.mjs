#!/usr/bin/env node
'use strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const forbidden = ['Set'+'ConfigJson','Set'+'Volume','/ws/'+'dsp','/ws/'+'spectrum','window'+'.parent.DSP','XMLHttp'+'Request','Web'+'Socket'];
const allowed = new Set(['prototype-guard.mjs']);
const files = [];
const walk = directory => fs.readdirSync(directory,{withFileTypes:true}).forEach(entry => { const full=path.join(directory,entry.name); if(entry.isDirectory()) walk(full); else if(/\.(html|css|js|mjs)$/.test(entry.name) && !allowed.has(entry.name)) files.push(full); });
walk(root);
let failed=false;
for(const file of files){const source=fs.readFileSync(file,'utf8');for(const token of forbidden){if(source.includes(token)){failed=true;console.error(`FAIL ${path.relative(root,file)}: forbidden transport token detected`);}}const relative=path.relative(root,file).replace(/\\/g,'/');if(source.includes('fetch(')&&relative!=='pages/measurement-batch/page.js'){failed=true;console.error(`FAIL ${relative}: only Measurement Batch may use the local CamillaNode API`);}if(file.endsWith('.html')){const allowsApi=relative==='index.html'||relative==='pages/measurement-batch/page.html';const expected=allowsApi?"connect-src 'self'":"connect-src 'none'";if(!source.includes(expected)){failed=true;console.error(`FAIL ${relative}: missing ${expected} CSP`);}}}
if(failed) process.exit(1);
console.log(`OK: ${files.length} E-Stack prototype files keep DSP transport disabled; Measurement Batch exposes only its explicit same-origin API mode.`);

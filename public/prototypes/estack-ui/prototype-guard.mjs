#!/usr/bin/env node
'use strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const forbidden = ['window'+'.parent.DSP','XMLHttp'+'Request'];
const allowed = new Set(['prototype-guard.mjs']);
const files = [];
const walk = directory => fs.readdirSync(directory,{withFileTypes:true}).forEach(entry => { const full=path.join(directory,entry.name); if(entry.isDirectory()) walk(full); else if(/\.(html|css|js|mjs)$/.test(entry.name) && !allowed.has(entry.name)) files.push(full); });
walk(root);
let failed=false;
for(const file of files){const source=fs.readFileSync(file,'utf8');for(const token of forbidden){if(source.includes(token)){failed=true;console.error(`FAIL ${path.relative(root,file)}: forbidden DSP-write token detected`);}}const relative=path.relative(root,file).replace(/\\/g,'/');const bridge=relative==='shared/estack-dsp-bridge.js';const domain=relative.startsWith('shared/domain/');if((source.includes('fetch(')||source.includes('WebSocket'))&&!bridge){failed=true;console.error(`FAIL ${relative}: only the shared E-Stack DSP bridge may open product transport`);}if((source.includes('Set'+'ConfigJson')||source.includes('Set'+'Volume'))&&!domain){failed=true;console.error(`FAIL ${relative}: DSP mutation must live in a shared E-Stack domain transaction`);}if(file.endsWith('.html')){const allowsApi=relative==='index.html'||relative==='pages/control/page.html'||relative==='pages/measurement-batch/page.html'||relative==='pages/connections/page.html';const expected=allowsApi?"connect-src 'self'":"connect-src 'none'";if(!source.includes(expected)){failed=true;console.error(`FAIL ${relative}: missing ${expected} CSP`);}}}
if(failed) process.exit(1);
console.log(`OK: ${files.length} E-Stack DSP product files centralize transport in the explicit shared CamillaNode bridge.`);

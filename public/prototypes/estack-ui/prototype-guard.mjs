#!/usr/bin/env node
'use strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const forbidden = ['Set'+'ConfigJson','Set'+'Volume','/ws/'+'dsp','/ws/'+'spectrum','window'+'.parent.DSP','fetch'+'(','XMLHttp'+'Request','Web'+'Socket'];
const allowed = new Set(['prototype-guard.mjs']);
const files = [];
const walk = directory => fs.readdirSync(directory,{withFileTypes:true}).forEach(entry => { const full=path.join(directory,entry.name); if(entry.isDirectory()) walk(full); else if(/\.(html|css|js|mjs)$/.test(entry.name) && !allowed.has(entry.name)) files.push(full); });
walk(root);
let failed=false;
for(const file of files){const source=fs.readFileSync(file,'utf8');for(const token of forbidden){if(source.includes(token)){failed=true;console.error(`FAIL ${path.relative(root,file)}: forbidden transport token detected`);}}if(file.endsWith('.html')&&!source.includes("connect-src 'none'")){failed=true;console.error(`FAIL ${path.relative(root,file)}: missing connect-src 'none' CSP`);}}
if(failed) process.exit(1);
console.log(`OK: ${files.length} E-Stack prototype files are mock-only and HTML CSPs disable connections.`);

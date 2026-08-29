'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.resolve(__dirname, '../public/html/main.html'), 'utf8');
const navigationStart = html.indexOf('<span class="leftTitle">Navigation</span>');
const toolsStart = html.indexOf('<div class="leftTitle">Tools</div>');
const configurationsStart = html.indexOf('<div class="leftTitle">Configurations</div>');

assert.ok(navigationStart >= 0 && toolsStart > navigationStart && configurationsStart > toolsStart, 'navigation sections are malformed');

for (const target of ['/basic', '/html/loudness.html', '/html/global-eq.html', '/equalizer', '/advanced']) {
    const index = html.indexOf(`target="${target}"`);
    assert.ok(index > navigationStart && index < toolsStart, `${target} must stay in primary Navigation`);
}

for (const target of ['/signal-generator', '/measurement-batch', '/preferences', '/connections']) {
    const index = html.indexOf(`target="${target}"`);
    assert.ok(index > toolsStart && index < configurationsStart, `${target} must be grouped under Tools`);
}

console.log('OK:   compact primary Navigation and secondary Tools grouping');

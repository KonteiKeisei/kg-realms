import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const file = (rel) => new URL(`../${rel}`, import.meta.url);
test('every script that reads SOURCE_MAP imports it (dock setup failed with "SOURCE_MAP is not defined")',()=>{
  for(const name of ['main.mjs','local-maps.mjs','waterways.mjs','ui-hud.mjs']){
    const src=readFileSync(file(`scripts/${name}`),'utf8');
    if(!/\bSOURCE_MAP\b/.test(src.replace(/^import[^\n]*$/gm,'')))continue;
    assert.match(src,/^import\s*\{[^}]*\bSOURCE_MAP\b[^}]*\}\s*from\s*['"]\.\/source-map\.mjs['"]/m,`${name} uses SOURCE_MAP without importing it`);
  }
});

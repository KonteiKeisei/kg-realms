import {test} from 'node:test';
import assert from 'node:assert/strict';
import {adoptEncounterDefaults} from '../scripts/encounter-defaults.mjs';
import {moduleMarkers} from '../scripts/places.mjs';

test('module encounters seed once, remove the retired placeholder, and respect later deletion',()=>{
  const defaults={encounters:{fall:{name:'The Shining Falls',known:'Waterfall'}},retired:['garbage']};
  const first=adoptEncounterDefaults(defaults,{garbage:{name:'Encounter'},custom:{name:'Bandits'}});
  assert.ok(first.records.fall && first.records.custom);
  assert.equal(first.records.garbage,undefined);
  delete first.records.fall;
  const second=adoptEncounterDefaults(defaults,first.records,first.history);
  assert.equal(second.records.fall,undefined);
  assert.deepEqual(second.history,first.history);
});

test('new default text fills an empty encounter without replacing edited DCs or written notes',()=>{
  const defaults={encounters:{fall:{known:'Waterfall',dc:13}}};
  const own={fall:{name:'Edited',dc:19,notes:''}};
  const result=adoptEncounterDefaults(defaults,own);
  assert.equal(result.records.fall.dc,19);
  assert.equal(result.records.fall.known,'Waterfall');
  assert.equal(own.fall.known,undefined);
  assert.equal(adoptEncounterDefaults(defaults,{fall:{notes:'My history'}}).records.fall.known,undefined);
  assert.equal(adoptEncounterDefaults(defaults,{fall:{known:'My text'}}).records.fall.known,'My text');
});

test('legacy custom marker images follow bundled art and explicit replacements stay selected',()=>{
  const defaults={salt:{name:'Saltmarsh',src:'modules/kg-realms/assets/poi-img/Saltmarsh.webp',originalSrc:'old/salt.webp'}};
  const custom={salt:{name:'Edited',src:'old/salt.webp'}};
  assert.equal(moduleMarkers(defaults,custom).salt.src,defaults.salt.src);
  assert.equal(moduleMarkers(defaults,custom).salt.name,'Edited');
  assert.equal(custom.salt.src,'old/salt.webp');
  assert.equal(moduleMarkers(defaults,{salt:{src:'my/new.webp'}}).salt.src,'my/new.webp');
  assert.equal(moduleMarkers(defaults,{salt:null}).salt,null);
});

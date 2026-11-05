import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {registerWorld} from '../scripts/worlds.mjs';
import {generatorWorlds,renderGeneratorButton,openGenerator,loadWorld} from '../scripts/generator.mjs';
import {LocalMaps} from '../scripts/local-maps.mjs';

test('a clean install has no Generate button or implicit Toril requests, including direct generator and local-map actions',async()=>{
  const warnings=[],requests=[];globalThis.game={user:{isGM:true},modules:new Map(),settings:{get:()=>({})}};globalThis.ui={notifications:{warn:message=>warnings.push(message)}};globalThis.foundry={utils:{escapeHTML:String}};
  const {document}=parseHTML('<html><body><div class="header-actions"></div></body></html>');globalThis.document=document;globalThis.fetch=async path=>{requests.push(path);throw Error('Unexpected fetch');};
  renderGeneratorButton(document.body);assert.equal(document.querySelector('.kg-realms-generate-button'),null);
  await openGenerator();await assert.rejects(()=>loadWorld(),/No realm map/);assert.deepEqual(requests,[]);assert.ok(!warnings.join('').includes('Faer'));
  const maps=new LocalMaps({getRealmPlaces:()=>{throw Error('A fresh install must not try to load places');}});
  await maps.make({id:'plain',name:'Plain',notes:[],getFlag:()=>null});assert.deepEqual(requests,[]);
});

test('only enabled companion roots provide Generate, excluding manual realms and Regional maps',()=>{
  const {document}=parseHTML('<html><body><div class="header-actions"></div></body></html>');globalThis.document=document;
  registerWorld({id:'manual',title:'Manual realm',module:'kg-realms',homebrew:true});renderGeneratorButton(document.body);assert.equal(document.querySelector('button'),null);
  registerWorld({id:'companion',title:'Example realm',module:'example-companion'});game.modules.set('example-companion',{active:false});renderGeneratorButton(document.body);assert.equal(document.querySelector('button'),null);
  game.modules.get('example-companion').active=true;
  registerWorld({id:'detail',title:'Detailed map',module:'example-companion',sceneTemplates:{role:'regional'}});
  assert.deepEqual(generatorWorlds().map(w=>w.id),['companion']);renderGeneratorButton(document.body);renderGeneratorButton(document.body);assert.equal(document.querySelectorAll('button').length,1);assert.match(document.querySelector('button').textContent,/Generate Example realm/);
  game.modules.get('example-companion').active=false;renderGeneratorButton(document.body);assert.equal(document.querySelector('button'),null);
  game.modules.get('example-companion').active=true;game.user.isGM=false;renderGeneratorButton(document.body);assert.equal(document.querySelector('button'),null);
});

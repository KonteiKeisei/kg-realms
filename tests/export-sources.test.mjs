import test from 'node:test';
import assert from 'node:assert/strict';
import {collectExportFiles,exportFileProblem,exportRepairReport} from '../scripts/homebrew/export-sources.mjs';
import {cardForExport,worldForExport,presetForExport} from '../scripts/homebrew/export-policy.mjs';
import {sceneForExport} from '../scripts/homebrew/export-plan.mjs';

const A='a'.repeat(16),B='b'.repeat(16),C='c'.repeat(16);
test('a missing file lists every scene, exact field and embedded tile identity that uses it',()=>{
  const groups=new Map([['Scene',[{_id:'one',name:'Lonelywood',tiles:[{_id:'roof',name:'Roofs',texture:{src:'maps/missing.avif'}}]},{_id:'two',name:'Speakers House',background:{src:'maps/missing.avif'}}]]]);
  const before=structuredClone(groups),{named,usage}=collectExportFiles(groups,new Map(),{},{});
  assert.equal(named.size,1);assert.equal(named.get('maps/missing.avif'),'assets/maps');
  const report=exportFileProblem('maps/missing.avif','HTTP 404',usage);
  for(const text of ['Scene "Lonelywood" [one]','tiles[0].texture.src','Tile "Roofs" [roof]','Scene "Speakers House" [two]','background.src'])assert.ok(report.includes(text),text);
  assert.deepEqual(groups,before);
});

test('actor and nested item assets identify their document and all referring scenes without crossing scene links',()=>{
  const groups=new Map([
    ['Scene',[{_id:'one',name:'Inn',tokens:[{actorId:A}],notes:[{flags:{'kg-realms':{local:{scene:'two'}}}}]},{_id:'two',name:'Cellar',tokens:[{actorId:A}]},{_id:'three',name:'Unrelated',notes:[{flags:{'kg-realms':{local:{scene:'one'}}}}]}]],
    ['Actor',[{_id:A,name:'Keeper',img:'actor.webp',items:[{_id:'coat',name:'Coat',img:'coat.webp'}],description:`@UUID[Item.${B}]{Sword}`}]],
    ['Item',[{_id:B,name:'Sword',img:'sword.webp',description:`@UUID[Actor.${A}]{Keeper}`}]]
  ]);
  const {usage}=collectExportFiles(groups,new Map(),{},{});
  for(const file of ['actor.webp','coat.webp','sword.webp']){
    const text=exportFileProblem(file,'HTTP 404',usage);assert.match(text,/Scene "Inn"/);assert.match(text,/Scene "Cellar"/);assert.doesNotMatch(text,/Unrelated/);
  }
  assert.match(exportFileProblem('coat.webp','HTTP 404',usage),/items\[0\]\.img \(Item "Coat" \[coat\]\)/);
  assert.match(exportFileProblem('sword.webp','HTTP 404',usage),/Item "Sword"/);
});

test('world cards identify the place and map, including the scenes behind their linked actors',()=>{
  const groups=new Map([['Scene',[{_id:'realm',name:'Map of Faerun',flags:{'kg-realms':{world:'toril'}}}]],['Actor',[{_id:A,name:'Guide',img:'guide.webp'}]]]);
  const files=new Map([['index.json',{places:[{id:'dale',name:'Icewind Dale',actor:`Actor.${A}`,known:'<img src="https://example.test/inline.png">'}],terrain:{file:'terrain.png'}}]]);
  const {named,usage}=collectExportFiles(groups,files,{}, {world:'toril',title:'Faerun'});
  const report=exportFileProblem('https://example.test/inline.png','Failed to fetch',usage);
  assert.match(report,/index.json: places\[0\]\.known \(Place "Icewind Dale" \[dale\]\)/);assert.match(report,/Scene "Map of Faerun"/);
  assert.match(exportFileProblem('guide.webp','HTTP 404',usage),/Scene "Map of Faerun"/);assert.equal(named.has('terrain.png'),false);
});

test('file deduplication retains repeated HTML and plain-field locations and calendar folder priority',()=>{
  const groups=new Map([['Scene',[{_id:'scene',name:'Map',background:{src:'same.png'},notes:[{_id:'pin',flags:{'kg-realms':{local:{known:'<img src="same.png"><img src="same.png">'}}}}]}]]]);
  const calendar={data:{img:'same.png'}},{named,usage}=collectExportFiles(groups,new Map([['calendar.json',calendar]]),{}, {calendar});
  assert.equal(named.size,1);assert.equal(named.get('same.png'),'assets/calendar');assert.equal(usage.get('same.png').size,3);
  assert.equal(exportFileProblem('unknown.png','HTTP 404',usage),'unknown.png: HTTP 404');
});

test('excluding Card actors removes only the card attachments and actor links, preserving readable labels and other documents',()=>{
  const card={actor:`Actor.${A}`,actors:[`Actor.${B}`],name:'Shop',scene:'local',known:`<p>@UUID[Actor.${A}]{Keeper} sells @UUID[Item.${B}]{Sword}.</p>`,pinned:`JournalEntry.${C}`,img:`maps/Actor.${A}.avif`};
  const before=structuredClone(card),out=cardForExport(card,{includeCardActors:false});
  assert.equal(out.actor,undefined);assert.equal(out.actors,undefined);assert.equal(out.known,`<p>Keeper sells @UUID[Item.${B}]{Sword}.</p>`);assert.equal(out.pinned,card.pinned);assert.equal(out.scene,'local');assert.equal(out.img,card.img);
  assert.deepEqual(card,before);assert.deepEqual(cardForExport(card,{includeCardActors:true}),before);
});

test('unchecked Card actors stay out of legacy local map presets without changing their authored map setup',()=>{
  const source={scene:{name:'Town',width:8000,height:6400},places:[{name:'Inn',actor:`Actor.${A}`,known:'Inn text',x:20,y:30}]},before=structuredClone(source);
  const out=presetForExport(source,{includeCardActors:false});assert.equal(out.places[0].actor,undefined);assert.deepEqual(out.scene,source.scene);assert.deepEqual(source,before);
});

test('travel exclusion preserves permanent map hazards and clears actor attachments from Regional edits',()=>{
  const input={
    places:[{id:'town',actor:`Actor.${A}`}],
    encounters:{bandit:{kind:'encounter',actor:`Actor.${A}`},rapids:{kind:'hazard',subtype:'rapids',actor:`Actor.${B}`}},
    regionalEdits:{edits:{town:{actor:`Actor.${A}`}},added:{inn:{actor:`Actor.${B}`}}}
  };
  const before=structuredClone(input),out=worldForExport(input,{includeTravel:false,includeCardActors:false});
  assert.deepEqual(Object.keys(out.encounters),['rapids']);assert.equal(out.encounters.rapids.actor,undefined);assert.equal(out.regionalEdits.edits.town.actor,undefined);assert.equal(out.regionalEdits.added.inn.actor,undefined);assert.deepEqual(input,before);
});

test('selected Travel retains progress and encounters and makes the focused party route usable without party tokens',()=>{
  const scene={_id:'scene',tokens:[{actorId:A}],flags:{'kg-realms':{partyJourneys:{first:{name:'First'},second:{name:'Second',trip:{departed:25},encounters:[{actor:`Actor.${A}`,name:'Ambush'}]}},partyFocus:'second',partyToken:`Actor.${A}`,homebrewOriginal:{}}}};
  const before=structuredClone(scene),out=sceneForExport(scene,'realm',()=>true,{includeTravel:true,includeCardActors:false});
  assert.equal(out.flags['kg-realms'].journey.name,'Second');assert.equal(out.flags['kg-realms'].journey.trip.departed,25);assert.equal(out.flags['kg-realms'].journey.encounters[0].actor,undefined);assert.equal(out.flags['kg-realms'].partyJourneys.first.name,'First');assert.equal(out.flags['kg-realms'].partyToken,undefined);assert.deepEqual(scene,before);
});

test('repair locations distinguish scene sounds, shared marker settings and embedded HTML references',()=>{
  const groups=new Map([['Scene',[{_id:'scene',name:'Lonelywood',sounds:[{_id:'wind',name:'Wind',path:'missing.ogg'}],notes:[{_id:'pin',flags:{'kg-realms':{local:{known:'<p>Keep this text.</p><img src="missing.png">'}}}}]}]]]);
  const {locations}=collectExportFiles(groups,new Map(),{custom:{name:'Custom marker',src:'missing.png'}},{world:'toril'});
  const sound=locations.get('missing.ogg')[0];assert.deepEqual(sound.path,['sounds',0,'path']);assert.equal(sound.embedded[0].id,'wind');assert.equal(sound.embedded[0].name,'Wind');
  const marker=locations.get('missing.png').find(u=>u.kind==='setting');assert.equal(marker.namespace,'kg-realms');assert.equal(marker.setting,'customMarkers');assert.deepEqual(marker.path,['custom','src']);
  const html=locations.get('missing.png').find(u=>u.kind==='document');assert.equal(html.embedded[0].id,'pin');assert.equal(html.value,'<p>Keep this text.</p><img src="missing.png">');
  const built={problems:2,report:'Repair these files.',diagnostics:[{world:{id:'toril'},issues:[{path:'missing.png',uses:locations.get('missing.png')}]}],parts:[new Uint8Array([1,2,3])]};
  const packet=exportRepairReport(built,{moduleId:'test',includeTravel:false,includeCardActors:false},'0.94.5');
  assert.equal(JSON.parse(JSON.stringify(packet)).worlds[0].issues[0].uses.length,2);assert.equal(packet.parts,undefined);assert.equal(packet.engineVersion,'0.94.5');
  packet.worlds[0].issues[0].uses[0].path[0]='changed';assert.notEqual(built.diagnostics[0].issues[0].uses[0].path[0],'changed');
});

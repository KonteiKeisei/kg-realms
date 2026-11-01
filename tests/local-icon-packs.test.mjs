import "./helpers/worlds.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import {ICON_PACKS,iconPack,iconPackOverride,resolvedIconPack,iconPackOptions,worldIconPack,registerIconPackSetting} from '../scripts/local-icon-packs.mjs';
import {localRecord} from '../scripts/local-places.mjs';
import {registerKinds} from '../scripts/card-kinds.mjs';
import {LocalMaps} from '../scripts/local-maps.mjs';

test('all five packs are available and unspecified maps start with Enamel',()=>{
 assert.deepEqual(iconPackOptions().map(([k])=>k),['coin','current','gilded','brass','enamel']);assert.ok(Object.isFrozen(ICON_PACKS));
 assert.equal(resolvedIconPack({},{}),'enamel');assert.equal(resolvedIconPack(null,null),'enamel');
});
test('POIs inherit the map pack until an explicit override is selected, including Current',()=>{
 for(const map of Object.keys(ICON_PACKS))for(const poi of Object.keys(ICON_PACKS))assert.equal(resolvedIconPack({iconPack:map},{iconPack:poi}),poi);
 assert.equal(resolvedIconPack({iconPack:'brass'},{iconPack:null}),'brass');assert.equal(resolvedIconPack({iconPack:'enamel'},{iconPack:''}),'enamel');
 assert.equal(resolvedIconPack({iconPack:'gilded'},{iconPack:'current'}),'current');
});
test('unknown or malicious pack values cannot expand the texture cache or become UI markup',()=>{
 for(const value of ['__proto__','constructor','toString','<img src=x>','Gilded',{},[],42,null,undefined]){
  assert.equal(iconPack(value),'enamel');assert.equal(iconPackOverride(value),null);assert.equal(resolvedIconPack({iconPack:'brass'},{iconPack:value}),'brass');
 }
});

test('world, map and POI precedence covers every explicit and inherited combination',()=>{
 for(const world of Object.keys(ICON_PACKS))for(const map of [null,'',...Object.keys(ICON_PACKS)])for(const poi of [null,'',...Object.keys(ICON_PACKS)]){
  assert.equal(resolvedIconPack({iconPack:map},{iconPack:poi},world),poi||map||world);
 }
});
test('world settings are shared, default to Enamel and notify without rewriting documents',()=>{
 const oldGame=globalThis.game,oldHooks=globalThis.Hooks;let config,refreshes=0,notifications=0,value;
 try{
  globalThis.game={settings:{get:()=>value,register:(module,key,c)=>{assert.equal(module,'kg-realms');assert.equal(key,'defaultIconPack');config=c;}}};globalThis.Hooks={callAll:name=>{assert.equal(name,'kgRealmsIconPackChanged');notifications++;}};
  registerIconPackSetting(()=>refreshes++);assert.equal(config.scope,'world');assert.equal(config.default,'enamel');assert.deepEqual(config.choices,ICON_PACKS);
  assert.equal(worldIconPack(),'enamel');value='gilded';assert.equal(worldIconPack(),'gilded');assert.equal(resolvedIconPack({},{}),'gilded');
  config.onChange();assert.equal(refreshes,1);assert.equal(notifications,1);
  value='invalid';assert.equal(worldIconPack(),'enamel');game.settings.get=()=>{throw Error('Not registered yet');};assert.equal(worldIconPack(),'enamel');
 }finally{globalThis.game=oldGame;globalThis.Hooks=oldHooks;}
});
test('local records preserve validated overrides and inheritance across JSON export/import',()=>{
 const inherited=localRecord({name:'Tavern',known:'Keep this text',scene:'inn'});assert.equal(inherited.iconPack,null);
 for(const value of [null,...Object.keys(ICON_PACKS)]){const rec=localRecord({...inherited,iconPack:value});assert.deepEqual(localRecord(JSON.parse(JSON.stringify(rec))),rec);}
 assert.equal(localRecord({iconPack:'unknown'}).iconPack,null);assert.equal(inherited.known,'Keep this text');assert.equal(inherited.scene,'inn');
});
function fixture(){
 const map={name:'City',iconPack:'brass',parent:{scene:'parent'},seasons:{winter:'winter.webp'},unplaced:[{name:'Later'}]};
 const scene={id:'city',getFlag:(m,k)=>k==='localMap'?map:null,notes:new Map(),writes:[],async setFlag(m,k,v){this.writes.push([k,v]);assert.equal(k,'localMap.iconPack');map.iconPack=v;}};
 const rec=localRecord({name:'Tavern',category:'inn',known:'Existing prose',scene:'linked-scene',gmNotes:'Secret'});
 const note={id:'poi',parent:scene,iconSize:64,getFlag:()=>rec,async update(v){Object.assign(rec,v['flags.kg-realms.local']);this.last=v;}};scene.notes.set('poi',note);
 globalThis.foundry={utils:{escapeHTML:s=>String(s)}};globalThis.game={user:{isGM:true},scenes:new Map([['city',scene]])};globalThis.canvas={scene,notes:{placeables:[]}};
 const defs=new Map();registerKinds({register:(k,d)=>defs.set(k,d)},{localMaps:{linkScene:()=>{throw Error('Unexpected link change');}}});
 return {map,scene,note,rec,kind:defs.get('local'),ref:{kind:'local',scene:'city',note:'poi'}};
}
test('the card offers map inheritance plus all packs and saves only the requested override',async()=>{
 const f=fixture(),d=f.kind.get(f.ref),field=d.fields.find(x=>x.name==='iconPack');
 assert.equal(field.options.length,6);assert.deepEqual(field.options[0],['','Use map default (Brass)']);assert.equal(d.form.iconPack,'');
 await f.kind.save(f.ref,{iconPack:'enamel'});assert.equal(f.rec.iconPack,'enamel');assert.equal(f.rec.known,'Existing prose');assert.equal(f.rec.scene,'linked-scene');assert.equal(f.note.iconSize,64);
 await f.kind.save(f.ref,{name:'Renamed'});assert.equal(f.rec.iconPack,'enamel');
 await f.kind.save(f.ref,{iconPack:''});assert.equal(f.rec.iconPack,null);assert.equal(resolvedIconPack(f.map,f.rec),'brass');
 await f.kind.save(f.ref,{iconPack:'invalid'});assert.equal(f.rec.iconPack,null);
});
test('map default changes save one appearance field and preserve the map and explicit POIs',async()=>{
 const f=fixture(),maps=new LocalMaps({});f.rec.iconPack='current';await maps.setIconPack(f.scene,'gilded');
 assert.deepEqual(f.scene.writes,[['localMap.iconPack','gilded']]);assert.equal(f.map.seasons.winter,'winter.webp');assert.equal(f.map.parent.scene,'parent');assert.equal(f.map.unplaced.length,1);assert.equal(f.rec.iconPack,'current');
 await maps.setIconPack(f.scene,'');assert.equal(f.map.iconPack,null);assert.equal(f.rec.iconPack,'current');assert.equal(resolvedIconPack(f.map,{},'brass'),'brass');
 game.user.isGM=false;await maps.setIconPack(f.scene,'enamel');assert.equal(f.scene.writes.length,2);
});
test('card inheritance labels resolve an inherited world default instead of freezing a pack',()=>{
 const f=fixture();f.map.iconPack=null;let value='enamel';game.settings={get:()=>value};
 const option=()=>f.kind.get(f.ref).fields.find(x=>x.name==='iconPack').options[0][1];assert.equal(option(),'Use map default (Enamel)');
 value='brass';assert.equal(option(),'Use map default (Brass)');f.map.iconPack='current';assert.equal(option(),'Use map default (Current)');
});


test('private dock and land-entry overrides survive card editing and JSON exports',async()=>{
 const f=fixture();let checked=0;const kinds={};registerKinds({register:(k,d)=>kinds[k]=d},{localMaps:{linkScene(){},entrancePlaced:async()=>checked++}});
 const def=kinds.local;
 await def.save(f.ref,{entry:true,entryType:'dock',privateEntry:true});
 const data=def.get(f.ref);assert.equal(data.form.privateEntry,true);assert.equal(data.form.entryType,'dock');assert.equal(data.rows[0][1],'Dock entrance');assert.match(data.rows[1][1],/Private/);
 assert.ok(data.fields.some(x=>x.name==='privateEntry'&&x.type==='check'));
 const imported=localRecord(JSON.parse(JSON.stringify(f.rec)));assert.equal(imported.privateEntry,true);assert.equal(imported.entryType,'dock');
 await def.save(f.ref,{entryType:'land',privateEntry:false});assert.equal(def.get(f.ref).rows[1][1],'Public');assert.equal(checked,2);
});

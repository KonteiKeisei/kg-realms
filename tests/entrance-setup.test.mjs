import "./helpers/worlds.mjs";
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LocalMaps} from '../scripts/local-maps.mjs';
import {LocalEditor} from '../scripts/ui-local.mjs';
import {gmGame} from './helpers/journey.mjs';
import {readFileSync} from 'node:fs';

function setup() {
  gmGame();
  const scene={id:'city',name:'City',notes:[],map:{placeId:'city',world:'toril',name:'City'},getFlag(m,k){return k==='localMap'?this.map:null;}};
  globalThis.canvas={scene};let prompts=0,started=0;
  globalThis.foundry={applications:{api:{DialogV2:{confirm:async()=>{prompts++;return true;}}}},utils:{getRoute:p=>p}};
  const maps=new LocalMaps({});maps.editor={startEntrance(){started++;}};
  return {scene,maps,prompts:()=>prompts,started:()=>started};
}

test('first viewing a gateless settlement prompts once per session and starts entrance placement',async()=>{
  const f=setup();await f.maps.ensureEntrance();await f.maps.ensureEntrance();
  assert.equal(f.prompts(),1);assert.equal(f.started(),1);
});

test('players, another scene, nested maps and settlements with an entrance do not prompt',async()=>{
  const f=setup();game.user.isGM=false;await f.maps.ensureEntrance();game.user.isGM=true;
  canvas.scene={id:'other'};await f.maps.ensureEntrance(f.scene);canvas.scene=f.scene;
  f.scene.map.placeId=null;await f.maps.ensureEntrance();f.scene.map.placeId='city';
  f.scene.notes=[{id:'gate',x:100,y:100,getFlag:()=>({category:'gate'})}];await f.maps.ensureEntrance();
  assert.equal(f.prompts(),0);
});

test('closing or changing scenes during the setup prompt cannot open an editor on the wrong scene',async()=>{
  const f=setup();foundry.applications.api.DialogV2.confirm=async()=>{canvas.scene={id:'other'};return true;};
  await f.maps.ensureEntrance(f.scene);assert.equal(f.started(),0);
});

test('a harbour alone does not replace the required first gate or road in',async()=>{
  const f=setup();f.scene.notes=[{id:'dock',x:100,y:100,getFlag:()=>({category:'harbour',entry:true})}];
  await f.maps.ensureEntrance();assert.equal(f.prompts(),1);assert.equal(f.started(),1);
});

test('entrance placement preselects gate and way-in instead of the ordinary generic place',()=>{
  setup();const editor=new LocalEditor({localMapOf:()=>({})});editor.open=()=>{editor.active=true;};editor.render=()=>{};
  editor.startEntrance();assert.equal(editor.active,true);assert.equal(editor.placing.category,'gate');assert.equal(editor.placing.entry,true);
});

test('Neverwinter uses the 42 exported placements and retires the removed pending locations',()=>{
  const p=JSON.parse(readFileSync(new URL('../data/worlds/toril/local/neverwinter.json',import.meta.url),'utf8'));
  assert.equal(p.places.length,42);assert.equal(p.version,6);
  assert.deepEqual(p.places.filter(n=>n.category==='gate').map(n=>[n.name,n.entry]),[
    ['Southwestern Gate',false],['Southeastern Gate',false],['Northwestern Gate',false],['Northeastern Gate',false]
  ]);
  assert.equal(p.unplaced.length,0);assert.equal(p.retired.length,9);
  assert.ok(p.retired.includes('Seafoam Manor'));
  assert.equal(new Set(p.places.map(n=>n.name.toLowerCase())).size,42);
  assert.ok(p.places.every(n=>Number.isFinite(n.x)&&Number.isFinite(n.y)&&n.known));
  assert.ok(p.places.some(n=>n.name==='Board Laid Bare'&&n.category==='inn'));
  const moved=p.places.find(n=>n.name==='House of a Thousand Faces');assert.deepEqual([moved.x,moved.y],[5154,3650]);
});

test('a revised preset adds missing POIs without replacing existing edits or custom unplaced text',async()=>{
  setup();globalThis.ui={notifications:{info(){}}};
  const custom={name:'House of a Thousand Faces',known:'GM revised text',entry:false};
  const original={id:'own',text:custom.name,x:40,y:50,getFlag:()=>custom};
  const scene={id:'city',name:'Neverwinter',notes:[original],map:{world:'toril',placeId:'city',iconPack:'current',unplaced:[{name:'Castle Never',known:'old pending text'},{name:'Seafoam Manor',known:'GM custom Seafoam'},{name:'Custom lead',known:'My text'}]},getFlag(m,k){return k==='localMap'?this.map:null;},async setFlag(m,k,v){this.map=v;},async createEmbeddedDocuments(type,list){this.created=list;for(const n of list)this.notes.push({...n,getFlag:()=>n.flags['kg-realms'].local});},async updateEmbeddedDocuments(){throw Error('Existing local POIs must not be rewritten');}};
  const preset=JSON.parse(readFileSync(new URL('../data/worlds/toril/local/neverwinter.json',import.meta.url),'utf8'));
  globalThis.fetch=async()=>({json:async()=>preset});game.scenes=[scene];game.scenes.get=()=>null;
  const maps=new LocalMaps({getRealmPlaces:async()=>[],savePlaceEdit:async()=>{}});
  await maps.applyPreset({file:'neverwinter.json',revision:5},{scene});
  assert.equal(scene.created.length,41);assert.equal(original.x,40);assert.equal(custom.known,'GM revised text');
  assert.equal(scene.map.iconPack,'current');assert.equal(scene.map.presetRevision,5);
  assert.deepEqual(scene.map.unplaced,[{name:'Custom lead',known:'My text'}]);
  await maps.applyPreset({file:'neverwinter.json',revision:5},{scene});assert.equal(scene.notes.length,42,'reapplying does not duplicate places');
});


test('opening a port editor requests a dock after the gate exists, without repeating after a dock is placed',async()=>{
  const f=setup();f.scene.notes=[{id:'gate',x:100,y:100,getFlag:()=>({category:'gate'})}];f.maps.needsDock=async()=>true;let type;
  f.maps.editor.startEntrance=t=>type=t;
  await f.maps.ensureEntrance(f.scene,{editorOpen:true});assert.equal(type,'dock');assert.equal(f.prompts(),1);
  f.scene.notes.push({id:'dock',x:200,y:100,getFlag:()=>({category:'harbour',entry:true})});
  await f.maps.ensureEntrance(f.scene,{editorOpen:true});assert.equal(f.prompts(),1);
});

test('gate and dock prompts run sequentially, with no overlap from simultaneous editor requests',async()=>{
  const f=setup();let release,queries=0;f.maps.needsDock=async()=>{queries++;return true;};
  const pending=new Promise(r=>release=r);foundry.applications.api.DialogV2.confirm=()=>pending;
  const a=f.maps.ensureEntrance(),b=f.maps.ensureEntrance(f.scene,{editorOpen:true});await Promise.resolve();
  assert.equal(a,b);assert.equal(queries,0);release(true);await a;assert.equal(f.started(),1);
  f.scene.notes=[{id:'gate',x:100,y:100,getFlag:()=>({category:'gate'})}];let type;
  f.maps.editor.startEntrance=t=>type=t;foundry.applications.api.DialogV2.confirm=async()=>true;
  await f.maps.entrancePlaced(f.scene);assert.equal(type,'dock');assert.equal(queries,1);
});

test('inland maps, players and unfinished placement do not trigger dock setup',async()=>{
  const f=setup();f.scene.notes=[{id:'gate',x:100,y:100,getFlag:()=>({category:'gate'})}];f.maps.needsDock=async()=>false;
  await f.maps.ensureEntrance(f.scene,{editorOpen:true});assert.equal(f.prompts(),0);
  f.maps.needsDock=async()=>true;f.maps.editor.placing={name:'Current draft'};
  await f.maps.ensureEntrance(f.scene,{editorOpen:true});assert.equal(f.prompts(),0);
  f.maps.editor.placing=null;game.user.isGM=false;await f.maps.ensureEntrance(f.scene,{editorOpen:true});assert.equal(f.prompts(),0);
});

test('late port lookups cannot prompt or place on a closed editor or a different scene',async()=>{
  const f=setup();f.scene.notes=[{id:'gate',x:100,y:100,getFlag:()=>({category:'gate'})}];
  f.maps.needsDock=async()=>{f.maps.editor.active=false;return true;};
  await f.maps.ensureEntrance(f.scene,{editorOpen:true});assert.equal(f.prompts(),0);
  f.maps.editor.active=true;f.maps.needsDock=async()=>{canvas.scene={id:'other'};return true;};
  await f.maps.ensureEntrance(f.scene,{editorOpen:true});assert.equal(f.prompts(),0);
});

test('dock placement sets a harbour entrance explicitly and later deferral can be retried',async()=>{
  setup();const editor=new LocalEditor({localMapOf:()=>({})});editor.open=()=>{};editor.render=()=>{};
  editor.startEntrance('dock');assert.equal(editor.placing.category,'harbour');assert.equal(editor.placing.entry,true);assert.equal(editor.placing.entryType,'dock');
  const f=setup();f.scene.notes=[{id:'gate',x:100,y:100,getFlag:()=>({category:'gate'})}];f.maps.needsDock=async()=>true;
  let prompts=0;foundry.applications.api.DialogV2.confirm=async()=>{prompts++;return false;};
  f.maps.editorOpened(f.scene);await f.maps.entranceCheck;f.maps.editorOpened(f.scene);await f.maps.entranceCheck;assert.equal(prompts,2);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LocalEditor} from '../scripts/ui-local.mjs';
import {LocalMaps,protectLocalPlaceNotes} from '../scripts/local-maps.mjs';

function fixture() {
 const frames=new Map(),handlers=new Map(),writes=[],opened=[],errors=[];let next=0;
 globalThis.requestAnimationFrame=fn=>{frames.set(++next,fn);return next;};globalThis.cancelAnimationFrame=id=>frames.delete(id);
 globalThis.game={user:{id:'gm',isGM:true}};
 globalThis.Hooks={on:(key,fn)=>{handlers.set(key,fn);return key;},off:key=>handlers.delete(key)};
 globalThis.window={addEventListener(){},removeEventListener(){}};globalThis.document={removeEventListener(){}};
 globalThis.ui={notifications:{error:s=>errors.push(s)}};
 const scene={id:'town',map:{name:'Town',markerScale:1},getFlag:()=>scene.map};
 const note={id:'inn',x:100,y:100,iconSize:64,parent:scene,rec:{name:'Inn',scene:'inside',known:'Authored card',category:'inn',entry:true,entryType:'land'},getFlag:()=>note.rec,async update(changes){writes.push(changes);Object.assign(this,changes);}};
 const position={x:100,y:100,set(x,y){this.x=x;this.y=y;}};note.object={position,kgrMarker:{width:32},visible:true};
 const plain={id:'journal',x:300,y:300,rec:null};
 scene.notes={contents:[note,plain],get:id=>scene.notes.contents.find(n=>n.id===id)};
 const view={style:{},getBoundingClientRect:()=>({left:20,top:30}),setPointerCapture(){},releasePointerCapture(){}};
 globalThis.canvas={scene,app:{view},notes:{active:false},stage:{scale:{x:2},worldTransform:{applyInverse:({x,y})=>({x:x/2,y:y/2})}}};
 const maps={localMapOf:s=>s.map,localOf:n=>n.rec,refreshMarker(){},hideMarkerCard(){},open:n=>opened.push(n)};
 const editor=new LocalEditor(maps);editor.active=true;editor.editScene=scene;editor.render=()=>{};
 const event=(x=220,y=230,extra={})=>({clientX:x,clientY:y,button:0,pointerId:1,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra});
 return {editor,maps,scene,note,plain,position,writes,opened,errors,event,handlers,frames,flush(){for(const fn of frames.values())fn();frames.clear();}};
}

test('local markers drag in token mode, preview locally and save only coordinates once on release',async()=>{
 const f=fixture(),original=structuredClone(f.note.rec);
 await f.editor.onDown(f.event(224,234));assert.equal(canvas.notes.active,false);assert.equal(f.note.object.kgrPlaceDragging,true);
 for(let i=1;i<=30;i++)f.editor.onMove(f.event(224+i*2,234+i*2));
 assert.equal(f.frames.size,1);assert.equal(f.writes.length,0);assert.equal(f.note.x,100);
 f.flush();assert.deepEqual([f.position.x,f.position.y],[130,130]);
 await f.editor.onUp(f.event(284,294));assert.deepEqual(f.writes,[{x:130,y:130}]);assert.equal(f.note.object.kgrPlaceDragging,false);
 assert.deepEqual(f.note.rec,original);assert.equal(f.note.id,'inn');assert.deepEqual([f.position.x,f.position.y],[130,130]);assert.equal(f.opened.length,0);
});

test('clicking does not move a marker, while a double click opens its existing card',async()=>{
 const f=fixture();await f.editor.onDown(f.event());await f.editor.onUp(f.event(221,230));assert.equal(f.writes.length,0);assert.equal(f.opened.length,0);
 await f.editor.onDown(f.event());await f.editor.onUp(f.event());assert.deepEqual(f.opened,[f.note]);assert.equal(f.writes.length,0);
});

test('Escape and pointer cancellation restore the marker without saving',async()=>{
 for(const method of ['escape','cancel','blur','close']){
  const f=fixture();await f.editor.onDown(f.event());f.editor.onMove(f.event(260,270));f.flush();assert.equal(f.position.x,120);
  if(method==='escape')f.editor.onKey({key:'Escape',stopPropagation(){},preventDefault(){}});
  else if(method==='cancel')f.editor.onCancel({pointerId:1});else if(method==='blur')f.editor.onCancel({});else f.editor.close();
  assert.equal(f.writes.length,0,method);assert.equal(f.editor.press,null,method);assert.deepEqual([f.position.x,f.position.y],[100,100],method);assert.equal(f.frames.size,0);
 }
});

test('only GM Places editing takes marker input; ordinary notes and empty map clicks are untouched',async()=>{
 for(const mode of ['player','closed','roads','style','different-scene','ordinary-note','empty','invisible']){
  const f=fixture();let e=f.event();
  if(mode==='player')game.user.isGM=false;if(mode==='closed')f.editor.active=false;if(['roads','style'].includes(mode))f.editor.tab=mode;
  if(mode==='different-scene')canvas.scene={id:'other',map:{}};
  if(mode==='ordinary-note')e=f.event(620,630);if(mode==='empty')e=f.event(900,900);if(mode==='invisible')f.note.object.visible=false;
  await f.editor.onDown(e);f.editor.onMove(f.event(260,270));await f.editor.onUp(f.event(260,270));
  assert.equal(f.writes.length,0,mode);assert.equal(e.stopped,undefined,mode);
 }
});

test('scene changes, role loss and concurrent position edits cancel an active drag',async()=>{
 for(const change of ['scene','role','remote','deleted','tab']){
  const f=fixture();await f.editor.onDown(f.event());f.editor.onMove(f.event(260,270));f.flush();
  if(change==='scene')canvas.scene={id:'other',map:{}};if(change==='role')game.user.isGM=false;if(change==='remote')f.note.x=75;if(change==='deleted')f.scene.notes.contents=[];if(change==='tab')f.editor.tab='roads';
  await f.editor.onUp(f.event(280,290));assert.equal(f.writes.length,0,change);assert.equal(f.note.object.kgrPlaceDragging,false,change);
  assert.equal(f.position.x,change==='remote'?75:100,change);
 }
});

test('a failed update restores the preview and multiple pointers cannot take over a drag',async()=>{
 const f=fixture();f.note.update=async()=>{throw Error('Denied');};await f.editor.onDown(f.event());
 f.editor.onMove(f.event(600,600,{pointerId:2}));await f.editor.onUp(f.event(600,600,{pointerId:2}));assert.ok(f.editor.press);assert.equal(f.frames.size,0);
 f.editor.onMove(f.event(260,270));f.flush();await f.editor.onUp(f.event(260,270));
 assert.deepEqual([f.position.x,f.position.y],[100,100]);assert.equal(f.errors.length,1);assert.equal(f.editor.saving,null);
});

test('native note permissions and deletion are blocked only for KG places, with explicit maintenance paths',()=>{
 const hooks=new Map(),calls=[];globalThis.Hooks={on:(name,fn)=>hooks.set(name,fn)};
 class NativeNote{constructor(rec){this.document={getFlag:()=>rec};} _canControl(...args){calls.push([this,...args]);return 'control';} _canDrag(){return 'drag';} _canDelete(){return 'delete';} _canConfigure(){return 'configure';} _canHover(){return true;} _canView(){return true;}}
 protectLocalPlaceNotes(NativeNote);const kg=new NativeNote({name:'Place'}),plain=new NativeNote(null);
 for(const [method,normal] of [['_canControl','control'],['_canDrag','drag'],['_canDelete','delete'],['_canConfigure','configure']]){assert.equal(kg[method]({isGM:true}),false);assert.equal(plain[method]({isGM:true}),normal);}
 assert.equal(calls[0][0],plain);assert.equal(kg._canHover(),true);assert.equal(kg._canView(),true);
 const before=hooks.get('preDeleteNote');assert.equal(before(kg.document,{}),false);assert.equal(before(plain.document,{}),undefined);
 assert.equal(before(kg.document,{kgRealmsPlaceDelete:true}),undefined);assert.equal(before(kg.document,{kgRealmsPlaceMaintenance:true}),undefined);
});

test('the module deletion path authorizes removal and retains deletion bookkeeping and linked-scene cleanup',async()=>{
 fixture();const maps=new LocalMaps({}),steps=[];maps.rememberDeletedPlace=async()=>steps.push('remember');maps.unlinkScene=async()=>steps.push('unlink');
 const note={parent:{},getFlag:()=>({name:'Inn'}),delete:async options=>{assert.deepEqual(options,{kgRealmsPlaceDelete:true});steps.push('delete');}};
 await maps.deletePlace(note);assert.deepEqual(steps,['remember','delete','unlink']);game.user.isGM=false;await assert.rejects(maps.deletePlace(note),/Only a GM/);
});

test('Clear Notes removes ordinary notes while preserving protected places, including deleteAll requests',()=>{
 const hooks=new Map();globalThis.Hooks={on:(key,fn)=>hooks.set(key,fn)};class Note{}protectLocalPlaceNotes(Note);
 const places=[{id:'inn',getFlag:()=>({name:'Inn'})},{id:'journal',getFlag:()=>null},{id:'dock',getFlag:()=>({name:'Dock',entry:true})}];
 const options={},operation={deleteAll:true,ids:[]};
 for(const doc of places)if(hooks.get('preDeleteNote')(doc,options)!==false)operation.ids.push(doc.id);
 Object.assign(operation,options);
 // The server expands a remaining deleteAll flag regardless of filtered IDs.
 const removed=operation.deleteAll?places.map(p=>p.id):operation.ids;
 assert.equal(operation.deleteAll,false);assert.deepEqual(removed,['journal']);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {placeTarget, placeReference, placeToken, findPlaceLinks, insertPlaceToken, capturePlaceEditor} from '../scripts/place-links.mjs';

test('place references round-trip stable local and realm IDs, including encoded delimiters', () => {
  for (const ref of [{kind:'local',scene:'Neverwinter:scene',note:'inn-note'}, {kind:'realm',world:'toril',id:'uuid-123'}]) {
    assert.deepEqual(placeReference(placeTarget(ref)), ref);
  }
  for (const target of ['', 'local:a', 'local:a:b:c', 'Actor:a:b', 'local::b', 'realm:%xx:b']) assert.equal(placeReference(target), null);
  assert.equal(placeTarget({kind:'local',scene:'x'}),null);
  assert.equal(placeTarget({kind:'actor',scene:'a',note:'b'}),null);
  assert.equal(placeToken({kind:'local',scene:'s',note:'n'}, 'Iron {Flagon}\nInn'), '@Place[local:s:n]{Iron  Flagon  Inn}');
});

test('place search distinguishes duplicate names by map and ranks exact names before map matches', () => {
  const entries = [
    {name:'Iron Flagon Inn',where:'Inn: Neverwinter',ref:{kind:'local',scene:'s',note:'n'}},
    {name:'Iron Flagon Inn',where:'Inn: Luskan',ref:{kind:'local',scene:'l',note:'n'}},
    {name:'Neverwinter',where:'City: toril',ref:{kind:'realm',world:'toril',id:'nw'}},
    {name:'Iron Flagon',where:'Invalid',ref:{kind:'unknown'}}
  ];
  assert.equal(findPlaceLinks('iron flagon inn',entries).length,2);
  assert.equal(findPlaceLinks('neverwinter',entries)[0].name,'Neverwinter');
  assert.equal(findPlaceLinks('neverwinter',entries)[1].where,'Inn: Neverwinter');
  assert.equal(findPlaceLinks('iron',entries,1).length,1);
  assert.deepEqual(findPlaceLinks(' ',entries),[]);
});

test('place insertion replaces the ProseMirror selection in one undoable transaction', () => {
  let inserted, dispatched, focused=false;
  const tr={insertText(token,from,to){inserted={token,from,to};return this;},scrollIntoView(){return this;}};
  const view={state:{selection:{from:6,to:12},tr},dispatch(t){dispatched=t;},focus(){focused=true;}};
  assert.equal(insertPlaceToken(null,view,'@Place[local:s:n]{Inn}'),true);
  assert.deepEqual(inserted,{token:'@Place[local:s:n]{Inn}',from:6,to:12});
  assert.equal(dispatched,tr);
  assert.equal(focused,true);
  assert.equal(insertPlaceToken({tagName:'PROSE-MIRROR'},null,'token'),false,'unready editors must not lose content');
});

test('the textarea fallback uses the selection captured before the picker took focus', () => {
  const el={tagName:'TEXTAREA',value:'Before target after',setRangeText(t,a,b){this.value=this.value.slice(0,a)+t+this.value.slice(b);},dispatchEvent(e){this.event=e.type;},focus(){}};
  assert.equal(insertPlaceToken(el,null,'LINK',{start:7,end:13}),true);
  assert.equal(el.value,'Before LINK after');
  assert.equal(el.event,'input');
});

test('the documented ProseMirror plugin exposes its view and clears it on destruction', () => {
  globalThis.foundry={prosemirror:{Plugin:class{constructor(spec){this.spec=spec;}}}};
  try {
    const event={plugins:{}}, seen=[];
    capturePlaceEditor(event,v=>seen.push(v));
    const view={}, lifecycle=event.plugins.kgRealmsPlaceLinks.spec.view(view);
    lifecycle.destroy();
    assert.deepEqual(seen,[view,null]);
  } finally { delete globalThis.foundry; }
});

test('place choices include other local maps and preserve their stable references', async () => {
  const {registerKinds}=await import('../scripts/card-kinds.mjs');
  const make=(id,world)=>({id,name:id,getFlag:()=>({world,name:id}),notes:[{id:'inn',getFlag:()=>({name:'Iron Flagon Inn',category:'inn',visibility:'discovered'})}]});
  const scenes=[make('Neverwinter','toril'),make('Luskan','toril'),make('Other world','other')];
  scenes.get=id=>scenes.find(s=>s.id===id);
  globalThis.game={user:{isGM:true},scenes};
  try {
    const cards={register(){}},deps={realmPlaces:async()=>[{id:'nw',name:'Neverwinter',class:'City'}]};
    registerKinds(cards,deps);
    const entries=await cards.placeChoices({kind:'local',scene:'Neverwinter',note:'gate'});
    assert.equal(entries.length,3);
    assert.deepEqual(entries.find(e=>e.where.includes('Luskan')).ref,{kind:'local',scene:'Luskan',note:'inn'});
    assert.ok(entries.some(e=>e.ref.kind==='realm'));
  } finally { delete globalThis.game; }
});

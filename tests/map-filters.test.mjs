import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {LayersRail,chosenLayers} from '../scripts/ui-layers.mjs';
import {RealmLayer} from '../scripts/realm-layer.mjs';
import {sourceMapStyle} from '../scripts/source-map.mjs';

function storage(values={}) {
  const data=new Map(Object.entries(values));
  globalThis.localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
  return data;
}

test('map filters retain the previous single choice and recover from invalid saved values',()=>{
  const data=storage({'kgr-map-layer':'realms'});
  assert.deepEqual(chosenLayers(),['realms']);
  data.set('kgr-map-layers','bad JSON');assert.deepEqual(chosenLayers(),['realms']);
  data.set('kgr-map-layers','["geo","geo","places"]');assert.deepEqual(chosenLayers(),['places','geo']);
  data.set('kgr-map-layers','[]');assert.deepEqual(chosenLayers(),[]);
  data.clear();assert.deepEqual(chosenLayers(),['places']);
});

test('filter clicks toggle independently on both rendered maps and persist across remounts',()=>{
  const {window,document}=parseHTML('<html><body></body></html>');
  Object.assign(globalThis,{window,document,MutationObserver:class{disconnect(){}},ResizeObserver:class{disconnect(){}}});
  storage({'kgr-map-layers-open':'1'});
  const layer=new RealmLayer(),states=[{},{}];layer.ready=true;
  [layer.map,layer.labels]=states.map(state=>({isStyleLoaded:()=>true,setGlobalStateProperty:(k,v)=>state[k]=v}));
  const rail=new LayersRail({onChange:names=>layer.setMapLayers(names)});rail.mount();
  const click=k=>rail.el.querySelector(`[data-layer="${k}"]`).click();
  click('realms');click('geo');
  for(const state of states)assert.deepEqual(state.mapLayers,['places','realms','geo']);
  assert.equal(rail.el.querySelectorAll('[aria-pressed="true"]').length,3);
  click('realms');assert.deepEqual(chosenLayers(),['places','geo']);
  click('places');click('geo');assert.deepEqual(chosenLayers(),[]);
  for(const state of states)assert.deepEqual(state.mapLayers,[]);
  rail.setLayer('realms');rail.setLayer('places');assert.deepEqual(chosenLayers(),['places','realms']);
  rail.mount();assert.equal(rail.el.querySelectorAll('[aria-pressed="true"]').length,2);
  rail.el.querySelector('[data-fold]').click();
  assert.match(rail.el.querySelector('[data-fold]').getAttribute('data-tooltip'),/Places, Realms/);
  rail.unmount();
});

test('markers, territory shapes and names use membership in the active filters',()=>{
  const style=sourceMapStyle({tiles:{tapestry:'t',routes:'r'},glyphs:'g'});
  assert.deepEqual(style.state.mapLayers.default,['places']);
  const membership=JSON.stringify(['in',['get','layer'],['global-state','mapLayers']]);
  for(const id of ['poi-labels-local','poi-labels-regional','area-fill','area-line-realm','area-line-geo','area-names','area-line-names','place-glow']) {
    assert.ok(JSON.stringify(style.layers.find(l=>l.id===id).filter).includes(membership),id);
  }
  for(const id of ['roads','trails','journey-line'])assert.ok(!JSON.stringify(style.layers.find(l=>l.id===id).filter??[]).includes('mapLayers'),id);
});

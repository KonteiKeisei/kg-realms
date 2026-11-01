import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TravelHud} from '../scripts/ui-hud.mjs';
import {userChangeMatters} from '../scripts/authority.mjs';
import {gmGame, testScene} from './helpers/journey.mjs';

test('automatic port answers are remembered until the sea changes or the place moves',()=>{
  gmGame();globalThis.canvas={scene:testScene({})};
  const hud=new TravelHud({});let scans=0;hud.autoPort=()=>{scans++;return true;};
  const town={id:'a',kind:'settlement',lon:1,lat:2};
  hud.sea={};for(let i=0;i<50;i++)assert.equal(hud.isPort(town),true);
  assert.equal(scans,1);
  hud.isPort({...town,lon:1.5});assert.equal(scans,2,'a moved place is asked again');
  hud.sea={};hud.isPort(town);assert.equal(scans,3,'a rebuilt sea clears the answers');
  assert.equal(hud.isPort({...town,port:false}),false,"the GM's choice wins without a scan");
  assert.equal(scans,3);
});

test('only user changes that affect journeys wake the journey sync',()=>{
  for(const k of ['active','role','viewedScene','name'])assert.equal(userChangeMatters({[k]:1}),true,k);
  assert.equal(userChangeMatters({flags:{other:{x:1}}}),false);
  assert.equal(userChangeMatters({color:'#fff'}),false);
  assert.equal(userChangeMatters(undefined),false);
});

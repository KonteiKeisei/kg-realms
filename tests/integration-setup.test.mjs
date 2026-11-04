import test from 'node:test';
import assert from 'node:assert/strict';
import {INTEGRATIONS,installedIntegrations,integrationPlan,shouldPromptIntegrations,saveIntegrations,dismissIntegrations,integrationSetupContent,registerIntegrationSetup,promptIntegrations} from '../scripts/integration-setup.mjs';

const mod=(id,active=false,extra={})=>({id,title:id,active,version:'1.0.0',relationships:{requires:[],systems:[]},...extra});
function fixture(){
  const gm={id:'gm',isGM:true,can:()=>true},settings=new Map([['core.moduleConfiguration',{calendaria:true,unrelated:true,disabled:false}],['kg-realms.integrationSetup','pending']]);
  const events=[],writes=[],registered=[],menus=[];
  const modules=new Map([mod('calendaria',true),mod('tenacity'),mod('fxmaster'),mod('fxmaster-plus',false,{relationships:{requires:new Set([{id:'fxmaster',type:'module'}])}}),mod('unrelated',true)].map(m=>[m.id,m]));
  const game={user:gm,users:{activeGM:gm},modules,version:'13.351',system:{id:'dnd5e',version:'5.3.3'},socket:{emit:event=>events.push(event)},settings:{get:(m,k)=>settings.get(`${m}.${k}`),set:async(m,k,v)=>{writes.push([m,k,structuredClone(v)]);settings.set(`${m}.${k}`,structuredClone(v));},register:(m,k,v)=>registered.push([m,k,v]),registerMenu:(m,k,v)=>menus.push([m,k,v])}};
  globalThis.game=game;
  globalThis.foundry={utils:{escapeHTML:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),isNewerVersion:(a,b)=>{const x=String(a).split('.').map(Number),y=String(b).split('.').map(Number);for(let i=0;i<Math.max(x.length,y.length);i++){if((x[i]??0)!==(y[i]??0))return (x[i]??0)>(y[i]??0);}return false;},debouncedReload:()=>events.push('local-reload')},applications:{api:{ApplicationV2:class {constructor(){}render(){events.push('render');return Promise.resolve(this);}async _preFirstRender(){}async _onClose(){}async close(){events.push('close');}}}}};
  return {game,settings,events,writes,registered,menus};
}

test('discovery lists installed supported integrations, keeps Calendaria recommended and marks enabled rows',()=>{
  const {game}=fixture(),rows=installedIntegrations(game);
  assert.deepEqual(rows.map(m=>m.id),['calendaria','fxmaster','fxmaster-plus','tenacity']);
  assert.equal(rows[0].recommended,true);assert.equal(rows[0].active,true);
  assert.equal(rows.find(m=>m.id==='tenacity').active,false);
  const html=integrationSetupContent(game);
  assert.match(html,/Already Enabled/);assert.match(html,/Compatible\/integrated optionals/);
  assert.doesNotMatch(html,/value="calendaria"/);assert.match(html,/value="tenacity"/);
  assert.doesNotMatch(html,/checked/,'inactive integrations start unchecked');
  for(const label of ['Save and Reload','Maybe Later',"Don't Show Again"])assert.ok(html.includes(label));
});

test('automatic prompt belongs to the active GM, retries after Later and stays hidden after Save or Never',()=>{
  const {game,settings}=fixture();assert.equal(shouldPromptIntegrations(game),true);
  game.user={id:'player',isGM:false};assert.equal(shouldPromptIntegrations(game),false);
  game.user={id:'other-gm',isGM:true};assert.equal(shouldPromptIntegrations(game),false);
  game.user=game.users.activeGM;
  settings.set('kg-realms.integrationSetup','complete');assert.equal(shouldPromptIntegrations(game),false);
  settings.set('kg-realms.integrationSetup','never');assert.equal(shouldPromptIntegrations(game),false);
  settings.set('kg-realms.integrationSetup','pending');assert.equal(shouldPromptIntegrations(game),true);
  game.modules.clear();assert.equal(shouldPromptIntegrations(game),false);
});

test('startup stays silent when all six integrations are enabled; manual review remains available',async()=>{
  const {game,settings,events,writes,menus}=fixture();
  game.modules=new Map(INTEGRATIONS.map(({id})=>[id,mod(id,true)]));
  settings.set('core.moduleConfiguration',Object.fromEntries(INTEGRATIONS.map(({id})=>[id,true])));
  registerIntegrationSetup();
  assert.equal(shouldPromptIntegrations(game),false);
  await promptIntegrations();
  assert.deepEqual(events,[]);assert.deepEqual(writes,[]);
  assert.equal(settings.get('kg-realms.integrationSetup'),'pending','skipping does not dismiss later actionable setup');
  const app=new menus[0][2].type(),html=await app._renderHTML();
  assert.equal((html.match(/Already Enabled/g)??[]).length,6);
  assert.doesNotMatch(html,/type="checkbox"/);
  settings.set('core.moduleConfiguration',{});
  assert.equal(shouldPromptIntegrations(game),false,'runtime active flags also suppress an unnecessary prompt');
});

test('startup prompts only for an installed integration that can actually be enabled',()=>{
  const {game,settings}=fixture();
  game.modules=new Map([['calendaria',mod('calendaria',true)]]);
  assert.equal(shouldPromptIntegrations(game),false,'uninstalled integrations do not trigger setup');
  game.modules.set('tenacity',mod('tenacity',false,{compatibility:{minimum:'14'}}));
  game.modules.set('fxmaster-plus',mod('fxmaster-plus',false,{relationships:{requires:[{id:'fxmaster'}]}}));
  assert.equal(shouldPromptIntegrations(game),false,'incompatible or missing-dependency rows cannot offer activation');
  game.modules.set('fxmaster',mod('fxmaster'));
  assert.equal(shouldPromptIntegrations(game),true,'an eligible disabled integration triggers setup');
  settings.set('core.moduleConfiguration',{calendaria:true,fxmaster:true,'fxmaster-plus':true});
  assert.equal(shouldPromptIntegrations(game),false,'pending enabled configuration does not prompt for activation again');
});

test('save enables only selected integrations and required dependencies, preserves configuration and reloads after saving',async()=>{
  const {game,settings,events,writes}=fixture();
  const plan=integrationPlan(['fxmaster-plus','tenacity'],game);
  assert.deepEqual(plan.enable,['fxmaster','fxmaster-plus','tenacity']);
  assert.equal(settings.get('core.moduleConfiguration')['fxmaster-plus'],undefined,'planning never writes');
  await saveIntegrations(['fxmaster-plus','tenacity'],game);
  assert.deepEqual(settings.get('core.moduleConfiguration'),{calendaria:true,unrelated:true,disabled:false,fxmaster:true,'fxmaster-plus':true,tenacity:true});
  assert.equal(game.modules.get('tenacity').active,false,'runtime active flags are not mutated');
  assert.deepEqual(writes.map(w=>w.slice(0,2)),[['core','moduleConfiguration'],['kg-realms','integrationSetup']]);
  assert.deepEqual(events,['reload','local-reload']);assert.equal(settings.get('kg-realms.integrationSetup'),'complete');
});

test('save rechecks the latest core configuration and keeps other GMs changes',async()=>{
  const {game,settings}=fixture();installedIntegrations(game);
  settings.set('core.moduleConfiguration',{calendaria:true,unrelated:false,newlyEnabled:true});
  await saveIntegrations(['tenacity'],game);
  assert.deepEqual(settings.get('core.moduleConfiguration'),{calendaria:true,unrelated:false,newlyEnabled:true,tenacity:true});
});

test('missing, incompatible and cyclic required modules block activation without writes or reload',async()=>{
  const {game,writes,events}=fixture();game.modules.delete('fxmaster');
  assert.match(installedIntegrations(game).find(m=>m.id==='fxmaster-plus').issue,/not installed/);
  await assert.rejects(()=>saveIntegrations(['fxmaster-plus'],game),/not installed/);
  game.modules.set('fxmaster',mod('fxmaster',false,{compatibility:{minimum:'14'}}));
  assert.throws(()=>integrationPlan(['fxmaster-plus'],game),/incompatible/);
  game.modules.set('fxmaster',mod('fxmaster',false,{relationships:{requires:[{id:'fxmaster-plus'}]}}));
  assert.throws(()=>integrationPlan(['fxmaster-plus'],game),/cycle/);
  assert.deepEqual(writes,[]);assert.deepEqual(events,[]);
});

test('unsupported systems and required version ranges cannot be enabled',()=>{
  const {game}=fixture();
  game.modules.set('tenacity',mod('tenacity',false,{relationships:{systems:[{id:'other-system'}]}}));
  assert.throws(()=>integrationPlan(['tenacity'],game),/game system/);
  game.modules.set('fxmaster-plus',mod('fxmaster-plus',false,{relationships:{requires:[{id:'fxmaster',compatibility:{minimum:'2.0.0'}}]}}));
  assert.throws(()=>integrationPlan(['fxmaster-plus'],game),/different version/);
});

test('Never dismisses for the world without changing modules or reloading; manual review stays registered',async()=>{
  const {game,settings,events,writes,menus}=fixture();registerIntegrationSetup();
  assert.equal(menus[0][2].restricted,true);assert.equal(menus[0][2].label,'Review integrations');
  await dismissIntegrations(game);
  assert.equal(settings.get('kg-realms.integrationSetup'),'never');assert.equal(shouldPromptIntegrations(game),false);
  assert.deepEqual(writes.map(w=>w.slice(0,2)),[['kg-realms','integrationSetup']]);assert.deepEqual(events,[]);
  await saveIntegrations([],game);assert.equal(settings.get('kg-realms.integrationSetup'),'never','manual review does not undo Never');
});

test('write failures do not mark setup complete or reload',async()=>{
  const {game,settings,events}=fixture();game.settings.set=async()=>{throw Error('Cannot save');};
  await assert.rejects(()=>saveIntegrations(['tenacity'],game),/Cannot save/);
  assert.equal(settings.get('kg-realms.integrationSetup'),'pending');assert.deepEqual(events,[]);
});

test('player submissions and arbitrary modules are rejected',async()=>{
  const {game,writes}=fixture();
  assert.throws(()=>integrationPlan(['unrelated'],game),/Unknown/);
  game.user.isGM=false;
  await assert.rejects(()=>saveIntegrations(['tenacity'],game),/Only a GM/);
  await assert.rejects(()=>dismissIntegrations(game),/Only a GM/);assert.deepEqual(writes,[]);
});

test('Later closes the actual setup form without changing settings',async()=>{
  const {parseHTML}=await import('linkedom');
  const {game,settings,menus,writes,events}=fixture();registerIntegrationSetup();
  const app=new menus[0][2].type(),{document}=parseHTML('<html><body></body></html>');
  app.element=document.body;app.element.innerHTML=await app._renderHTML();app._onRender();
  app.element.querySelector('[data-integration-action="later"]').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(events.includes('close'));assert.deepEqual(writes,[]);assert.equal(settings.get('kg-realms.integrationSetup'),'pending');
  assert.equal(shouldPromptIntegrations(game),true);
});

test('the setup Save and Reload button submits its checked integrations',async()=>{
  const {parseHTML}=await import('linkedom'),f=fixture();registerIntegrationSetup();
  const app=new f.menus[0][2].type(),{document,Event}=parseHTML('<html><body></body></html>');
  app.element=document.body;app.element.innerHTML=await app._renderHTML();app._onRender();
  app.element.querySelector('[value="tenacity"]').setAttribute('checked','');
  app.element.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.settings.get('core.moduleConfiguration').tenacity,true);
  assert.equal(f.settings.get('kg-realms.integrationSetup'),'complete');
  assert.deepEqual(f.events,['reload','local-reload','close']);
});

test('the setup Never button suppresses future startup prompts without enabling checked modules',async()=>{
  const {parseHTML}=await import('linkedom'),f=fixture();registerIntegrationSetup();
  const app=new f.menus[0][2].type(),{document}=parseHTML('<html><body></body></html>');
  app.element=document.body;app.element.innerHTML=await app._renderHTML();app._onRender();
  app.element.querySelector('[value="tenacity"]').setAttribute('checked','');
  app.element.querySelector('[data-integration-action="never"]').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.settings.get('kg-realms.integrationSetup'),'never');
  assert.equal(f.settings.get('core.moduleConfiguration').tenacity,undefined);assert.deepEqual(f.events,['close']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {registerWorld} from '../scripts/worlds.mjs';
import {registerCompanionConfigurations,applyCompanionConfigurations,exportCalendariaSettings,configurationSnapshot,CALENDARIA_RECOMMENDATIONS} from '../scripts/companion-configuration.mjs';

function fixture({profile=null,choice=true,active=true}={}){
  const state=new Map(),registry=new Map(),hooks=new Map(),dialogs=[],downloads=[],writes=[],errors=[];
  const gm={id:'gm',isGM:true,can:()=>true};
  const setting=(namespace,key,value)=>{registry.set(`${namespace}.${key}`,{namespace,key,name:key,scope:'world'});state.set(`${namespace}.${key}`,structuredClone(value));};
  globalThis.Hooks={on:(key,fn)=>{hooks.set(key,fn);}};
  globalThis.foundry={utils:{getRoute:p=>p,escapeHTML:s=>String(s),saveDataToFile:(...args)=>downloads.push(args)},applications:{api:{DialogV2:{wait:async options=>{dialogs.push(options);return typeof choice==='function'?choice(options):choice;}}}}};
  globalThis.game={user:gm,users:{activeGM:gm},modules:new Map([['calendaria',{active}]]),i18n:{localize:s=>s},settings:{settings:registry,menus:new Map(),register:(namespace,key,config)=>{registry.set(`${namespace}.${key}`,config);if(!state.has(`${namespace}.${key}`))state.set(`${namespace}.${key}`,structuredClone(config.default));},get:(namespace,key)=>state.get(`${namespace}.${key}`),set:async(namespace,key,value)=>{writes.push([namespace,key,structuredClone(value)]);state.set(`${namespace}.${key}`,structuredClone(value));}}};
  globalThis.CALENDARIA={managers:{CalendarManager:{getActiveCalendar:()=>({metadata:{id:'calendar'}})}}};
  globalThis.ui={notifications:{info(){},error:message=>errors.push(message)}};
  globalThis.fetch=async()=>({ok:true,json:async()=>structuredClone(profile)});
  for(const [key,value] of CALENDARIA_RECOMMENDATIONS)setting('calendaria',key,value);
  setting('kg-realms','cityCarriageSound','');setting('calendaria','customWeatherPresets',[]);
  registerWorld({id:'configuration-test',module:'configuration-test',title:'Example world',...(profile?{configuration:{file:'configuration.json'}}:{})});
  registerCompanionConfigurations();hooks.get('calendaria.ready')();
  return {state,registry,dialogs,downloads,writes,errors,setting,hooks};
}

test('the native Calendaria exporter supplies the actual file and unrelated downloads are forwarded',async()=>{
  const f=fixture(),payload={version:'1.4.0',exportedAt:'date',settings:{customWeatherPresets:[{name:'Rain'}]},calendarData:{name:'Calendar'}};
  const blobs=new Map();class Anchor{dispatchEvent(){f.downloads.push(this.download);return true;}}globalThis.HTMLAnchorElement=Anchor;
  const originalFetch=fetch;globalThis.fetch=async url=>blobs.has(url)?{json:async()=>JSON.parse(blobs.get(url))}:originalFetch(url);
  foundry.utils.saveDataToFile=(data,mime,name)=>{const a=new Anchor();a.download=name;a.href=`blob:${name}`;blobs.set(a.href,data);a.dispatchEvent({type:'click'});};Object.freeze(foundry.utils);
  class Panel{static DEFAULT_OPTIONS={actions:{exportSettings:async()=>{
    foundry.utils.saveDataToFile('unrelated','text/plain','other.txt');
    foundry.utils.saveDataToFile(JSON.stringify(payload),'application/json','calendaria-settings-123.json');
  }}};}
  game.settings.menus.set('calendaria.settingsPanel',{type:Panel});const original=foundry.utils.saveDataToFile;
  assert.deepEqual(await exportCalendariaSettings(),payload);assert.equal(foundry.utils.saveDataToFile,original);assert.deepEqual(f.downloads,['other.txt']);assert.equal(Object.hasOwn(Anchor.prototype,'dispatchEvent'),true);
  Panel.DEFAULT_OPTIONS.actions.exportSettings=async()=>{throw Error('Native export failed');};
  await assert.rejects(()=>exportCalendariaSettings(),/Native export failed/);assert.equal(foundry.utils.saveDataToFile,original);
  Panel.DEFAULT_OPTIONS.actions.exportSettings=async()=>{};assert.equal(await exportCalendariaSettings(),null);assert.equal(foundry.utils.saveDataToFile,original);
});

test('the native settings payload stays intact and omitted requested technical values are carried beside it',()=>{
  const f=fixture(),native={version:'1.4.0',settings:{darknessSync:true,customWeatherPresets:[{name:'Storm'}]}};f.setting('calendaria','timeAdvanceInterval',15);
  const copy=structuredClone(native),snapshot=configurationSnapshot(native);assert.deepEqual(snapshot.calendaria,native);assert.equal(snapshot.calendariaTechnical.timeAdvanceInterval,15);assert.equal(snapshot.calendariaTechnical.darknessSync,undefined);assert.deepEqual(native,copy);
});

test('companion settings require consent, back up current values and do not overwrite later GM changes',async()=>{
  const profile={schema:1,engine:{cityCarriageSound:'modules/example/audio/carriage.ogg'},calendaria:{settings:{customWeatherPresets:[{name:'Storm'}]}},calendariaTechnical:{timeAdvanceInterval:30}};
  const f=fixture({profile});await applyCompanionConfigurations();
  assert.equal(f.dialogs.length,1);assert.match(f.dialogs[0].window.title,/world settings/);assert.equal(f.state.get('kg-realms.cityCarriageSound'),profile.engine.cityCarriageSound);assert.equal(f.state.get('calendaria.timeAdvanceInterval'),30);assert.deepEqual(f.state.get('calendaria.customWeatherPresets'),[{name:'Storm'}]);assert.ok(f.downloads[0][2].includes('before-import'));assert.equal(f.errors.length,0);
  f.state.set('kg-realms.cityCarriageSound','my.ogg');await applyCompanionConfigurations();assert.equal(f.state.get('kg-realms.cityCarriageSound'),'my.ogg');assert.equal(f.dialogs.length,1);
});

test('Keep my settings rejects the companion profile and avoids an immediate second recommendations prompt',async()=>{
  const f=fixture({profile:{schema:1,engine:{cityCarriageSound:'authored.ogg'}},choice:false});await applyCompanionConfigurations();await applyCompanionConfigurations();assert.equal(f.state.get('kg-realms.cityCarriageSound'),'');assert.equal(f.dialogs.length,1);assert.equal(f.state.get('kg-realms.calendariaRecommendations'),'kept');
});

test('recommendations never show when values match and selected changes leave other settings alone',async()=>{
  let f=fixture();await applyCompanionConfigurations();assert.equal(f.dialogs.length,0);assert.equal(f.state.get('kg-realms.calendariaRecommendations'),'satisfied');
  f=fixture({choice:()=>['darknessSync']});f.setting('calendaria','darknessSync',false);f.setting('calendaria','syncClockPause',false);await applyCompanionConfigurations();assert.equal(f.dialogs.length,1);assert.match(f.dialogs[0].content,/Daylight follows/);assert.equal(f.state.get('calendaria.darknessSync'),true);assert.equal(f.state.get('calendaria.syncClockPause'),false);await applyCompanionConfigurations();assert.equal(f.dialogs.length,1);
});

test('Later and player access do not change settings or import a companion configuration',async()=>{
  const f=fixture({profile:{schema:1,engine:{cityCarriageSound:'authored.ogg'}},choice:null});await applyCompanionConfigurations();await applyCompanionConfigurations();assert.equal(f.dialogs.length,1);assert.equal(f.state.get('kg-realms.cityCarriageSound'),'');assert.equal(f.state.get('kg-realms.companionConfiguration')['configuration-test'],undefined);
  game.user={id:'player',isGM:false};await applyCompanionConfigurations();assert.equal(f.dialogs.length,1);
});

test('an older Calendaria cannot silently mark unsupported exported settings as restored',async()=>{
  const f=fixture({profile:{schema:1,engine:{cityCarriageSound:'authored.ogg'},calendaria:{settings:{unavailableSetting:true}}}});
  await applyCompanionConfigurations();assert.equal(f.state.get('kg-realms.cityCarriageSound'),'');assert.equal(f.state.get('kg-realms.companionConfiguration')['configuration-test'],undefined);assert.ok(f.errors.some(message=>/Update Calendaria/.test(message)));assert.equal(f.dialogs.length,0);
});

test('carriage settings work without Calendaria and its profile can be imported after enabling it',async()=>{
  const f=fixture({active:false,profile:{schema:1,engine:{cityCarriageSound:'authored.ogg'},calendaria:{settings:{customWeatherPresets:[{name:'Storm'}]}}}});
  await applyCompanionConfigurations();assert.equal(f.state.get('kg-realms.cityCarriageSound'),'authored.ogg');assert.equal(f.state.get('kg-realms.companionConfiguration')['configuration-test'].calendaria,false);
  await applyCompanionConfigurations();assert.equal(f.dialogs.length,1);
  game.modules.get('calendaria').active=true;f.hooks.get('calendaria.ready')();await applyCompanionConfigurations();assert.equal(f.dialogs.length,2);assert.deepEqual(f.state.get('calendaria.customWeatherPresets'),[{name:'Storm'}]);
});

test('accepting a companion profile can select its calendar without rewinding time, and reload waits for settings',async()=>{
  const profile={schema:1,engine:{cityCarriageSound:'authored.ogg'},calendaria:{settings:{activeCalendar:'custom-exported'}}},f=fixture({profile});
  registerWorld({id:'configuration-test',module:'configuration-test',title:'Example world',configuration:{file:'configuration.json'},calendar:{file:'calendar.json',name:'Exported',signature:1}});
  globalThis.fetch=async url=>({ok:true,json:async()=>url.endsWith('calendar.json')?{id:'custom-exported',kind:'custom',name:'Exported',data:{}}:structuredClone(profile)});
  foundry.utils.deepClone=structuredClone;game.time={worldTime:100,set:async time=>{game.time.worldTime=time;}};
  let active='calendar',reloaded=false;
  CALENDARIA.managers.CalendarManager={getActiveCalendar:()=>({metadata:{id:active}}),getCalendar:()=>null,isCustomCalendar:()=>false,hasDefaultOverride:()=>false,createCustomCalendar:async id=>({metadata:{id}})};
  CALENDARIA.api={switchCalendar:async id=>{active=id;game.time.worldTime=0;return true;}};
  foundry.applications.settings={SettingsConfig:{reloadConfirm:async()=>{reloaded=true;assert.equal(f.state.get('kg-realms.cityCarriageSound'),'authored.ogg');}}};
  await applyCompanionConfigurations();assert.equal(active,'custom-exported');assert.equal(game.time.worldTime,100);assert.equal(reloaded,true);assert.equal(f.errors.length,0);assert.match(f.dialogs[0].content,/selects the companion calendar/);
});

import {allWorlds,worldUrl} from './worlds.mjs';
const ID='kg-realms',STATE='companionConfiguration',RECOMMENDATIONS='calendariaRecommendations';
const ENGINE_KEYS=['cityCarriageSound','cityWalkMph','cityCarriageMph','cityTransitRate','priceScale','seasonalSnow','dayStart','nightStart'];
const esc=value=>foundry.utils.escapeHTML(String(value??''));
const clone=value=>structuredClone(value);
const permitted=()=>!!(game.user?.isGM&&game.user===game.users?.activeGM&&(game.user.can?.('SETTINGS_MODIFY')??true));
let exporting=false,applying=null,calendariaReady=false,recommendationLater=false;
const laterProfiles=new Set();

/** Invoke Calendaria's actual settings exporter; do not maintain a second export whitelist. */
export async function exportCalendariaSettings(){
  if(!game.user?.isGM)throw Error('Only a GM can export Calendaria settings.');
  if(!game.modules.get('calendaria')?.active)return null;
  if(exporting)throw Error('A Calendaria settings export is already open.');
  const type=game.settings.menus?.get('calendaria.settingsPanel')?.type;
  const action=type?.DEFAULT_OPTIONS?.actions?.exportSettings;
  if(typeof action!=='function')throw Error('Calendaria does not expose its settings export action in this version. Update Calendaria before exporting the realm.');
  // Foundry freezes its utility namespace. Capture only this native download event;
  // leave saveDataToFile and unrelated downloads untouched.
  const proto=HTMLAnchorElement.prototype,descriptor=Object.getOwnPropertyDescriptor(proto,'dispatchEvent'),original=proto.dispatchEvent;
  let pending=null;
  const capture=function(event){
    if(exporting&&event?.type==='click'&&this.href?.startsWith('blob:')&&/^calendaria-settings-.*\.json$/.test(this.download??'')){
      pending=fetch(this.href).then(response=>response.json()).then(payload=>{
        if(!payload.settings||typeof payload.settings!=='object'||Array.isArray(payload.settings))throw Error('Calendaria returned an invalid settings export.');
        return payload;
      });return true;
    }
    return original.call(this,event);
  };
  exporting=true;
  try{Object.defineProperty(proto,'dispatchEvent',{value:capture,writable:true,configurable:true});await action.call(type,null,null);return pending?await pending:null;}
  finally{if(proto.dispatchEvent===capture){if(descriptor)Object.defineProperty(proto,'dispatchEvent',descriptor);else delete proto.dispatchEvent;}exporting=false;}
}

export function portableEngineSettings(){
  const settings={};for(const key of ENGINE_KEYS){
    try{if(game.settings.settings?.has(`${ID}.${key}`))settings[key]=clone(game.settings.get(ID,key));}catch{}
  }return settings;
}

export function configurationSnapshot(calendaria=null){
  const technical={};if(calendaria)for(const [key] of CALENDARIA_RECOMMENDATIONS){
    if(Object.hasOwn(calendaria.settings??{},key)||!game.settings.settings?.has(`calendaria.${key}`))continue;
    technical[key]=clone(game.settings.get('calendaria',key));
  }
  return {schema:1,engine:portableEngineSettings(),...(calendaria?{calendaria:clone(calendaria),calendariaTechnical:technical}:{})};
}

export const CALENDARIA_RECOMMENDATIONS=[
  ['darknessSync',true,'Sync scene darkness with time','Daylight follows the calendar during travel and watches.'],
  ['darknessSyncAllScenes',true,'Sync all scenes','Realm, Regional and local maps stay at the same time of day.'],
  ['darknessWeatherSync',true,'Weather affects darkness','Overcast skies and storms affect scene brightness.'],
  ['ambienceSync',true,'Sync ambience with weather','Scene lighting follows the active weather and climate.'],
  ['colorShiftSync',true,'Sync ambience with time of day','Dawn, daylight and dusk follow the calendar.'],
  ['darknessMoonSync',true,'Moon illumination','Night brightness follows the calendar moons.'],
  ['defaultBrightnessMultiplier',1.4,'Default brightness','Set the daylight brightness baseline; individual scenes can override it.'],
  ['ambienceIntensity',0,'Time of day hue intensity','Keep the time-of-day color tint neutral.'],
  ['weatherAmbienceIntensity',0,'Weather hue override','Keep weather from replacing the time-of-day color tint.'],
  ['timeSpeedMultiplier',1,'Game time per real second','Run the real-time clock at one game second per real second.'],
  ['timeSpeedIncrement','second','Real-time clock unit','Use seconds for the real-time clock rate.'],
  ['timeAdvanceInterval',60,'Clock update interval','Commit real-time clock changes once per minute.'],
  ['syncClockPause',true,'Sync clock with game pause','Pausing the game also pauses the real-time clock.'],
  ['clockRunDuringCombat',false,'Run real-time clock during combat','Keep the real-time clock stopped while combat controls time.'],
  ['advanceTimeOnRest',true,'Advance time on rest','Normal rests advance the calendar; KG Realms completed camp requests retain their already elapsed time.'],
  ['restAdvanceMode','fixed','Long rest advance mode','Use a fixed rest duration.'],
  ['restFixedHours',8,'Long rest hours','Advance eight hours for a normal long rest.'],
  ['shortRestAdvanceMode','fixed','Short rest advance mode','Use a fixed short-rest duration.'],
  ['shortRestFixedMinutes',60,'Short rest minutes','Advance sixty minutes for a normal short rest.']
];

export function calendariaRecommendationChanges(){
  return CALENDARIA_RECOMMENDATIONS.flatMap(([key,value,label,reason])=>{
    if(!game.settings.settings?.has(`calendaria.${key}`))return[];
    const before=game.settings.get('calendaria',key);return JSON.stringify(before)===JSON.stringify(value)?[]:[{key,value,before,label,reason}];
  });
}

async function backupSettings(entries,label){
  const data={kind:'kg-realms-settings-backup',createdAt:new Date().toISOString(),label,settings:entries.map(({namespace,key})=>({namespace,key,value:clone(game.settings.get(namespace,key))}))};
  await Promise.resolve(foundry.utils.saveDataToFile(JSON.stringify(data,null,2),'application/json','kg-realms-settings-before-import.json'));
}

export async function promptCalendariaRecommendations(){
  if(!permitted()||recommendationLater||!allWorlds().length||!game.modules.get('calendaria')?.active||game.settings.get(ID,RECOMMENDATIONS)!=='pending')return;
  const changes=calendariaRecommendationChanges();
  if(!changes.length){await game.settings.set(ID,RECOMMENDATIONS,'satisfied');return;}
  const display=value=>typeof value==='string'?value:JSON.stringify(value);
  const result=await foundry.applications.api.DialogV2.wait({window:{title:'KG Realms: Calendaria settings'},position:{width:650},rejectClose:false,
    content:`<p>We recommend these Calendaria settings for connected maps, travel and watches. Choose the changes to allow. Your other settings stay as they are.</p><div class="kgr-config-choices">${changes.map(c=>`<label class="kgr-config-choice"><input type="checkbox" name="calendaria-change" value="${esc(c.key)}" checked><span><strong>${esc(c.label)}</strong>: ${esc(display(c.before))} to ${esc(display(c.value))}<br><small>${esc(c.reason)}</small></span></label>`).join('')}</div>`,
    buttons:[{action:'apply',label:'Apply selected',default:true,callback:(_e,b)=>[...b.form.querySelectorAll('[name="calendaria-change"]:checked')].map(input=>input.value)},
      {action:'later',label:'Maybe later',callback:()=>null},{action:'keep',label:'Keep my settings',callback:()=>false}]});
  if(result===null||result===undefined){recommendationLater=true;return;}
  if(result!==false){const selected=changes.filter(c=>result.includes(c.key));if(selected.length)await backupSettings(selected.map(c=>({namespace:'calendaria',key:c.key})),'Calendaria recommendations');for(const c of selected)await game.settings.set('calendaria',c.key,c.value);}
  await game.settings.set(ID,RECOMMENDATIONS,result===false?'kept':'applied');
}

async function importConfiguration(world){
  if(laterProfiles.has(world.module))return;
  const state=clone(game.settings.get(ID,STATE)??{}),previous=state[world.module]??{};
  if(previous.kept||previous.engine&&previous.calendaria)return;
  if(previous.engine&&previous.calendaria===false&&!game.modules.get('calendaria')?.active)return;
  const response=await fetch(worldUrl(world.id,world.configuration.file),{cache:'no-store'});
  if(!response.ok)throw Error(`${world.title}: configuration could not be read (HTTP ${response.status}).`);
  const profile=await response.json();if(profile.schema!==1)throw Error(`${world.title}: unsupported configuration format.`);
  const calendarReady=game.modules.get('calendaria')?.active&&!!globalThis.CALENDARIA?.managers?.CalendarManager?.getActiveCalendar?.();
  const engine=previous.engine?{}:profile.engine??{},calendar=previous.calendaria||!calendarReady?{}:{...profile.calendaria?.settings,...profile.calendariaTechnical};
  const switchCalendar=!!(calendarReady&&world.calendar&&calendar.activeCalendar&&globalThis.CALENDARIA.managers.CalendarManager.getActiveCalendar()?.metadata?.id!==calendar.activeCalendar);
  const unavailable=Object.keys(calendar).filter(key=>key!=='activeCalendar'&&!game.settings.settings?.has(`calendaria.${key}`));
  if(unavailable.length)throw Error(`${world.title}: this Calendaria version cannot restore ${unavailable.join(', ')}. Update Calendaria before importing its settings.`);
  const entries=[...Object.entries(engine).filter(([key])=>ENGINE_KEYS.includes(key)).map(([key,value])=>({namespace:ID,key,value})),
    ...Object.entries(calendar).filter(([key])=>key!=='activeCalendar').map(([key,value])=>({namespace:'calendaria',key,value}))]
    .filter(entry=>game.settings.settings?.has(`${entry.namespace}.${entry.key}`));
  const changed=entries.filter(e=>JSON.stringify(game.settings.get(e.namespace,e.key))!==JSON.stringify(e.value));
  if(!changed.length&&!switchCalendar){
    state[world.module]={...previous,engine:true,calendaria:calendarReady||!profile.calendaria};await game.settings.set(ID,STATE,state);
    if(calendarReady&&profile.calendaria)await game.settings.set(ID,RECOMMENDATIONS,'imported');return;
  }
  const labels=changed.map(e=>{const config=game.settings.settings.get(`${e.namespace}.${e.key}`);return game.i18n?.localize?.(config?.name??e.key)??e.key;});
  if(switchCalendar)labels.push('Active calendar');
  const result=await foundry.applications.api.DialogV2.wait({window:{title:`${world.title}: world settings`},position:{width:620},rejectClose:false,
    content:`<p>This companion includes ${changed.length+(switchCalendar?1:0)} settings that differ from this world. Apply its carriage audio, travel configuration and available Calendaria settings?${switchCalendar?' This also selects the companion calendar.':''}</p><p>Calendaria settings come from its native Export Settings file. This is a one-time import. Later changes you make are kept.</p><details><summary>Settings to change</summary><ul>${labels.map(label=>`<li>${esc(label)}</li>`).join('')}</ul></details>${profile.calendaria&&!calendarReady?'<p>Enable Calendaria to import its settings later.</p>':''}`,
    buttons:[{action:'apply',label:'Apply companion settings',default:true,callback:()=>true},{action:'later',label:'Maybe later',callback:()=>null},{action:'keep',label:'Keep my settings',callback:()=>false}]});
  if(result===null||result===undefined){laterProfiles.add(world.module);recommendationLater=true;return;}
  if(result===false){state[world.module]={kept:true};await game.settings.set(ID,STATE,state);await game.settings.set(ID,RECOMMENDATIONS,'kept');return;}
  const calendarBackup=switchCalendar?['activeCalendar','customCalendars','defaultOverrides'].filter(key=>game.settings.settings?.has(`calendaria.${key}`)).map(key=>({namespace:'calendaria',key})):[];
  await backupSettings([...changed,...calendarBackup],world.title);
  let needReload=false;
  if(switchCalendar){const {applyModuleCalendars}=await import('./homebrew/export.mjs');const result=await applyModuleCalendars({worldId:world.id,force:true,reload:false});if(result?.failed)throw Error(`${world.title}: the companion calendar could not be restored.`);needReload=!!result?.needReload;}
  for(const entry of changed)await game.settings.set(entry.namespace,entry.key,clone(entry.value));
  state[world.module]={engine:true,calendaria:calendarReady||!profile.calendaria};await game.settings.set(ID,STATE,state);
  if(calendarReady&&profile.calendaria)await game.settings.set(ID,RECOMMENDATIONS,'imported');
  ui.notifications.info(`KG Realms: ${world.title}'s settings imported. Later changes will be kept.`);
  if(needReload)await foundry.applications.settings?.SettingsConfig?.reloadConfirm?.({world:true});
}

export function applyCompanionConfigurations(){
  if(!permitted())return Promise.resolve();
  if(game.modules.get('calendaria')?.active&&!calendariaReady)return Promise.resolve();
  if(applying)return applying;
  const work=(async()=>{
    let failed=false;
    for(const world of allWorlds().filter(w=>w.configuration&&w.sceneTemplates?.role!=='regional')){
      try{await importConfiguration(world);}catch(error){failed=true;console.error('kg-realms | companion settings',error);ui.notifications.error(`KG Realms: ${error.message}`);}
    }
    if(!failed)await promptCalendariaRecommendations();
  })();applying=work.finally(()=>{applying=null;});return applying;
}

export function registerCompanionConfigurations(){
  recommendationLater=false;laterProfiles.clear();calendariaReady=false;
  game.settings.register(ID,STATE,{scope:'world',config:false,type:Object,default:{}});
  game.settings.register(ID,RECOMMENDATIONS,{scope:'world',config:false,type:String,default:'pending'});
  Hooks.on('calendaria.ready',()=>{calendariaReady=true;});
  Hooks.on('canvasReady',()=>applyCompanionConfigurations().catch(error=>console.error('kg-realms | companion settings',error)));
}

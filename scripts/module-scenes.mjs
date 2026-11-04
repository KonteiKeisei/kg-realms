import {allWorlds,worldDef,worldUrl,registerWorld} from './worlds.mjs';
import {mergedSceneTemplates,selectedScenePlan,sceneTemplateCatalog} from './scene-template-plan.mjs';
import {restoreModuleRegionalMaps} from './homebrew/export.mjs';
import {regionalPlace} from './regional-place.mjs';

const ID='kg-realms', SETTING='sceneTemplateSetup', files=new WeakMap(), queues=new Map(), dialogs=new Map();
const esc=value=>foundry.utils.escapeHTML(String(value??''));
const values=collection=>Array.from(collection?.values?.()??collection??[]);
const permitted=()=>!!(game.user?.isGM&&(game.user.can?.('SETTINGS_MODIFY')??true));
const requireGM=()=>{if(!permitted())throw Error('Only a GM with settings permission can generate module maps.');};
export const templateWorlds=()=>allWorlds().filter(w=>w.sceneTemplates?.schema===1&&w.sceneTemplates.role!=='regional');
export const sceneTemplates=def=>mergedSceneTemplates(allWorlds().filter(w=>w.module===def.module&&w.sceneTemplates?.schema===1));

export function generatedScene(node) {
  const copies=values(game.scenes).filter(s=>s.getFlag?.(ID,'moduleScene')?.templateId===node.id);
  if(copies.length)return copies.at(-1);
  if(node.preset)return values(game.scenes).find(s=>s.getFlag?.(ID,'localMap')?.presetId===node.preset.id&&s.getFlag(ID,'localMap')?.world===node.world)??null;
  return game.scenes.get(node.id)??null;
}

async function readPack(world,type) {
  const pack=world.packs?.find(p=>p.type===type);if(!pack)return[];
  let cache=files.get(world);if(!cache)files.set(world,cache=new Map());
  if(!cache.has(pack.file))cache.set(pack.file,fetch(worldUrl(world.id,pack.file),{cache:'no-cache'}).then(async response=>{
    if(!response.ok)throw Error(`${world.title}: ${pack.file} could not be read (HTTP ${response.status}).`);
    const docs=await response.json();if(!Array.isArray(docs))throw Error(`Invalid ${type} templates for ${world.title}.`);return docs;
  }).catch(error=>{cache.delete(pack.file);throw error;}));
  return cache.get(pack.file);
}

async function snapshot(node) {
  const world=worldDef(node.sourceWorld);if(!world)throw Error(`The map package for ${node.name} is not enabled.`);
  const doc=(await readPack(world,'Scene')).find(s=>s._id===node.id);
  if(!doc)throw Error(`The packaged scene for ${node.name} is missing. Re-export its realm.`);
  return structuredClone(doc);
}

async function actorsFor(def,scene) {
  for(const token of scene.tokens??[]){
    if(!token.actorId||game.actors?.get(token.actorId))continue;
    let actor;
    for(const world of allWorlds().filter(w=>w.module===def.module)){actor=(await readPack(world,'Actor')).find(a=>a._id===token.actorId);if(actor)break;}
    if(!actor)throw Error(`${scene.name}: packaged actor ${token.actorId} is missing.`);
    requireGM();await getDocumentClass('Actor').create(structuredClone(actor),{keepId:true});
  }
  const related=[...new Set([scene.journal,...(scene.notes??[]).map(n=>n.entryId)].filter(Boolean))].map(id=>['JournalEntry',id,game.journal]);
  if(scene.playlist)related.push(['Playlist',scene.playlist,game.playlists]);
  for(const [type,id,collection] of related){
    if(collection?.get(id))continue;let document;
    for(const world of allWorlds().filter(w=>w.module===def.module)){document=(await readPack(world,type)).find(d=>d._id===id);if(document)break;}
    if(!document)throw Error(`${scene.name}: packaged ${type} ${id} is missing.`);
    requireGM();await getDocumentClass(type).create(structuredClone(document),{keepId:true});
  }
}
export async function prepareSceneDocuments(def,scene){requireGM();await actorsFor(def,scene);}

function relinkGeneratedScenes(def,data){
  const nodes=sceneTemplates(def),actual=id=>generatedScene(nodes.find(n=>n.id===id)??{id})?.id??id;
  const f=data.flags?.[ID];
  if(f?.returnTo?.scene)f.returnTo.scene=actual(f.returnTo.scene);
  if(typeof f?.localMap?.parent==='string')f.localMap.parent=actual(f.localMap.parent);
  else if(f?.localMap?.parent?.scene)f.localMap.parent.scene=actual(f.localMap.parent.scene);
  for(const note of data.notes??[]){const local=note.flags?.[ID]?.local;if(local?.scene)local.scene=actual(local.scene);}
  return data;
}

async function createTemplate(def,node,{includeTokens=true}={}) {
  const existing=generatedScene(node);if(existing)return existing;
  if(node.preset){
    const maps=game.modules.get(ID)?.api?.localMaps;if(!maps)throw Error('Local-map setup is not ready.');
    return (await maps.applyPreset(node.preset,{create:true,world:node.world}))?.scene;
  }
  const data=relinkGeneratedScenes(def,await snapshot(node));if(!includeTokens)data.tokens=[];
  await actorsFor(def,data);requireGM();
  const arrived=generatedScene(node);if(arrived)return arrived;
  // Suppress the legacy eager import. Only the selected scene and its ancestors are generated.
  const scene=await getDocumentClass('Scene').create(data,{keepId:true,kgRealmsSceneSetup:true});
  await restoreModuleRegionalMaps();return scene;
}

export async function generateSelectedScenes(def,selected,{includeTokens=true}={}) {
  requireGM();const nodes=sceneTemplates(def),plan=selectedScenePlan(nodes,selected);
  const previous=queues.get(def.module)??Promise.resolve();
  const work=previous.catch(()=>{}).then(async()=>{
    const scenes=[];
    for(const node of plan){requireGM();const scene=await createTemplate(def,node,{includeTokens});if(scene)scenes.push(scene);}
    await restoreModuleRegionalMaps();return scenes;
  });
  queues.set(def.module,work);try{return await work;}finally{if(queues.get(def.module)===work)queues.delete(def.module);}
}

/** Packaged scenes linked by a place keep the same identity on realm and Regional cards. */
export function templateForPlace(world,place,sceneId) {
  const def=worldDef(world);if(!def?.sceneTemplates)return null;
  return sceneTemplates(def).find(n=>!n.preset&&(sceneId&&(n.id===sceneId||generatedScene(n)?.id===sceneId)||n.bindings?.some(b=>b.world===(place.canonicalWorld??world)&&b.place===(place.canonicalId??place.id))))??null;
}

export async function generatePlaceScene(world,node) {
  const def=worldDef(world);if(!def)throw Error('The map package is not enabled.');
  await generateSelectedScenes(def,[node.id]);return generatedScene(node);
}

const typeLabel={realm:'Realm map',regional:'Regional map',local:'Local map',scene:'Scene'};
export function sceneChecklistContent(def,nodes=sceneTemplates(def)) {
  const branch=parent=>`<ul>${nodes.filter(n=>n.parent===parent).map(node=>{
    const existing=generatedScene(node),hasChildren=nodes.some(n=>n.parent===node.id);
    return `<li data-template-row="${esc(node.id)}"><label><input type="checkbox" name="scene-template" value="${esc(node.id)}" ${existing?'disabled':node.id===def.sceneTemplates.root?'checked':''}><span><strong>${esc(node.name)}</strong><small>${typeLabel[node.kind]??'Scene'}${node.places?` / ${node.places} places`:''}</small></span>${existing?'<em>Already generated</em>':''}</label>${existing&&['local','scene'].includes(node.kind)&&!node.preset?`<button type="button" data-regenerate="${esc(node.id)}">Regenerate copy</button>`:''}${hasChildren?branch(node.id):''}</li>`;
  }).join('')}</ul>`;
  return `<div class="kgr-scene-checklist"><p>Choose the maps to generate. Parent maps are included when needed. Existing scenes keep your edits.</p><div class="kgr-scene-selection"><button type="button" data-scene-select="all">Select all</button><button type="button" data-scene-select="none">Clear selection</button></div>${branch(null)}<label class="kgr-scene-tokens"><input type="checkbox" name="include-scene-tokens" checked> Include scene tokens</label><p>Untick Include scene tokens for maps without tokens. Maps left unselected remain available here and from their linked place cards.</p></div>`;
}

export function bindSceneChecklist(root,nodes,def) {
  const boxes=()=>[...root.querySelectorAll('input[name="scene-template"]')],byId=new Map(nodes.map(n=>[n.id,n]));
  root.querySelectorAll('[data-scene-select]').forEach(button=>button.addEventListener('click',()=>boxes().filter(b=>!b.disabled).forEach(b=>b.checked=button.dataset.sceneSelect==='all')));
  root.addEventListener('change',event=>{
    const box=event.target;if(box.name!=='scene-template')return;
    if(box.checked){for(let n=byId.get(byId.get(box.value)?.parent);n;n=byId.get(n.parent)){const parent=boxes().find(b=>b.value===n.id);if(parent&&!parent.disabled)parent.checked=true;}}
    else for(const child of boxes())for(let n=byId.get(child.value);n?.parent;n=byId.get(n.parent))if(n.parent===box.value){child.checked=false;break;}
  });
  root.querySelectorAll('[data-regenerate]').forEach(button=>button.addEventListener('click',async()=>{
    button.disabled=true;
    try{await regenerateSceneCopy(def,byId.get(button.dataset.regenerate));}catch(error){ui.notifications.error(`KG Realms: ${error.message}`);}finally{button.disabled=false;}
  }));
}

async function setupState(def,value) {
  requireGM();
  const state=structuredClone(game.settings.get(ID,SETTING)??{});state[def.module]=state[def.module]==='never'?'never':value;await game.settings.set(ID,SETTING,state);
}

export async function openSceneChecklist(def,{automatic=false}={}) {
  requireGM();if(!def?.sceneTemplates)return null;
  if(dialogs.has(def.module))return dialogs.get(def.module);
  const work=(async()=>{
    const nodes=sceneTemplates(def);if(!nodes.length)return null;
    if(automatic&&!nodes.some(n=>!generatedScene(n)))return null;
    const result=await foundry.applications.api.DialogV2.wait({window:{title:`${def.title}: generate maps`,icon:'fa-solid fa-map'},classes:['kgr-ui'],position:{width:640},content:sceneChecklistContent(def,nodes),rejectClose:false,
      render:(_event,dialog)=>bindSceneChecklist(dialog.element,nodes,def),buttons:[
        {action:'generate',label:'Generate selected',icon:'fa-solid fa-map',default:true,callback:(_event,button)=>({ids:[...button.form.querySelectorAll('[name="scene-template"]:checked:not(:disabled)')].map(b=>b.value),includeTokens:!!button.form.querySelector('[name="include-scene-tokens"]')?.checked})},
        {action:'later',label:'Later',callback:()=>null},
        {action:'never',label:"Don't show again",callback:()=>({never:true})}
      ]});
    if(!result)return null;if(result.never){await setupState(def,'never');return null;}
    const scenes=await generateSelectedScenes(def,result.ids,{includeTokens:result.includeTokens});
    await setupState(def,JSON.stringify(nodes.map(n=>n.id)));
    ui.notifications.info(`KG Realms: ${scenes.length} map${scenes.length===1?'':'s'} ready.`);return scenes;
  })();
  dialogs.set(def.module,work);try{return await work;}finally{dialogs.delete(def.module);}
}

export async function promptInstalledScenes() {
  if(!permitted()||game.user!==game.users?.activeGM)return;
  await adoptPackagedScenes();
  const state=game.settings.get(ID,SETTING)??{};
  for(const def of templateWorlds()){
    const nodes=sceneTemplates(def),signature=JSON.stringify(nodes.map(n=>n.id));
    if(state[def.module]==='never'||state[def.module]===signature)continue;
    try{await openSceneChecklist(def,{automatic:true});}catch(error){console.error('kg-realms | module maps',error);ui.notifications.error(`KG Realms: ${error.message}`);}
  }
}

/** Older exports already contain full snapshots. Discover their catalogue without a rebuild. */
export async function adoptPackagedScenes() {
  if(!game.user?.isGM)return;
  const indexes=new Map();
  for(const world of allWorlds().filter(w=>!w.sceneTemplates&&w.packs?.some(p=>p.type==='Scene'))){
    try{
      const docs=await readPack(world,'Scene'),response=await fetch(worldUrl(world.id,'index.json'),{cache:'no-cache'});
      if(!response.ok)throw Error(`${world.title}: index.json could not be read (HTTP ${response.status}).`);
      const index=await response.json(),link=allWorlds().flatMap(w=>w.regionalMaps?.links??[]).find(l=>l.world===world.id);indexes.set(world.id,index);
      const local=await fetch(worldUrl(world.id,'local/index.json'),{cache:'no-cache'});
      if(!local.ok&&local.status!==404)throw Error(`${world.title}: local/index.json could not be read (HTTP ${local.status}).`);
      const presets=local.ok?await local.json():[];
      const sceneTemplates=sceneTemplateCatalog(world.id,docs,index.places??[],{rootScene:link?.scene,parentScene:link?.parentScene,regional:!!link,presets});
      if(docs.length)registerWorld({...world,sceneTemplates});
    }catch(error){console.error('kg-realms | discovering packaged maps',error);ui.notifications.error(`KG Realms: ${error.message}`);}
  }
  for(const owner of allWorlds())for(const link of owner.regionalMaps?.links??[]){
    const node=worldDef(link.world)?.sceneTemplates?.scenes.find(n=>n.id===link.scene);
    const place=regionalPlace(link,indexes.get(link.parent)?.places??[]),id=place?.id??link.placeId;
    if(node&&id&&!node.bindings.some(b=>b.world===link.parent&&b.place===id))node.bindings.push({world:link.parent,place:id});
  }
}

export function registerSceneSetup() {
  game.settings.register(ID,SETTING,{scope:'world',config:false,type:Object,default:{}});
}

/** Regenerate a local map as a new linked copy, retaining the current scene as a backup. */
export async function regenerateSceneCopy(def,node) {
  requireGM();if(!['local','scene'].includes(node?.kind)||node.preset)throw Error('Choose a packaged local map or scene.');
  const choice=await foundry.applications.api.DialogV2.wait({window:{title:`Regenerate ${node.name}`},rejectClose:false,content:`<p>Create a fresh copy of ${esc(node.name)} from the module. The current scene stays available.</p><label><input type="checkbox" name="tokens"> Include scene tokens</label>`,buttons:[{action:'copy',label:'Generate and link new copy',callback:(_e,b)=>({includeTokens:!!b.form.querySelector('[name="tokens"]')?.checked})},{action:'cancel',label:'Cancel'}]});
  if(!choice||typeof choice!=='object')return null;
  requireGM();
  const maps=game.modules.get(ID)?.api?.localMaps;
  if(node.bindings?.length&&(!maps?.getRealmPlaces||!maps?.savePlaceEdit))throw Error('Local-map linking is not ready. Try again after the world finishes loading.');
  const previousIds=new Set([node.id,...values(game.scenes).filter(s=>s.getFlag?.(ID,'moduleScene')?.templateId===node.id).map(s=>s.id)]);
  const data=relinkGeneratedScenes(def,await snapshot(node)),id=foundry.utils.randomID();data._id=id;data.name=`${node.name} (regenerated)`;
  if(!choice.includeTokens)data.tokens=[];
  data.flags[ID].moduleScene={world:node.world,id,templateId:node.id};
  await actorsFor(def,data);requireGM();const scene=await getDocumentClass('Scene').create(data,{keepId:true,kgRealmsSceneSetup:true});
  for(const binding of node.bindings??[]){await maps.getRealmPlaces(binding.world);await maps.savePlaceEdit(binding.world,binding.place,{scene:scene.id});}
  for(const parent of values(game.scenes))for(const note of values(parent.notes))if(previousIds.has(note.getFlag?.(ID,'local')?.scene))await note.update({[`flags.${ID}.local.scene`]:scene.id});
  await scene.view();ui.notifications.info(`KG Realms: ${scene.name} is ready. The previous scene was kept.`);return scene;
}

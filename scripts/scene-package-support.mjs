const OPTIONAL_REGION_BEHAVIORS = new Set(['kg-the-other.kgRegion']);

export function hasOptionalSceneBehaviors(scenes) {
  return scenes.some(scene => scene.regions?.some(region =>
    region.behaviors?.some(behavior => OPTIONAL_REGION_BEHAVIORS.has(behavior.type))));
}

/** Module-defined Region behaviors need their provider even when the behavior is disabled. */
export function sceneBehaviorRequirements(scenes,{modules=globalThis.game?.modules,systemId=globalThis.game?.system?.id}={}){
  const required=new Map();
  for(const scene of scenes)for(const region of scene.regions??[])for(const behavior of region.behaviors??[]){
    const type=behavior.type??'',dot=type.indexOf('.');if(dot<1)continue;
    if(OPTIONAL_REGION_BEHAVIORS.has(type))continue;
    const id=type.slice(0,dot);if(['core','foundry','kg-realms',systemId].includes(id))continue;
    const provider=modules?.get?.(id);
    required.set(id,{id,type:'module',...(provider?.manifest?{manifest:provider.manifest}:{})});
  }
  return [...required.values()];
}

/** Keep every dependency needed by a child Regional bundle in the root manifest. */
export function mergedPackageRequirements(manifests){
  const required=new Map();
  for(const manifest of manifests)for(const dependency of manifest.relationships?.requires??[]){
    const previous=required.get(dependency.id);
    // A regional child can require a newer engine than the root scene, or vice versa.
    if(dependency.id==='kg-realms'&&previous?.compatibility?.minimum&&
      (!dependency.compatibility?.minimum||(previous.compatibility.minimum!==dependency.compatibility.minimum&&
        foundry.utils.isNewerVersion(previous.compatibility.minimum,dependency.compatibility.minimum))))continue;
    required.set(dependency.id,dependency);
  }
  return [...required.values()];
}

/** Preflight old exports before Foundry rejects their whole scene during construction. */
export function assertSceneBehaviors(scene,models=globalThis.CONFIG?.RegionBehavior?.dataModels){
  if(!models)return;
  const missing=[];
  for(const region of scene.regions??[])for(const behavior of region.behaviors??[]){
    if(models[behavior.type])continue;
    const type=String(behavior.type??'(no type)'),provider=type.includes('.')?type.split('.')[0]:null;
    missing.push(`Region "${region.name??region._id??'Unnamed'}": ${type}${provider?` (install or enable ${provider}, then reload)`:' (unsupported behavior type)'}`);
  }
  if(missing.length)throw Error(`${scene.name??scene._id}: ${missing.join('; ')}. The packaged scene was kept unchanged.`);
}

/** Keep the original scene template available for worlds with the optional model registered. */
export function prepareSceneBehaviors(scene, models=globalThis.CONFIG?.RegionBehavior?.dataModels) {
  assertSceneBehaviors(scene, models && {
    ...models, ...Object.fromEntries([...OPTIONAL_REGION_BEHAVIORS].map(type => [type, true]))
  });
  if (!models || !hasOptionalSceneBehaviors([scene])) return scene;
  return { ...scene, regions: scene.regions.map(region => ({
    ...region,
    ...(region.behaviors && { behaviors: region.behaviors.filter(behavior =>
      models[behavior.type] || !OPTIONAL_REGION_BEHAVIORS.has(behavior.type)) })
  })) };
}

/** Realm overview at root; Regional overviews together; towns and their interiors together. */
export function moduleSceneFolderPath(nodes,node){
  if(node.kind==='realm')return [];
  if(node.kind==='regional')return ['Regional Maps'];
  const byId=new Map(nodes.map(n=>[n.id,n])),seen=new Set();let place=null,top=node;
  for(let current=node;current&&!seen.has(current.id);current=byId.get(current.parent)){
    seen.add(current.id);if(['realm','regional'].includes(current.kind))break;
    top=current;if(current.kind==='local'||current.placeId||current.bindings?.length)place=current;
  }
  return ['Places',(place??top).name??'Unnamed place'];
}

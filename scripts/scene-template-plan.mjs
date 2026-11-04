const ID = 'kg-realms';
export const parentSceneId = value => typeof value === 'string' ? value : value?.scene ?? null;

function hierarchyTree(nodes,roots,keepExternal=false){
  const byId=new Map(nodes.map(n=>[n.id,n]));
  for(const node of nodes){
    if(node.parent===node.id||!keepExternal&&!byId.has(node.parent))node.parent=null;
    const seen=new Set([node.id]);let next=byId.get(node.parent);
    while(next){if(seen.has(next.id)){
      // Linked rooms can point at one another. Their checklist needs a tree; their scene links stay intact.
      const root=roots.get(node.world);node.parent=root&&!seen.has(root)&&byId.has(root)?root:null;break;
    }seen.add(next.id);next=byId.get(next.parent);}
  }
  return nodes;
}

/** A hierarchy of complete scene snapshots, derived from authored links rather than place names. */
export function sceneTemplateCatalog(world, scenes, places, {rootScene, parentScene, regional = false, presets = []} = {}) {
  const maps = scenes.filter(s => s.flags?.[ID]?.world === world);
  const root = maps.find(s => s._id === rootScene) ?? maps.find(s => (s.flags[ID].level ?? 'surface') === 'surface') ?? maps[0];
  const byWorld = new Map(maps.map(s => [s.flags[ID].world, s._id]));
  const children = new Map();
  for (const scene of scenes) for (const note of scene.notes ?? []) {
    const target = note.flags?.[ID]?.local?.scene;
    if (target && target !== scene._id && !children.has(target)) children.set(target, scene._id);
  }
  const nodes = scenes.map(scene => {
    const f = scene.flags?.[ID] ?? {}, local = f.localMap;
    const bindings = places.filter(p => p.scene === scene._id).map(p => ({world, place: p.id}));
    return {id:scene._id, name:scene.name, world:f.world ?? local?.world ?? world, sourceWorld:world,
      kind:f.world ? (regional || f.regionalMap ? 'regional' : 'realm') : local ? 'local' : 'scene',
      parent:scene._id === root?._id ? parentScene ?? null : parentSceneId(local?.parent) ?? f.returnTo?.scene ?? children.get(scene._id) ?? byWorld.get(local?.world) ?? root?._id ?? null,
      placeId:local?.placeId ?? bindings[0]?.place ?? null, places:(scene.notes ?? []).filter(n => n.flags?.[ID]?.local).length, bindings};
  });
  for (const entry of presets) if (!nodes.some(n => n.placeId === entry.placeId && n.kind === 'local')) {
    nodes.push({id:`preset:${world}:${entry.id}`,name:entry.name,world,sourceWorld:world,kind:'local',parent:root?._id ?? null,placeId:entry.placeId,places:entry.places ?? 0,preset:entry,bindings:entry.placeId?[{world,place:entry.placeId}]:[]});
  }
  return {schema:1, role:regional?'regional':'realm', root:root?._id ?? null, scenes:hierarchyTree(nodes,new Map([[world,root?._id]]),true)};
}

/** Deduplicate snapshots shared by realm and Regional bundles, retaining their actual map parent. */
export function mergedSceneTemplates(worlds) {
  const nodes = new Map(), roots = new Map();
  for (const world of worlds) if (world.sceneTemplates?.schema === 1) {
    if (world.sceneTemplates.root) roots.set(world.id, world.sceneTemplates.root);
    for (const node of world.sceneTemplates.scenes ?? []) {
      const old = nodes.get(node.id);
      if (!old) nodes.set(node.id,{...node, bindings:[...(node.bindings ?? [])]});
      else {
        for (const binding of node.bindings ?? []) if (!old.bindings.some(b=>b.world===binding.world&&b.place===binding.place)) old.bindings.push(binding);
        if (node.world === world.id) Object.assign(old,{...node,bindings:old.bindings});
      }
    }
  }
  for (const node of nodes.values()) {
    if (node.kind === 'local' && !node.preset && roots.has(node.world) && !nodes.get(node.parent)?.kind?.match(/^(local|scene)$/)) node.parent = roots.get(node.world);
    if (node.parent === node.id || !nodes.has(node.parent)) node.parent = null;
  }
  return hierarchyTree([...nodes.values()],roots);
}

export function selectedScenePlan(nodes, selected) {
  const byId=new Map(nodes.map(n=>[n.id,n])), result=[], seen=new Set();
  const add=id=>{if(seen.has(id))return;const node=byId.get(id);if(!node)throw Error(`Unknown scene selection: ${id}.`);seen.add(id);if(node.parent)add(node.parent);result.push(node);};
  for(const id of selected)add(id);
  return result;
}

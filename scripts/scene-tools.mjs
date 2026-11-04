/** Keep scene settings available even before a scene has been converted to a KG Realms map. */
export function sceneEditorTools(controls,{scene,isGM,realm=false,local=false,active=false,edit,configure}){
  if(!scene||!isGM||!controls.tokens)return;
  const tools=controls.tokens.tools;
  tools.kgRealmsSceneConfig={name:'kgRealmsSceneConfig',title:'Edit Scene: background, grid and scene settings',icon:'fa-solid fa-gear',order:99,button:true,onChange:()=>configure(scene)};
  if(!realm&&!local)return;
  tools.kgRealmsEditor={name:'kgRealmsEditor',title:local?'Map editor: local places and linked scenes (E)':'Map editor: places, roads, encounters (E)',icon:'fa-solid fa-pen-ruler',order:102,toggle:true,active,onChange:(_event,on)=>edit(on)};
}

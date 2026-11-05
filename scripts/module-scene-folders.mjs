import {moduleSceneFolderPath} from './scene-package-support.mjs';

const ID='kg-realms',REVISION=1;
let queue=Promise.resolve();
const values=collection=>[...(collection?.values?.()??[])];
const folderId=folder=>folder?.id??folder??null;

/** Reuse exact Scene-folder paths, including a GM's existing Places folder. */
export async function packagedSceneFolderData(def,nodes,node){
  if(!game.folders)return {};
  const work=queue.catch(()=>{}).then(async()=>{
    let parent=null;
    for(const name of moduleSceneFolderPath(nodes,node)){
      let folder=values(game.folders).find(f=>f.type==='Scene'&&f.name===name&&folderId(f.folder)===parent);
      if(!folder){
        folder=await getDocumentClass('Folder').create({name,type:'Scene',folder:parent,sorting:'a',flags:{[ID]:{moduleSceneFolder:true}}});
        if(!folder?.id)throw Error(`Could not create the Scene folder "${name}".`);
      }
      parent=folder.id;
    }
    return {folder:parent,marker:{module:def.module,revision:REVISION}};
  });
  queue=work;return work;
}

/** Arrange previously imported package scenes once, then preserve the GM's later folder moves. */
export async function organizePackagedScene(def,nodes,node,scene){
  if(!scene?.update||!game.folders)return scene;
  const own=scene.getFlag?.(ID,'moduleScene')??scene.flags?.[ID]?.moduleScene;
  if(!own&&!node.preset)return scene;
  if(own&&own.world!==node.world&&own.world!==node.sourceWorld)return scene;
  const marker=scene.getFlag?.(ID,'moduleFolder')??scene.flags?.[ID]?.moduleFolder;
  if(marker?.module===def.module&&marker.revision>=REVISION)return scene;
  const placement=await packagedSceneFolderData(def,nodes,node);
  await scene.update({folder:placement.folder,[`flags.${ID}.moduleFolder`]:placement.marker});
  return scene;
}

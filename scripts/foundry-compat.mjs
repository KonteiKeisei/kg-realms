/** Use the native scene menu entry contract for each supported Foundry generation. */
export function sceneContextEntry(entry){
  if((globalThis.game?.release?.generation??13)<14)return entry;
  const {name,condition,callback,...rest}=entry;
  return {...rest,label:name,visible:condition,onClick:(event,target)=>callback(target,event)};
}

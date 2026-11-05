import {scanFiles,cardFolder,sceneFolder,packFolder,sceneLinks,uuidsIn,uuidParts} from './export-plan.mjs';

const ID='kg-realms';
const labels={JournalEntry:'Journal',RollTable:'Roll table',tiles:'Tile',tokens:'Token',notes:'Note',walls:'Wall',lights:'Light',sounds:'Sound',items:'Item',pages:'Page',results:'Result',cards:'Card',places:'Place'};
const quoted=value=>JSON.stringify(String(value));
const label=(type,doc)=>`${labels[type]??type}${doc.name?` ${quoted(doc.name)}`:''}${doc._id||doc.id?` [${doc._id??doc.id}]`:''}`;
const keyOf=uuid=>{const {type,id}=uuidParts(uuid);return `${type}.${id}`;};

/** Attribute linked documents to their scenes without following links into other scenes. */
function sceneSources(groups,systemId,extraRoots=[]){
  const docs=new Map([...groups].flatMap(([type,list])=>list.map(doc=>[`${type}.${doc._id}`,doc]))),sources=new Map();
  const edges=new Map([...docs].map(([key,doc])=>[key,[...uuidsIn(doc,systemId)].map(keyOf)]));
  const roots=(groups.get('Scene')??[]).map(scene=>({owners:[label('Scene',scene)],links:[...sceneLinks(scene),...uuidsIn(scene,systemId)]}));
  for(const {owners,links} of [...roots,...extraRoots]){
    const seen=new Set(),queue=links.map(keyOf);
    while(queue.length){
      const key=queue.pop();if(seen.has(key)||key.startsWith('Scene.')||!docs.has(key))continue;
      seen.add(key);if(!sources.has(key))sources.set(key,new Set());for(const owner of owners)sources.get(key).add(owner);
      queue.push(...(edges.get(key)??[]));
    }
  }
  return sources;
}

function fieldLocation(value,path){
  let current=value;const embedded=[];
  for(let i=0;i<path.length;i++){
    const key=path[i];current=current?.[key];
    if(typeof key!=='number'||!current||typeof current!=='object')continue;
    const kind=labels[path[i-1]];
    if(kind){const name=current.name??(path[i-1]==='notes'?current.text:undefined);embedded.push({collection:path[i-1],index:key,id:current._id??current.id??null,name:name??null,label:label(kind,{...current,name})});}
  }
  const field=path.map((key,i)=>typeof key==='number'?`[${key}]`:`${i?'.':''}${key}`).join('')||'(value)';
  return {field,embedded,value:current,label:`${field}${embedded.length?` (${embedded.map(e=>e.label).join('; ')})`:''}`};
}

/** Keep every use of a path, even when the file itself is copied just once. */
export function collectExportFiles(groups,files,markers,{title,world,calendar,systemId='',aliases=new Map()}={}){
  const named=new Map(),usage=new Map(),locations=new Map();
  const sourceUuids=new Map();for(const [alias,key] of aliases){if(!sourceUuids.has(key))sourceUuids.set(key,[]);sourceUuids.get(key).push(alias);}
  const maps=(groups.get('Scene')??[]).filter(s=>s.flags?.[ID]?.world===world).map(s=>label('Scene',s));
  const scenes=sceneSources(groups,systemId,[{owners:maps,links:[...uuidsIn([...files.values()],systemId)]}]);
  const scan=(value,folder,owner,usedBy=[],source={})=>scanFiles(value,folder,named,(raw,path)=>{
    const site=fieldLocation(value,path),description=`${owner}: ${site.label}${usedBy.length?`\n        Referenced from: ${usedBy.join(', ')}`:''}`;
    if(!usage.has(raw))usage.set(raw,new Set());
    if(usage.get(raw).has(description))return;
    usage.get(raw).add(description);
    if(!locations.has(raw))locations.set(raw,[]);
    locations.get(raw).push({world,owner,...source,path:[...path],field:site.field,embedded:site.embedded,value:site.value,referencedFrom:[...usedBy]});
  });
  const realm=`Realm ${quoted(title??world??'Unnamed')}`;
  if(calendar)scan(calendar,()=> 'assets/calendar',`${realm}, calendar.json`,maps,{kind:'world-file',file:'calendar.json'});
  for(const [rel,value] of files){
    if(rel==='calendar.json'&&calendar)continue;
    scan(rel==='index.json'?{...value,terrain:undefined}:value,cardFolder,`${realm}, ${rel}`,maps,{kind:'world-file',file:rel});
  }
  scan(markers,cardFolder,`${realm}, custom markers`,maps,{kind:'setting',namespace:ID,setting:'customMarkers'});
  for(const [type,list] of groups)for(const doc of list){
    const uuid=`${type}.${doc._id}`;
    scan(doc,type==='Scene'?sceneFolder:packFolder(type),label(type,doc),[...(scenes.get(uuid)??[])],{kind:'document',documentType:type,documentId:doc._id,documentName:doc.name??null,uuid,sourceUuids:sourceUuids.get(uuid)??[]});
  }
  return{named,usage,locations};
}

export function exportFileProblem(raw,error,usage){
  const locations=[...(usage.get(raw)??[])];
  return `${raw}: ${error}${locations.length?`\n      ${locations.join('\n      ')}`:''}`;
}

/** Save failed field values and their locations, without embedding the module ZIP. */
export function exportRepairReport(built,options,engineVersion){
  return{schema:1,kind:'kg-realms-export-repair',scope:'selected-export-copy',createdAt:new Date().toISOString(),engineVersion,export:structuredClone(options),problemCount:built.problems,report:built.report,worlds:structuredClone(built.diagnostics??[])};
}

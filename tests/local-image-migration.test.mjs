import "./helpers/worlds.mjs";
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {localAssetEdits} from '../scripts/local-places.mjs';
import {LocalMaps} from '../scripts/local-maps.mjs';

test('image migration changes only matching artwork and preserves secrets, prose and unrelated links',()=>{
  const source='old%20world/hok.webp',target='modules/kg-realms/assets/poi-img/House%20of%20Knowledge.webp';
  const known='<section class="secret" id="keep"><p>My notes</p><a href="old world/hok.webp">Reference</a><img src="old world/hok.webp" width="500"><img src="custom.webp"></section>';
  const result=localAssetEdits({known,img:source,images:[source,'custom.webp']},{[source]:target});
  assert.equal(result.known,known.replace('src="old world/hok.webp"','src="'+target+'"'));
  assert.equal(result.img,target);assert.deepEqual(result.images,[target,'custom.webp']);
  assert.deepEqual(localAssetEdits({known:'<p>Custom text</p>',img:'custom.webp'},{[source]:target}),{});
});

test('upgrading a written local card replaces its broken embedded source without replacing its text or pin',async()=>{
  const old={game:globalThis.game,foundry:globalThis.foundry,fetch:globalThis.fetch};
  const text='<section class="secret"><p>GM rewrite</p><img src="old.webp"></section>',record={name:'Temple',known:text,gmNotes:'Private',img:'custom.webp'};
  const note={id:'n',x:42,y:63,getFlag:()=>record},updates=[];
  const scene={name:'City',notes:[note],getFlag:()=>({unplaced:[]}),async setFlag(){},async updateEmbeddedDocuments(t,rows){updates.push(...rows)}};
  try{
    globalThis.game={user:{isGM:true}};globalThis.foundry={utils:{getRoute:p=>p}};
    globalThis.fetch=async()=>({json:async()=>({name:'City',places:[{name:'Temple',known:'Default text'}],unplaced:[],assetReplacements:{'old.webp':'modules/kg-realms/assets/poi-img/Temple.webp'}})});
    const maps=new LocalMaps({getRealmPlaces:async()=>[]});maps.ensureEntrance=async()=>{};
    await maps.applyPreset({file:'city.json',revision:6},{scene});
    assert.deepEqual(updates,[{_id:'n','flags.kg-realms.local.known':text.replace('old.webp','modules/kg-realms/assets/poi-img/Temple.webp')}]);
    assert.equal(note.x,42);assert.equal(note.y,63);assert.equal(record.img,'custom.webp');assert.equal(record.gmNotes,'Private');
  }finally{Object.assign(globalThis,old);}
});

test('both supplied images are bundled and every embedded Neverwinter image uses a module path',()=>{
  const preset=JSON.parse(readFileSync(new URL('../data/worlds/toril/local/neverwinter.json',import.meta.url),'utf8'));
  const names=['House of Knowledge.webp','Hall of Justice.webp'];
  for(const name of names)assert.ok(readFileSync(new URL('../assets/poi-img/'+name,import.meta.url)).length>0);
  const refs=preset.places.flatMap(p=>[...p.known.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map(m=>m[1]));
  assert.equal(refs.length,2);assert.ok(refs.every(src=>src.startsWith('modules/kg-realms-faerun/assets/poi-img/')));
});

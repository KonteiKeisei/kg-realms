import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PartyManager} from '../scripts/party-manager.mjs';
import {groupMembers,memberRows,rosterStamp,familyActors,partyScene,focusedScene,journeyScenes} from '../scripts/party-groups.mjs';
import {portraitLayout,PortraitCache,PartyInterface} from '../scripts/party-ui.mjs';
import {writeJourney} from '../scripts/journey-write.mjs';
import {gmGame} from './helpers/journey.mjs';
const copy=structuredClone;
function put(obj,path,value){const keys=path.split('.');for(const k of keys.slice(0,-1))obj=obj[k]??={};obj[keys.at(-1)]=copy(value);}
function collection(list=[]){list.get=id=>list.find(x=>x.id===id);return list;}
function setup(){
 const actors=collection();let serial=0,failToken=false,failBatch=false;
 const makeActor=data=>{const raw={items:[],ownership:{default:3},prototypeToken:{},...copy(data)};
 const a={id:raw._id??`a${serial++}`,type:raw.type,get name(){return raw.name},get img(){return raw.img},get ownership(){return raw.ownership},get system(){return{...raw.system,members:raw.type==='group'?raw.system.members.map(r=>({...r,actor:actors.get(r.actor)})):undefined}},getFlag:(m,k)=>raw.flags?.[m]?.[k],toObject:()=>copy(raw),async delete(){actors.splice(actors.indexOf(a),1);},raw};actors.push(a);return a;};
 const members=Array.from({length:6},(_,i)=>makeActor({_id:`pc${i}`,name:`Member ${i}`,type:i===5?'npc':'character',img:'x.webp',system:{currency:{gp:20}}}));
 const root=makeActor({_id:'root',name:'Wardens',type:'group',img:'root.webp',system:{members:members.map(a=>({actor:a.id})),currency:{gp:4}},items:[{name:'Shared tent'}]});
 const scene={id:'map',grid:{size:100},dimensions:{sceneX:0,sceneY:0,sceneWidth:2000,sceneHeight:2000},tokens:collection(),flags:{'kg-realms':{journey:{name:'Old route',trip:{departed:4},now:{status:'moving'}}}},getFlag(m,k){return k.split('.').reduce((o,key)=>o?.[key],this.flags[m]);},async setFlag(m,k,v){put(this.flags,`${m}.${k}`,v);},async update(patch){for(const [k,v]of Object.entries(patch))put(this,k,v);},async updateEmbeddedDocuments(type,updates){for(const u of updates){const t=this.tokens.get(u._id);if(!t)throw Error('Missing token');Object.assign(t,u);}},async deleteEmbeddedDocuments(type,ids){for(const id of ids){const t=this.tokens.get(id);this.tokens.splice(this.tokens.indexOf(t),1);}},async createEmbeddedDocuments(type,rows){if(failToken)throw Error('Token failure');return rows.map(makeToken);}};
 function makeToken(data){const t={...copy(data),id:data._id??`t${serial++}`,parent:scene,get actor(){return actors.get(this.actorId)},toObject(){return{actorId:this.actorId,actorLink:true,name:this.name,width:1,height:1,x:this.x,y:this.y,texture:{src:'party.webp'},flags:this.flags??{}}}};scene.tokens.push(t);return t;}
 const token=makeToken({actorId:root.id,actorLink:true,name:'Wardens',width:1,height:1,x:100,y:100});
 gmGame({actors,scenes:collection([scene])});globalThis.foundry={utils:{deepClone:copy}};
 globalThis.Actor={create:async data=>makeActor(data),updateDocuments:async updates=>{for(const [i,u]of updates.entries()){const a=actors.get(u._id);if(!a)throw Error('Missing actor');for(const [k,v]of Object.entries(u))if(k!=='_id')put(a.raw,k,v);if(failBatch&&i===0){failBatch=false;throw Error('Lost actor response');}}}};
 const manager=new PartyManager();const split=(left=token,ids=['pc4','pc5'])=>manager.commit({scene,left,rightIds:ids,stamp:rosterStamp(familyActors(left.actor))});
 return{actors,members,root,scene,token,manager,split,setFailToken:v=>failToken=v,setFailBatch:v=>failBatch=v};
}
test('split creates linked numbered groups, moves PC and NPC memberships, and preserves inventories',async()=>{
 const f=setup(),r=await f.split();assert.equal(f.root.name,'Wardens 1');assert.equal(f.token.name,'Wardens 1');assert.equal(r.token.name,'Wardens 2');assert.equal(r.token.actorLink,true);
 assert.deepEqual(groupMembers(f.root).map(a=>a.id),['pc0','pc1','pc2','pc3']);assert.deepEqual(groupMembers(r.actor).map(a=>a.id),['pc4','pc5']);
 assert.deepEqual(f.root.raw.items,[{name:'Shared tent'}]);assert.deepEqual(r.actor.raw.items,[]);assert.equal(f.members[5].raw.system.currency.gp,20);
 assert.equal(f.scene.getFlag('kg-realms','partyJourneys').root.name,'Old route');
});
test('multiple splits can merge through one two-sided pool; the original identity loses its suffix',async()=>{
 const f=setup(),two=await f.split(),three=await f.split(two.token,['pc5']);assert.equal(three.token.name,'Wardens 3');
 await f.manager.commit({scene:f.scene,left:f.token,right:two.token,extra:[three.token],rightIds:[],stamp:rosterStamp(familyActors(f.root))});
 assert.equal(f.scene.tokens.length,1);assert.equal(f.token.name,'Wardens');assert.equal(f.root.name,'Wardens');assert.equal(groupMembers(f.root).length,6);assert.equal(familyActors(f.root).length,1);assert.equal(two.actor.getFlag('kg-realms','party').retired,true);
});
test('stale rosters, duplicate membership and active travel are rejected before mutation',async()=>{
 const f=setup(),stamp=rosterStamp(familyActors(f.root));f.root.raw.system.members.pop();
 await assert.rejects(f.manager.commit({scene:f.scene,left:f.token,rightIds:['pc4'],stamp}),/changed/);assert.equal(f.scene.tokens.length,1);
 f.manager.busy=()=>true;await assert.rejects(f.split(f.token,['pc4']),/Stop settlement travel/);
});
test('failed token creation and partial actor updates restore the original roster',async()=>{
 for(const type of ['token','batch']){const f=setup();type==='token'?f.setFailToken(true):f.setFailBatch(true);await assert.rejects(f.split(),/failure|response/);assert.equal(groupMembers(f.root).length,6);assert.equal(f.scene.tokens.length,1);assert.equal(f.actors.filter(a=>a.type==='group').length,1);assert.equal(f.root.name,'Wardens');}
});
test('scoped journey writes serialize and never touch another party or the legacy journey',async()=>{
 const f=setup(),two=await f.split(),a=partyScene(f.scene,'root'),b=partyScene(f.scene,two.actor.id);
 await Promise.all([writeJourney(a,()=>({name:'First route'})),writeJourney(b,()=>({name:'Second route'}))]);assert.equal(a.getFlag('kg-realms','journey').name,'First route');assert.equal(b.getFlag('kg-realms','journey').name,'Second route');assert.equal(f.scene.getFlag('kg-realms','journey').name,'Old route');
 assert.equal(partyScene(f.scene,'root'),a);assert.equal(focusedScene(f.scene),a);assert.equal(journeyScenes(f.scene).length,2);
 await f.scene.setFlag('kg-realms','partyFocus',two.actor.id);assert.equal(focusedScene(f.scene),b);
});
test('portrait circles sit inside the token ring at one to ten members, including rectangular tokens',()=>{
 for(const [w,h]of [[100,100],[200,100]])for(let n=1;n<=10;n++){const p=portraitLayout(w,h,n);assert.equal(p.length,n);for(const c of p){assert.ok(c.x-c.r>=0&&c.x+c.r<=w);assert.ok(c.y-c.r>=0&&c.y+c.r<=h);}}
});

test('portrait circles are spaced evenly around the ring without overlapping',()=>{
 for(let n=2;n<=10;n++){const p=portraitLayout(100,100,n),gaps=p.map((c,i)=>Math.hypot(c.x-p[(i+1)%n].x,c.y-p[(i+1)%n].y));
  for(const g of gaps){assert.ok(Math.abs(g-gaps[0])<1e-6);assert.ok(g>=2*p[0].r);}
  assert.ok(Math.abs(p[0].x-50)<1e-6&&p[0].y<50);}
 const one=portraitLayout(100,100,1)[0];assert.ok(Math.abs(one.x-50)<1e-6&&one.y>50);
});

test('portrait thumbnails decode at most two sources together and are freed after their last token releases them',async()=>{
 const cache=new PortraitCache();let active=0,peak=0,loads=0,destroyed=0;cache.load=async()=>{loads++;active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,2));active--;return{destroy(){destroyed++;}};};
 const images=await Promise.all(Array.from({length:10},(_,i)=>cache.acquire('img'+i)));assert.equal(peak,2);assert.equal(loads,10);
 const again=await cache.acquire('img0');cache.release('img0');assert.equal(destroyed,0);for(const img of images)cache.release(img.src);assert.equal(destroyed,10);assert.equal(cache.entries.size,0);
});

test('a merged group with pooled items is archived without deleting those items or losing members',async()=>{
 const f=setup(),two=await f.split();two.actor.raw.items=[{name:'Boat fares and supplies'}];globalThis.ui={notifications:{info(){}}};
 await f.manager.commit({scene:f.scene,left:f.token,right:two.token,rightIds:[],stamp:rosterStamp(familyActors(f.root))});
 assert.equal(f.scene.tokens.length,1);assert.equal(groupMembers(f.root).length,6);assert.deepEqual(two.actor.raw.items,[{name:'Boat fares and supplies'}]);assert.equal(two.actor.getFlag('kg-realms','party').retired,true);assert.ok(f.actors.includes(two.actor));
});

test('a first split initializes isolated journey storage even before any route has been planned',async()=>{
 const f=setup();delete f.scene.flags['kg-realms'].journey;const two=await f.split();const view=partyScene(f.scene,two.actor.id);assert.ok(f.scene.getFlag('kg-realms','partyJourneys'));assert.deepEqual(view.getFlag('kg-realms','journey'),{});
 await writeJourney(view,()=>({name:'Second party'}));assert.equal(partyScene(f.scene,'root').getFlag('kg-realms','journey').name,undefined);
});

test('a late token-name failure rolls back without trying to restore a removed temporary token',async()=>{
 const f=setup(),update=f.scene.updateEmbeddedDocuments.bind(f.scene);let fail=true;f.scene.updateEmbeddedDocuments=async(...args)=>{await update(...args);if(fail){fail=false;throw Error('Name save failed');}};
 await assert.rejects(f.split(),/^Error: Name save failed$/);assert.equal(f.scene.tokens.length,1);assert.equal(f.token.name,'Wardens');assert.equal(groupMembers(f.root).length,6);
});
test('a merge entered in reverse order still retains the original group actor and token',async()=>{
 const f=setup(),two=await f.split();await f.manager.commit({scene:f.scene,left:two.token,right:f.token,rightIds:[],stamp:rosterStamp(familyActors(f.root))});assert.equal(f.scene.tokens.length,1);assert.equal(f.scene.tokens[0].actorId,f.root.id);assert.equal(groupMembers(f.root).length,6);assert.equal(f.token.name,'Wardens');
});

test('the party HUD opens the transfer dialog directly for a single or multiple selected groups',async()=>{
 const f=setup(),two=await f.split(),ui=new PartyInterface(f.manager),calls=[];ui.closeContext=()=>{};ui.open=async(...args)=>calls.push(args);
 globalThis.canvas={tokens:{controlled:[{document:f.token,actor:f.root}]}};await ui.editSelected(f.token);assert.deepEqual(calls[0],[f.token,null,[]]);
 canvas.tokens.controlled=[{document:two.token,actor:two.actor},{document:f.token,actor:f.root}];await ui.editSelected(two.token);assert.deepEqual(calls[1],[f.token,two.token,[]]);
});

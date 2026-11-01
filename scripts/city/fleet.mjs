import {uiBounds} from '../ui-editbar.mjs';
import {placePanel,makeMovable,lockButton,toggleLock,placeLocked} from './panel-place.mjs';
import {shellHead} from '../ui-shell.mjs';
import {observeMapUi} from '../ui-docking.mjs';
import {CityTransit,tripActive,calendariaClock,MOVE_MS,CLOCK_MS} from './transit.mjs';
import {CityRideView} from './ride-view.mjs';
import {selectedParty,sceneParties} from '../party-groups.mjs';
import {isPrimaryGM} from '../authority.mjs';
import {cityPosition,cityDuration} from './routing.mjs';
const ID='kg-realms';
export class CityFleet {
 constructor(onChange=()=>{}){this.onChange=onChange;this.workers=new Map();this.view=null;this.writeQueue=Promise.resolve();}
 state(){const value=game.settings.get(ID,'cityTransit')??{};if(value.schema===2)return value;const group=value.tokens?.[0]&&game.scenes.get(value.scene)?.tokens.get(value.tokens[0].id)?.actor?.id;return{schema:2,trips:group&&value.id?{[group]:value}:{}};}
 ride(id){return this.state().trips[id]??{};}
 active(){return Object.entries(this.state().trips).filter(([,r])=>tripActive(r));}
 get rate(){const moving=this.active().map(([,r])=>r).filter(r=>r.phase==='travelling');return moving.length?Math.min(...moving.map(r=>r.rate)):0;}
 worker(id){if(!this.workers.has(id))this.workers.set(id,Object.assign(new CityTransit({fleet:this,partyId:id,onChange:()=>this.changed()}),{canControl:isPrimaryGM}));return this.workers.get(id);}
 selected(scene=canvas.scene){const t=selectedParty(scene);if(!t)throw Error('Place a group actor party token on this scene first.');return this.worker(t.actor.id);}
 busy(id){return tripActive(this.ride(id));}
 write(id,ride){
  const work=this.writeQueue.catch(()=>{}).then(async()=>{if(!isPrimaryGM())throw Error('Travel authority changed.');const state=structuredClone(this.state());if(ride.phase==='boarding'&&state.trips[id]?.id!==ride.id)this.assertRiders(id,ride.riders.map(r=>r.id));state.trips={...state.trips,[id]:ride};await game.settings.set(ID,'cityTransit',state);});this.writeQueue=work;return work;
 }
 assertRiders(party,ids){for(const [id,ride]of this.active())if(id!==party&&ride.riders.some(r=>ids.includes(r.id)))throw Error('A member of this party is already travelling with another group.');}
 install(){
  game.settings.register(ID,'cityTransit',{scope:'world',config:false,type:Object,default:{schema:2,trips:{}},onChange:()=>this.changed()});
  // Calendaria's clock speed and running state before settlement travel took it over, to put back.
  game.settings.register(ID,'cityClockBefore',{scope:'world',config:false,type:Object,default:{}});
  for(const [key,name,def,min,max,step,scope]of [['cityWalkMph','Settlement walking speed (mph)',3,.5,8,.5,'world'],['cityCarriageMph','Settlement carriage speed (mph)',6,1,20,.5,'world'],['cityTransitRate','Settlement travel speed',1,1,5,1,'world'],['cityCarriageVolume','Carriage ride volume',.35,0,1,.05,'client']])game.settings.register(ID,key,{name,scope,config:true,type:Number,default:def,range:{min,max,step}});
  Hooks.on('ready',()=>this.changed());Hooks.on('updateUser',()=>this.changed());Hooks.on('updateSetting',s=>{if(s.key===`${ID}.primaryGM`)this.changed();});
  Hooks.on('updateWorldTime',()=>{for(const w of this.workers.values())w.seenAt=performance.now();this.renderStatus();});
  Hooks.on('pauseGame',()=>{this.lastTick=performance.now();this.changed();});
  Hooks.on('updateToken',(doc,changes,options)=>{if(!isPrimaryGM()||!('x'in changes||'y'in changes))return;for(const [id,r]of this.active())if(r.scene===doc.parent?.id&&r.tokens.some(t=>t.id===doc.id)&&options?.kgRealmsCityRide!==r.id)this.worker(id).stop('The party token was moved manually.').catch(e=>ui.notifications.error(e.message));});
 }
 changed(){
  for(const [id]of this.active()){const w=this.worker(id);if(w.currentId!==w.ride.id){w.pending=0;w.shown=0;w.currentId=w.ride.id;}w.seenAt=performance.now();}
  // The city HUD (city/hud.mjs) shows the journeys: one in focus, or all with the shared clock.
  this.drive();this.onChange();
 }
 /** The HUD's ticking parts between changes (journey tabs, time left). */
 renderStatus(){this.onTick?.();}
 /** The journeys' buttons in the HUD: a journey's own (data-fleet), or every journey's (data-all). */
 async statusAction(e){
  const one=e.target.closest('[data-fleet]');if(one)return this.worker(one.dataset.party)[one.dataset.fleet]();
  const all=e.target.closest('[data-all]');if(!all)return;
  if(!isPrimaryGM())throw Error('Only the primary GM controls these journeys.');
  if(all.dataset.all==='speed')return this.setRate(Math.max(1,Math.min(5,Number(all.dataset.speed)||1)));
  const going=this.active().filter(([,r])=>['travelling','paused'].includes(r.phase));
  if(all.dataset.all==='pause'){const resume=going.every(([,r])=>r.phase==='paused');for(const [id,r]of going)if((r.phase==='paused')===resume)await this.worker(id).pause();return;}
  // Arrive now for all: the shortest journey first, so the shared clock moves on only as far as the longest.
  if(all.dataset.all==='arrive'){const left=([id,r])=>r.plan.seconds-this.worker(id).elapsed();for(const [id]of going.sort((a,b)=>left(a)-left(b)))await this.worker(id).arriveNow();}

 }
 /**
  * The clock (the primary GM). With Calendaria, its real-time clock: started at the trips' speed while
  * a trip moves, its own speed and running state put back when none does. Else this fleet's driver.
  */
 drive(){
  const on=isPrimaryGM()&&this.rate>0,cal=isPrimaryGM()?calendariaClock():null;
  if(cal)this.calendaria(cal,on).catch(error=>console.error('kg-realms | Calendaria clock',error));
  if(on&&!this.timer){this.lastTick=performance.now();this.lastCommit=this.lastTick;this.lastMove=-Infinity;this.pending=0;this.timer=setInterval(()=>this.tick().catch(error=>{console.error(error);ui.notifications.error(error.message);}),250);}
  if(!on&&this.timer){clearInterval(this.timer);this.timer=null;this.pending=0;}
 }
 async calendaria(cal,on){
  if(this.calBusy)return;this.calBusy=true;
  try{
   const saved=game.settings.get(ID,'cityClockBefore');
   if(on){
    if(!saved?.increment)await game.settings.set(ID,'cityClockBefore',cal.saved());
    if(cal.speed()!==this.rate)await cal.setSpeed(this.rate);
    if(!cal.running)cal.start();
   }else if(saved?.increment){await game.settings.set(ID,'cityClockBefore',{});await cal.restore(saved);}
  }finally{this.calBusy=false;}
 }
 /** The trips' speed, 1x (real time) to 5x: every moving party shares the one clock. */
 async setRate(n){
  if(!isPrimaryGM())throw Error('Only the primary GM controls settlement travel.');
  for(const [id,r]of this.active())if(r.rate!==n)await this.write(id,{...r,rate:n});
  const cal=calendariaClock();if(cal&&this.rate>0&&cal.speed()!==n)await cal.setSpeed(n);
 }
 /**
  * Each step (the primary GM). With Calendaria the parties follow its predicted time and it keeps
  * the clock; if its clock is stopped (paused, combat), they wait. Else this fleet commits the
  * clock every CLOCK_MS (or when a trip ends), and the parties move every MOVE_MS.
  */
 async tick(){
  if(this.running||!isPrimaryGM())return;const now=performance.now(),dt=Math.min(1,Math.max(0,(now-this.lastTick)/1000));this.lastTick=now;if(game.paused)return;
  const cal=calendariaClock(),moving=()=>this.active().filter(([,r])=>r.phase==='travelling');
  const step=async pending=>{for(const [id]of moving())try{const w=this.worker(id);w.lastMove=-Infinity;await w.tick({advance:false,pending});}catch(error){this.worker(id).fail(error);}};
  if(cal){
   if(!cal.running||now-(this.lastMove??-Infinity)<MOVE_MS-50)return;this.lastMove=now;this.pending=0;this.running=true;
   try{await step(Math.max(0,cal.now()-game.time.worldTime));}finally{this.running=false;}return;
  }
  this.pending+=dt*this.rate;
  const left=([,r])=>Math.max(0,r.plan.seconds-(game.time.worldTime-r.started)),list=moving(),remaining=list.length?Math.min(...list.map(left)):0;
  const commit=this.pending>=remaining||now-(this.lastCommit??-Infinity)>=CLOCK_MS,move=commit||now-(this.lastMove??-Infinity)>=MOVE_MS-50;
  if(!move)return;this.running=true;
  try{
   if(commit){const delta=Math.min(Math.floor(this.pending),remaining);this.pending-=delta;if(delta)await game.time.advance(delta,{kgRealmsCityFleet:true});this.lastCommit=now;}
   this.lastMove=now;await step(this.pending);
  }finally{this.running=false;}
 }
}

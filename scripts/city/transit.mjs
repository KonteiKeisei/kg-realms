import {isPrimaryGM} from '../authority.mjs';
import {selectPartyTokens} from '../party-token.mjs';
import {selectedParty,groupMembers} from '../party-groups.mjs';
import {buildCityGraph,planCityRoute,joinCityPlans,snapToRoad,cityPosition,boardedCoaches,CITY_SPEEDS} from './routing.mjs';
import {farePerRider,payFare,BASE_FARE_CP,walletFingerprint} from './money.mjs';
const ID='kg-realms';
/**
 * Settlement travel runs in real time, times a speed (1x to 5x). The party's tokens move every
 * MOVE_MS with an animation as long, so they glide; the world clock is committed only every
 * CLOCK_MS (and on pause, stop, arrival and Arrive now), because each clock change wakes every
 * module's time hooks, which can stall the scene.
 */
export const MOVE_MS=1000,CLOCK_MS=10000,SPEEDS=[1,2,3,4,5];
/** A new trip's speed: the Settlement travel speed setting, 1x to 5x. */
export const startRate=()=>{let v=1;try{v=Number(game.settings.get(ID,'cityTransitRate'));}catch{}return Math.max(1,Math.min(5,Math.round(v)||1));};
const wait=()=>new Promise(r=>setTimeout(r,25));
/**
 * Calendaria's real-time clock, when Calendaria is active and its clock is not locked: settlement
 * trips then run on it (the fleet starts it at the trip's speed and puts its own speed and running
 * state back afterwards), and the party follows its predicted time. Else null: the module drives.
 */
export function calendariaClock(){
  const mod=game.modules?.get?.('calendaria'),clock=mod?.active?mod.api?.managers?.TimeClock:null;
  if(!clock||typeof clock.start!=='function'||clock.locked)return null;
  const set=(k,v)=>game.settings.set('calendaria',k,v);
  return {
    get running(){return !!clock.running;},
    now:()=>Number(clock.predictedWorldTime??game.time.worldTime),
    saved:()=>({multiplier:game.settings.get('calendaria','timeSpeedMultiplier'),increment:game.settings.get('calendaria','timeSpeedIncrement'),running:!!clock.running}),
    speed:()=>Number(clock.realTimeSpeed)||0,
    async setSpeed(n){await set('timeSpeedIncrement','second');await set('timeSpeedMultiplier',n);clock.loadSpeedFromSettings?.();},
    async restore(s){if(!s)return;await set('timeSpeedIncrement',s.increment);await set('timeSpeedMultiplier',s.multiplier);clock.loadSpeedFromSettings?.();if(s.running&&!clock.running)clock.start();if(!s.running&&clock.running)clock.stop();},
    start:()=>clock.start(),stop:()=>clock.stop()
  };
}
/** The time now: Calendaria's predicted time while its clock runs, else the world clock. */
export const clockNow=()=>{const c=calendariaClock();return c?.running?c.now():game.time.worldTime;};
const wrap=doc=>doc.document?doc:{document:doc,actor:doc.actor};
export const tripActive = ride => !!ride?.id&&['boarding','travelling','paused','stopping'].includes(ride.phase);
export function cityFeetPerPixel(scene){
  const units=String(scene.grid?.units??'').toLowerCase(),factor=/^(m|meter|meters|metre|metres)$/.test(units)?3.280839895:/^(km|kilometers|kilometres)$/.test(units)?3280.839895:/^(mi|mile|miles)$/.test(units)?5280:/^(ft|feet|foot)$/.test(units)?1:null;
  if(factor==null)throw Error('Set this scene grid distance to feet, miles, meters or kilometers before travelling.');
  return Number(scene.grid.distance)*factor/Number(scene.grid.size);
}
export class CityTransit {
  constructor({overlay,onChange=()=>{},fleet=null,partyId=null}={}){Object.assign(this,{overlay,onChange,fleet,partyId});this.graphs=new Map();this.action=null;this.pending=0;this.busy=false;}
  get ride(){return this.fleet?this.fleet.ride(this.partyId):game.settings.get(ID,'cityTransit')??{};}
  write(ride){return this.fleet?this.fleet.write(this.partyId,ride):game.settings.set(ID,'cityTransit',ride);}
  party(scene){if(this.partyId){const t=selectedParty(scene,this.partyId);return t?[wrap(t)]:[];}const t=selectedParty(scene);return t?[wrap(t)]:[];}
  members(scene){return this.party(scene).flatMap(t=>groupMembers(t.actor));}
  origin(scene){const first=this.party(scene)[0]?.document;if(!first)throw Error('Place or designate the party token on this settlement map first.');const g=scene.grid.size;return[first.x+(first.width??1)*g/2,first.y+(first.height??1)*g/2];}
  graph(scene){const data=scene.getFlag(ID,'cityRoads')??{schema:1,revision:0,roads:[]},key=JSON.stringify(data);let entry=this.graphs.get(scene.id);if(entry?.key!==key){entry={key,graph:buildCityGraph(data)};this.graphs.set(scene.id,entry);}return entry.graph;}
  destination(scene,target){
    if(target.note){const note=scene.notes.get(target.note),rec=note?.getFlag(ID,'local');if(!rec)throw Error('That destination was removed. Choose another place.');return{x:note.x,y:note.y,note:note.id,name:rec.visibility==='hidden'?'Chosen destination':rec.name};}
    const d=scene.dimensions,x=Number(target.x),y=Number(target.y),sx=d?.sceneX??0,sy=d?.sceneY??0;
    if(!Number.isFinite(x)||!Number.isFinite(y)||x<sx||y<sy||x>sx+scene.width||y>sy+scene.height)throw Error('Choose an endpoint inside the settlement map.');
    return{x,y,name:'Selected map point'};
  }
  /** A map point moved onto the nearest road (a route point), or left as it is with no roads. */
  snapToRoad(scene,p){return snapToRoad(this.graph(scene),p)?.point??p;}
  preview(scene,target,mode='walk'){
    const destination=this.destination(scene,target),speeds={walk:Number(game.settings.get(ID,'cityWalkMph'))||CITY_SPEEDS.walk,carriage:Number(game.settings.get(ID,'cityCarriageMph'))||CITY_SPEEDS.carriage};
    // The route goes by the points the GM set (target.via, in order), each piece along the roads.
    const via=(Array.isArray(target.via)?target.via:[]).map(p=>[Number(p[0]),Number(p[1])]).filter(p=>p.every(Number.isFinite));
    const stops=[this.origin(scene),...via,[destination.x,destination.y]],options={mode,feetPerPixel:cityFeetPerPixel(scene),speeds,maxConnector:Math.max(100,scene.grid.size*3)};
    const plan=joinCityPlans(stops.slice(1).map((to,i)=>{try{return planCityRoute(this.graph(scene),stops[i],to,options);}catch(e){throw via.length&&i<via.length?Error(`Route point ${i+1}: ${e.message}`):e;}}));
    const rounded=Math.max(1,Math.ceil(plan.seconds));for(const leg of plan.legs)leg.seconds*=rounded/plan.seconds;plan.seconds=rounded;
    const perRider=farePerRider(game.settings.get(ID,'priceScale'));
    return{plan,destination,mode,perRider,quote:JSON.stringify({plan,perRider,party:this.party(scene)[0]?.document.id,members:this.members(scene).map(a=>a.id)})};
  }
  install(){
    game.settings.register(ID,'cityTransit',{scope:'world',config:false,type:Object,default:{},onChange:ride=>this.sync(ride)});
    game.settings.register(ID,'cityWalkMph',{name:'Settlement walking speed (mph)',hint:'Fixed walking speed for settlement road travel.',scope:'world',config:true,type:Number,default:3,range:{min:.5,max:8,step:.5}});
    game.settings.register(ID,'cityCarriageMph',{name:'Settlement carriage speed (mph)',hint:'Avenues and streets only. Walking connections can use lanes and alleys.',scope:'world',config:true,type:Number,default:6,range:{min:1,max:20,step:.5}});
    game.settings.register(ID,'cityTransitRate',{name:'Settlement travel speed',hint:'How fast settlement trips start: 1x is real time, up to 5x. Change it during a trip in the travel panel.',scope:'world',config:true,type:Number,default:1,range:{min:1,max:5,step:1}});
    // The ride's sound (0.74): none ships with KG Realms; the GM chooses one.
  game.settings.register(ID,'cityCarriageSound',{name:'Carriage ride sound',hint:'A looping sound for the carriage ride view: wheels, hooves, the road. Empty: the ride is silent.',scope:'world',config:true,type:String,filePicker:'audio',default:''});
  game.settings.register(ID,'cityCarriageVolume',{name:'Carriage ride volume',hint:'This client only. Also respects Foundry ambient volume.',scope:'client',config:true,type:Number,default:.35,range:{min:0,max:1,step:.05}});
    const authority=()=>{this.drive();this.overlay?.controls();this.onChange();};
    Hooks.on('updateUser',authority);Hooks.on('updateSetting',setting=>{if(setting.key===`${ID}.primaryGM`)authority();});
    Hooks.on('updateWorldTime',()=>{this.seenAt=performance.now();});
    Hooks.on('pauseGame',()=>{this.lastTick=performance.now();this.overlay?.sync(this.ride);});
    Hooks.on('ready',()=>this.sync(this.ride));
    Hooks.on('updateToken',(token,changes,options)=>{
      const ride=this.ride;if(!isPrimaryGM()||!tripActive(ride)||ride.scene!==token.parent?.id||!ride.tokens?.some(t=>t.id===token.id)||options?.kgRealmsCityRide===ride.id)return;
      if('x'in changes||'y'in changes)this.stop('The party token was moved manually.').catch(e=>ui.notifications.error(e.message));
    });
  }
  sync(ride){
    if(this.currentId!==ride?.id){this.pending=0;this.shown=0;this.currentId=ride?.id;}
    this.seenAt=performance.now();this.drive();this.overlay?.sync(tripActive(ride)?ride:null);this.onChange();
  }
  drive(){
    if(this.fleet)return this.fleet.drive();
    const on=isPrimaryGM()&&this.ride.phase==='travelling';
    if(on&&!this.timer){this.lastTick=performance.now();this.lastCommit=this.lastTick;this.timer=setInterval(()=>this.tick().catch(e=>this.fail(e)),250);}
    if(!on&&this.timer){clearInterval(this.timer);this.timer=null;this.pending=0;}
  }
  elapsed(now=performance.now()){
    {const c=calendariaClock(),ride=this.ride;if(c?.running&&ride.phase==='travelling')return Math.min(ride.plan.seconds,Math.max(0,c.now()-ride.started));}
    const ride=this.ride;if(!ride.id)return 0;if(ride.phase!=='travelling')return Math.min(ride.plan.seconds,ride.elapsed??0);
    const actual=Math.max(0,game.time.worldTime-ride.started),rate=this.fleet?.rate??ride.rate,lead=game.paused?0:Math.min(CLOCK_MS/1000+2,(now-(this.seenAt??now))/1000)*rate;
    const estimate=Math.min(ride.plan.seconds,actual+lead);this.shown=estimate<this.shown&&this.shown-estimate<ride.rate*2?this.shown:estimate;return this.shown;
  }
  async exclusive(fn){if(this.action)throw Error('A settlement travel action is already running.');const promise=Promise.resolve().then(fn);this.action=promise;try{return await promise;}finally{if(this.action===promise)this.action=null;}}
  async start(scene,target,{mode='walk',riderIds=[],waive=false,quote}={}){
    return this.exclusive(async()=>{
      if(!isPrimaryGM())throw Error('Only the primary GM can begin settlement travel.');
      if(tripActive(this.ride))throw Error('Finish or stop the current settlement trip first.');
      if(game.modules?.get('kg-transit')?.active&&game.settings.settings?.has('kg-transit.activeRide')&&game.settings.get('kg-transit','activeRide')?.id)throw Error('Finish the current KG Transit ride before beginning settlement travel.');
      this.fleet?.assertRiders(this.partyId,this.members(scene).map(a=>a.id));
      const preview=this.preview(scene,target,mode);if(quote&&quote!==preview.quote)throw Error('The party, roads, speed or fare changed. Review the updated route before departing.');
      const roster=new Map(this.members(scene).map(a=>[a.id,a])),riders=[...new Set(riderIds)].map(id=>roster.get(id));
      if(!riders.length||riders.some(a=>!a))throw Error('Choose at least one current party member.');
      const id=foundry.utils.randomID(),price=waive?0:preview.perRider*preview.plan.boardingCount;
      const payments=await Promise.all(riders.map(async actor=>{const before=structuredClone(actor.system.currency??{}),after=payFare(before,price);if(!after)throw Error(`${actor.name} cannot afford this carriage fare. Waive it or adjust the riders.`);return{actor:actor.id,amount:price,beforeHash:await walletFingerprint(before)};}));
      const origin=this.origin(scene),grid=scene.grid.size,tokens=this.party(scene).map(({document:d})=>({id:d.id,dx:d.x+(d.width??1)*grid/2-origin[0],dy:d.y+(d.height??1)*grid/2-origin[1]}));
      const ride={id,scene:scene.id,phase:'boarding',plan:preview.plan,destination:preview.destination,riders:riders.map(a=>({id:a.id,name:a.name,img:a.img})),tokens,payments,fare:{baseCopper:BASE_FARE_CP,perRider:preview.perRider,boardings:preview.plan.boardingCount,total:price*riders.length,waived:waive},elapsed:0,rate:startRate()};
      if(!isPrimaryGM()||tripActive(this.ride))throw Error('Travel authority or the active trip changed. Review the route before departing.');
      await this.write(ride);return this.completeBoarding(ride);
    });
  }
  async completeBoarding(ride){
    if(ride.phase!=='boarding'||this.ride.phase!=='boarding')throw Error('This trip is no longer boarding.');
    if(!isPrimaryGM()||this.ride.id!==ride.id)throw Error('Travel authority changed. The primary GM must review boarding.');
    const scene=game.scenes.get(ride.scene),origin=scene&&this.origin(scene);
    if(!origin||Math.hypot(origin[0]-ride.plan.start[0],origin[1]-ride.plan.start[1])>1)throw Error('The party moved during boarding. Cancel boarding and review the route from its new location.');
    const updates=[];
    for(const payment of ride.payments){
      if(!payment.amount)continue;const actor=game.actors.get(payment.actor);if(!actor)throw Error('A rider was removed. Cancel boarding before beginning another trip.');
      const receipt=actor.getFlag(ID,'cityFare');
      if(receipt?.ride===ride.id){if(receipt.refunded)throw Error('This boarding was refunded. Cancel it and begin a new trip.');continue;}
      if(await walletFingerprint(actor.system.currency??{})!==payment.beforeHash)throw Error(`${actor.name}'s wallet changed during boarding. Cancel boarding and review the fare.`);
      const after=payFare(actor.system.currency,payment.amount);if(!after)throw Error(`${actor.name} cannot afford the fare.`);
      updates.push({_id:actor.id,'system.currency':after,[`flags.${ID}.cityFare`]:{ride:ride.id,amount:payment.amount}});
    }
    if(!isPrimaryGM()||this.ride.id!==ride.id)return;
    if(updates.length)await Actor.updateDocuments(updates);
    if(!isPrimaryGM()||this.ride.id!==ride.id)return;
    await this.write({...ride,phase:'travelling',started:clockNow()});
  }
  async resumeBoarding(){return this.exclusive(()=>this.completeBoarding(this.ride));}
  /**
   * One step of the trip (the primary GM). advance: this worker keeps the clock (no fleet); else the
   * fleet does, and pending is its uncommitted time. Moves the tokens each MOVE_MS, commits the
   * clock each CLOCK_MS or at the destination, and completes the trip there.
   */
  async tick({advance=true,pending=null}={}){
    if(this.busy||this.action)return;const now=performance.now(),dt=Math.max(0,Math.min(1,(now-this.lastTick)/1000));this.lastTick=now;
    const ride=this.ride;if(!isPrimaryGM()||ride.phase!=='travelling'||game.paused)return;
    if(advance)this.pending+=dt*ride.rate;
    const ahead=()=>pending??this.pending,committed=()=>Math.max(0,game.time.worldTime-ride.started);
    const ends=committed()+ahead()>=ride.plan.seconds,commit=advance&&(ends||now-(this.lastCommit??-Infinity)>=CLOCK_MS),move=commit||ends||now-(this.lastMove??-Infinity)>=MOVE_MS-50;
    if(!commit&&!move)return;
    this.busy=true;
    try{
      if(commit){const delta=Math.min(Math.floor(this.pending),Math.max(0,ride.plan.seconds-committed()));this.pending-=delta;if(delta)await game.time.advance(delta,{kgRealmsCityRide:ride.id});this.lastCommit=now;}
      if(!isPrimaryGM()||this.action||this.ride.id!==ride.id||this.ride.phase!=='travelling')return;
      const done=committed()+ahead()>=ride.plan.seconds-1e-6,at=Math.min(ride.plan.seconds,committed()+ahead());
      this.lastMove=now;await this.moveTokens(ride,at,done?400:MOVE_MS);
      if(done&&isPrimaryGM()&&!this.action&&this.ride.id===ride.id){this.pending=0;await this.write({...ride,phase:'complete',elapsed:ride.plan.seconds});}
    }finally{this.busy=false;}
  }
  /** Wait for a step in progress (this trip's, or the fleet's). */
  async idle(){while(this.busy||this.fleet?.running)await wait();}
  /** Commit the uncommitted time (this trip's, or the fleet's shared clock), up to the trip's end. */
  async flushClock(ride){
    const owner=this.fleet??this,n=Math.min(Math.floor(owner.pending??0),Math.max(0,ride.plan.seconds-(game.time.worldTime-ride.started)));
    owner.pending=0;if(n>0)await game.time.advance(n,{kgRealmsCityRide:ride.id});
  }
  async moveTokens(ride,elapsed,duration=MOVE_MS){
    const scene=game.scenes.get(ride.scene);if(!scene)throw Error('The travel scene was removed.');const pos=cityPosition(ride.plan,elapsed).point,g=scene.grid.size;
    const updates=ride.tokens.flatMap(t=>{const doc=scene.tokens.get(t.id);return doc?[{_id:t.id,x:pos[0]+t.dx-(doc.width??1)*g/2,y:pos[1]+t.dy-(doc.height??1)*g/2}]:[];});
    if(!updates.length)throw Error('The party token was removed.');
    await scene.updateEmbeddedDocuments('Token',updates,{kgRealmsCityRide:ride.id,animate:duration>0,animation:{duration}});
  }
  async pause(){return this.exclusive(async()=>{
    if(!isPrimaryGM())throw Error('Only the primary GM controls this trip.');let ride=this.ride;
    if(ride.phase==='paused')return this.write({...ride,phase:'travelling',started:clockNow()-ride.elapsed});
    if(ride.phase!=='travelling')return;await this.idle();ride=this.ride;if(!isPrimaryGM()||ride.phase!=='travelling')return;
    await this.flushClock(ride);
    if(isPrimaryGM()&&this.ride.id===ride.id){const elapsed=Math.min(ride.plan.seconds,clockNow()-ride.started);await this.moveTokens(ride,elapsed,400);await this.write({...ride,phase:'paused',elapsed});}
  });}
  /** The trip's speed: 1x (real time) to 5x. Parties sharing the clock all take it. */
  async setSpeed(n){
    if(!isPrimaryGM())throw Error('Only the primary GM controls this trip.');n=Math.max(1,Math.min(5,Math.round(Number(n))||1));
    if(this.fleet)return this.fleet.setRate(n);
    const ride=this.ride;if(tripActive(ride)&&ride.rate!==n)await this.write({...ride,rate:n});
  }
  /** Arrive now: the rest of the trip's time passes at once, and the party is at the destination. */
  async arriveNow(){return this.exclusive(async()=>{
    if(!isPrimaryGM())throw Error('Only the primary GM controls this trip.');
    await this.idle();let ride=this.ride;if(!['travelling','paused'].includes(ride.phase))throw Error('This trip is not under way.');
    if(ride.phase==='travelling')await this.flushClock(ride);
    if(!isPrimaryGM()||this.ride.id!==ride.id)return;ride=this.ride;
    const cal=calendariaClock(),wasRunning=!!cal?.running;if(wasRunning)cal.stop();
    const done=ride.phase==='paused'?(ride.elapsed??0):Math.max(0,game.time.worldTime-ride.started),rest=Math.max(0,Math.ceil(ride.plan.seconds-done));
    if(rest)await game.time.advance(rest,{kgRealmsCityRide:ride.id});if(wasRunning)cal.start();
    if(!isPrimaryGM()||this.ride.id!==ride.id)return;
    await this.moveTokens(ride,ride.plan.seconds,600);this.pending=0;
    await this.write({...this.ride,phase:'complete',elapsed:ride.plan.seconds});
  });}
  async stop(reason='Stopped here'){
    return this.exclusive(async()=>{
      if(!isPrimaryGM())throw Error('Only the primary GM can stop this trip.');await this.idle();let ride=this.ride;if(!isPrimaryGM()||!tripActive(ride))return;
      if(ride.phase!=='stopping'){
        if(ride.phase==='travelling')await this.flushClock(ride);
        if(!isPrimaryGM()||this.ride.id!==ride.id)return;
        const elapsed=ride.phase==='paused'?ride.elapsed:Math.min(ride.plan.seconds,Math.max(0,clockNow()-(ride.started??game.time.worldTime)));
        ride={...ride,phase:'stopping',cancelBoarding:ride.phase==='boarding',elapsed,reason};
        // Persist the stop before refunding. A lost refund response cannot restart the travel clock.
        await this.write(ride);
      }
      if(!isPrimaryGM()||this.ride.id!==ride.id)return;
      const used=ride.cancelBoarding?0:boardedCoaches(ride.plan,ride.elapsed),unused=Math.max(0,ride.fare.boardings-used),refunds=[];
      for(const p of ride.payments){
        const actor=game.actors.get(p.actor),receipt=actor?.getFlag(ID,'cityFare');if(!actor||receipt?.ride!==ride.id||!p.amount)continue;
        const target=ride.cancelBoarding?p.amount:Math.round(p.amount*unused/Math.max(1,ride.fare.boardings)),amount=target-(receipt.refunded??0);
        if(amount>0)refunds.push({_id:actor.id,'system.currency.cp':Math.max(0,Number(actor.system.currency.cp)||0)+amount,[`flags.${ID}.cityFare`]:{...receipt,refunded:target}});
      }
      if(refunds.length)await Actor.updateDocuments(refunds);
      if(!isPrimaryGM()||this.ride.id!==ride.id)return;
      if(!ride.cancelBoarding&&!ride.reason.includes('manually'))await this.moveTokens(ride,ride.elapsed,400);
      if(isPrimaryGM()&&this.ride.id===ride.id)await this.write({...ride,phase:'stopped'});
    });
  }
  fail(error){console.error('kg-realms | settlement transit',error);ui.notifications.error(`Settlement travel stopped: ${error.message}`);if(isPrimaryGM()&&this.ride.phase==='travelling'){const ride=this.ride;this.write({...ride,phase:'paused',elapsed:Math.min(ride.plan.seconds,Math.max(0,game.time.worldTime-ride.started)),issue:error.message}).catch(console.error);}}
}

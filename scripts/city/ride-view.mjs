import {cityPosition,cityDuration} from './routing.mjs';
import {coinLabel} from './money.mjs';
const esc=s=>foundry.utils.escapeHTML(String(s??'')),W=1672,H=941,VP={x:836,y:440};
const media='modules/kg-realms/assets/media/';
const loadImage=src=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('Could not load carriage artwork.'));image.src=foundry.utils.getRoute(src);});
/** Composite the supplied JPEG artwork at runtime. Only its large neutral grey fields become windows. */
export function carriageLayer(image){
  const out=document.createElement('canvas');out.width=W;out.height=H;const g=out.getContext('2d',{willReadFrequently:true});g.drawImage(image,0,0,W,H);
  const pixels=g.getImageData(0,0,W,H),d=pixels.data,mask=new Uint8Array(W*H),queue=new Int32Array(W*H);
  for(let i=0;i<mask.length;i++){const j=i*4,r=d[j],b=d[j+2],v=d[j+1],lo=Math.min(r,b,v),hi=Math.max(r,b,v);if(hi-lo<=17&&lo>=95&&hi<=190)mask[i]=1;}
  for(let i=0;i<mask.length;i++)if(mask[i]===1){let head=0,tail=1;queue[0]=i;mask[i]=2;while(head<tail){const p=queue[head++],x=p%W;for(const n of [x?p-1:-1,x<W-1?p+1:-1,p>=W?p-W:-1,p<W*(H-1)?p+W:-1])if(n>=0&&mask[n]===1){mask[n]=2;queue[tail++]=n;}}if(tail>=250)for(let j=0;j<tail;j++)d[queue[j]*4+3]=0;}
  g.putImageData(pixels,0,0);return out;
}
// A journey under way, in the city HUD (city/hud.mjs): what the party is doing, its progress, the
// controls (the primary GM), and Stop here apart in the foot. While the party rides a coach, the coach
// view slides out from the bottom of the HUD, revealed or collapsed per client (revealed to start).
export class CityRideView {
  constructor(controller,hud){this.controller=controller;this.hud=hud;this.images={};this.view='passenger';this.muted=false;}
  sync(ride,{colour=null,shared=false}={}){
    this.ride=ride;this.shared=shared;this.colour=colour;
    if(!ride){this.close();return;}
    const same=this.root&&this.id===ride.id&&this.hud.el?.contains(this.body);
    this.head(ride);
    if(same){this.controls();this.drawer();return;}
    this.close();this.id=ride.id;this.root=this.hud.el;
    const body=this.body=this.hud.slot('body'),foot=this.foot=this.hud.slot('foot');
    body.classList.add('kgr-city-ride-body');if(colour)body.style.setProperty('--c',colour);
    body.innerHTML=`<div class="kgr-city-ride-status"><strong data-mode></strong><span data-time></span></div><progress max="1" value="0" aria-label="Journey progress"></progress><div class="kgr-city-riders" title="${esc(ride.riders.map(r=>r.name).join(', '))}"><span class="kgr-city-faces">${ride.riders.map(r=>`<img src="${esc(r.img)}" alt="${esc(r.name)}" data-tooltip="${esc(r.name)}">`).join('')}</span><small>${ride.riders.length} ${ride.riders.length===1?'rider':'riders'}</small></div><div class="kgr-city-ride-controls"></div><p class="hint" data-ride-hint></p>`;
    for(const part of [body,foot])part.addEventListener('click',ev=>this.action(ev).catch(error=>ui.notifications.error(error.message)));
    this.controls();this.drawer();
    if(ride.plan.boardingCount)this.prepare().catch(error=>{const h=this.body?.querySelector('[data-ride-hint]');if(h)h.textContent=error.message;});
    this.loop();
  }
  /** The HUD's header for this journey. */
  head(ride){
    const name=game.actors.get(this.controller.partyId)?.name??'Party';
    this.hud.head({icon:ride.plan.boardingCount?'fa-horse':'fa-person-walking',eyebrow:`Under way / ${name}`,title:`To ${ride.destination?.name??'the destination'}`});
  }
  /** The coach view drawer: while the plan has a coach in it. Open or shut for this client. */
  drawer(){
    const d=this.hud.el?.querySelector('.kgr-city-drawer');if(!d)return;
    const ride=this.controller.ride,coach=!!ride?.plan?.boardingCount,open=this.hud.drawerOpen();
    d.hidden=!coach;this.hud.el.classList.toggle('has-drawer',coach);this.hud.el.classList.toggle('drawer-shut',coach&&!open);
    if(!coach){d.innerHTML='';this.g=null;return;}
    const key=`${this.id}:${open}:${this.muted}`;if(this.drawerKey===key&&d.childElementCount)return;this.drawerKey=key;
    d.innerHTML=open?`<div class="kgr-city-drawer-head"><i class="fa-solid fa-horse" aria-hidden="true"></i><span>Coach view</span><span class="kgr-sh-sp"></span><button type="button" data-act="view" class="kgr-sh-ctl" title="Passenger or driver" aria-label="Switch carriage view"><i class="fa-solid fa-eye"></i></button><button type="button" data-act="sound" class="kgr-sh-ctl ${this.audioBlocked?'needs-click':''}" title="Ride sound" aria-label="Toggle ride sound"><i class="fa-solid ${this.muted?'fa-volume-xmark':'fa-volume-high'}"></i></button><button type="button" data-act="drawer" class="kgr-sh-ctl" title="Collapse the coach view (for you only)" aria-label="Collapse the coach view"><i class="fa-solid fa-chevron-up"></i></button></div><div class="kgr-city-stage"><canvas width="${W}" height="${H}" aria-label="Street scenery from the coach"></canvas></div>`
      :`<button type="button" data-act="drawer" class="kgr-city-drawer-tab" title="Show the coach view (for you only)"><i class="fa-solid fa-chevron-down"></i> Coach view</button>`;
    if(!d.dataset.wired){d.dataset.wired='1';d.addEventListener('click',ev=>this.action(ev).catch(error=>ui.notifications.error(error.message)));}
    this.g=open?d.querySelector('canvas')?.getContext('2d')??null:null;this.painted=null;
  }
  async prepare(){
    const id=this.id,art=await import('./scenery-art.mjs');if(!this.root||this.id!==id)return;const hour=game.time?.components?.hour??12,tod=hour>=7&&hour<17?'day':hour>=5&&hour<19?'dusk':'night';this.tod=tod;
    this.near=art.drawNear('fantasy','fantasy',tod,'summer',4);this.far=art.drawFar('fantasy','fantasy',tod,'summer',4);
    for(const view of ['passenger','driver'])if(!this.images[view]){const image=await loadImage(`${media}city-carriage-${view}.jpg`);if(!this.root||this.id!==id)return;this.images[view]=carriageLayer(image);}
  }
  controls(){
    if(!this.body)return;const ride=this.controller.ride,gm=this.controller.canControl?.()??game.user.isGM;
    const controls=this.body.querySelector('.kgr-city-ride-controls');
    // Several journeys share one clock: the speed is set on the All tab, and shown here as shared.
    const speed=this.shared?`<span class="kgr-sh-chip" title="Shared by every journey: change it on the All tab"><i class="fa-solid fa-gauge"></i>${ride.rate||1}x, shared</span>`:`<div class="kgr-city-speed" role="group" aria-label="Travel speed" title="Travel speed: 1x is real time">${[1,2,3,4,5].map(n=>`<button data-act="speed" data-speed="${n}" class="${(ride.rate||1)===n?'on':''}" aria-pressed="${(ride.rate||1)===n}" title="${n===1?'Real time':`${n} times real time`}">${n}x</button>`).join('')}</div>`;
    const signature=`${gm}:${ride.phase}:${ride.rate}:${this.shared}`;if(this.controlsKey!==signature){this.controlsKey=signature;controls.innerHTML=!gm?'':ride.phase==='stopping'?'<button data-act="stop">Finish stopping and refund unused fares</button>':ride.phase==='boarding'?'<button data-act="board">Resume boarding</button><button data-act="stop" class="danger">Cancel boarding and refund</button>':`<button data-act="pause" class="kgr-city-pause" title="${ride.phase==='paused'?'Resume the trip':'Pause the trip (the party waits here)'}"><i class="fa-solid fa-${ride.phase==='paused'?'play':'pause'}"></i> ${ride.phase==='paused'?'Resume':'Pause'}</button>${speed}<button data-act="finish" title="The rest of the trip's time passes now, and the party is at the destination"><i class="fa-solid fa-forward-fast"></i> Arrive now</button>`;
      // Stop here ends the trip: kept apart in the foot, away from the controls used while riding.
      const riding=gm&&!['stopping','boarding'].includes(ride.phase);this.foot.hidden=false;this.foot.innerHTML=(riding?'<button data-act="stop" class="danger kgr-city-stop" title="Stop the trip where the party is now (unused fares are refunded)"><i class="fa-solid fa-stop"></i> Stop here</button>':'')+'<span class="kgr-sh-sp"></span><button data-act="follow" title="Centre the map on the party"><i class="fa-solid fa-crosshairs"></i> Follow</button>';}
    this.body.querySelector('[data-ride-hint]').textContent=ride.phase==='boarding'?'Boarding is pending. The primary GM can resume or cancel it. Completed fare payments are recorded and will not be charged twice.':ride.issue??(ride.fare.waived?'Carriage fares waived.':ride.fare.total?`${coinLabel(ride.fare.total)} charged for ${ride.riders.length} riders. No further payment on reload.`:'Walking trip. No fare.');
  }
  loop(){
    if(!this.body||!this.hud.el?.contains(this.body))return;const now=performance.now(),ride=this.controller.ride,elapsed=this.controller.elapsed(now),moving=ride.phase==='travelling'&&!game.paused;
    const state=cityPosition(ride.plan,elapsed);
    
    const dt=Math.max(0,Math.min(.1,(now-(this.visualAt??now))/1000));this.visualAt=now;if(moving)this.visualDistance=(this.visualDistance??0)+dt*(state.mode==='carriage'?160:65);
    if(now-(this.textAt??0)>250){this.textAt=now;{const street=this.hud.streetAt?.(cityPosition(ride.plan,elapsed).point??[0,0]);this.body.querySelector('[data-mode]').textContent=(ride.phase==='boarding'?'Boarding':ride.phase==='paused'||game.paused?'Paused':state.mode==='carriage'?'By carriage':'On foot')+(street&&ride.phase==='travelling'?` along ${street}`:'');}const left=Math.max(0,ride.plan.seconds-elapsed);this.body.querySelector('[data-time]').textContent=`${cityDuration(left)} remaining in game`;this.body.querySelector('progress').value=elapsed/Math.max(1,ride.plan.seconds);this.sound(state.mode==='carriage'&&moving);}
    const painted=`${this.visualDistance}:${state.mode}:${moving}:${this.view}:${!!this.images[this.view]}:${!!this.near}`;
    if(this.g&&state.mode==='carriage'&&now-(this.drawAt??0)>=33&&this.painted!==painted){this.painted=painted;this.drawAt=now;this.paint(elapsed,state.mode,moving);}
    if(!this.g||state.mode==='walk'||!moving)this.timer=setTimeout(()=>this.loop(),250);else this.frame=requestAnimationFrame(()=>this.loop());
  }
  paint(elapsed,mode,moving){
    const g=this.g;if(!g)return;const gradient=g.createLinearGradient(0,0,0,H),night=this.tod==='night';gradient.addColorStop(0,night?'#02030a':'#4f86c0');gradient.addColorStop(.55,night?'#1e2a44':'#b2d4eb');gradient.addColorStop(.56,night?'#0b0c10':'#777565');gradient.addColorStop(1,night?'#141510':'#4b4538');g.fillStyle=gradient;g.fillRect(0,0,W,H);
    if(this.near&&this.far){
      // The open driver's view needs one continuous sky, rather than two sky planes meeting at the horizon.
      const scale=W/this.far.width,shift=((this.visualDistance??0)*.03)%W,top=VP.y-1440*scale;
      for(const x of [-W-shift,-shift,W-shift])g.drawImage(this.far,x-1,top-1,W+2,this.far.height*scale+2);
      for(const side of ['left','right'])this.plane(this.near,side,VP.x,0,this.visualDistance??0);
    }
    if(mode==='carriage'&&this.images[this.view]){
      const phase=(this.visualDistance??0)/160*6.8;
      if(this.view==='passenger'&&this.images.driver)this.frontTeam(g,phase,moving);
      g.save();const bob=moving?Math.sin(phase)*1.3:0;g.translate(0,bob);g.drawImage(this.images[this.view],0,0,W,H);g.restore();
    }
  }
  frontTeam(g,phase,moving){
    // Rectangles sit behind the keyed front windows. The original frame masks the silhouettes.
    const team=this.images.driver,scale=.43,x=420,y=245;
    const draw=(rect,bob=0)=>{g.save();g.beginPath();g.rect(...rect);g.clip();g.drawImage(team,x,y+bob,W*scale,H*scale);g.restore();};
    draw([600,275,125,200]);
    draw([778,310,68,155],moving?Math.sin(phase)*3.5:0);
    draw([846,310,80,155],moving?Math.sin(phase+.8)*3:0);
  }
  plane(image,side,lateral,top,travel){
    const g=this.g,start=side==='left'?0:VP.x,end=side==='left'?VP.x:W;
    for(let x=start;x<end;x+=3){const dx=Math.abs(x+1.5-VP.x),s=Math.min(1,dx/lateral),z=1000/s-1000;if(z>16000)continue;const along=side==='left'?z+travel:-(z+travel),u=((along%image.width)+image.width)%image.width,span=Math.max(1,Math.min(1000*lateral/(dx*dx)*3,image.width-u));g.drawImage(image,u,0,span,image.height,x,VP.y+(top-VP.y)*s,3,image.height*s);}
  }
  sound(on){
    if(!on||this.muted){this.audio?.pause();return;}
    if(!this.audio){const src=String(game.settings.get('kg-realms','cityCarriageSound')??'').trim();if(!src)return;this.audio=new Audio(foundry.utils.getRoute(src));this.audio.loop=true;}
    let ambient=1;try{const value=game.settings.get('core','globalAmbientVolume');if(typeof value==='number')ambient=value;}catch{}
    this.audio.volume=Math.max(0,Math.min(1,Number(game.settings.get('kg-realms','cityCarriageVolume'))||0))*ambient;
    if(this.audio.paused&&!this.audioPending&&!this.audioBlocked){this.audioPending=true;this.audio.play().catch(()=>{this.audioBlocked=true;const b=this.root?.querySelector('[data-act="sound"]');if(b){b.title='Click to enable ride sound';b.classList.add('needs-click');}}).finally(()=>this.audioPending=false);}
  }
  async action(e){const act=e.target.closest('[data-act]')?.dataset.act;if(!act)return;
    if(act==='view'){this.view=this.view==='passenger'?'driver':'passenger';this.painted=null;return;}
    if(act==='drawer'){await this.hud.toggleDrawer();return;}
    if(act==='sound'){this.muted=this.audioBlocked?false:!this.muted;this.audioBlocked=false;this.drawerKey=null;this.drawer();this.sound(!this.muted&&this.controller.ride.phase==='travelling'&&!game.paused&&cityPosition(this.controller.ride.plan,this.controller.elapsed()).mode==='carriage');return;}
    if(act==='follow'){const t=this.controller.party(canvas.scene)[0]?.document;if(t){const g=canvas.scene.grid.size;await canvas.animatePan({x:t.x+(t.width??1)*g/2,y:t.y+(t.height??1)*g/2,duration:400});}return;}
    if(act==='pause')return this.controller.pause();if(act==='finish')return this.controller.arriveNow();if(act==='speed')return this.controller.setSpeed(Number(e.target.closest('[data-speed]')?.dataset.speed));if(act==='board')return this.controller.resumeBoarding();if(act==='stop')return this.controller.stop();
  }
  close(){cancelAnimationFrame(this.frame);clearTimeout(this.timer);this.audio?.pause();if(this.audio){this.audio.removeAttribute('src');this.audio.load();this.audio=null;}this.audioBlocked=false;this.controlsKey=null;this.drawerKey=null;this.root=null;this.body=null;this.foot=null;this.g=null;this.images={};this.near=this.far=null;this.painted=null;this.visualDistance=0;this.visualAt=null;const d=this.hud?.el?.querySelector('.kgr-city-drawer');if(d){d.hidden=true;d.innerHTML='';}this.hud?.el?.classList.remove('has-drawer','drawer-shut');}
}

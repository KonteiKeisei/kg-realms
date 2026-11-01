// Where the city HUD sits (city/hud.mjs): the top right of the map, until the user drags it by its
// header. Then that place is kept (per client), until they double-click the header to put it back.
// A lock stops dragging.
import {uiBounds} from '../ui-editbar.mjs';
import {dragByHeader,clampTo} from '../float-panel.mjs';

const ID='kg-realms';
const get=k=>{try{return game.settings.get(ID,k);}catch{return undefined;}};

/** The client settings: the panels' place (-1: under the button) and the lock. */
export function registerPanelPlace(){
  for(const k of ['cityPanelX','cityPanelY'])game.settings.register(ID,k,{scope:'client',config:false,type:Number,default:-1});
  game.settings.register(ID,'cityPanelLocked',{scope:'client',config:false,type:Boolean,default:false});
}

/** The Travel/Journeys button's spot: its right edge and top (see SettlementTravelUI.showLaunch). */
export function launchSpot(){const b=uiBounds();return{right:b.right-12,top:Math.max(64,b.top+16)};}

/**
 * Put a panel of a given width in its place: where the user left it (kept on screen), else just
 * under the Travel/Journeys button, right-aligned with it. Its height is kept within the screen.
 */
export function placePanel(el,width){
  if(!el)return;
  const x=get('cityPanelX'),y=get('cityPanelY'),b=uiBounds();
  el.style.width=`${width}px`;el.style.right='auto';
  let left,top;
  if(x>=0&&y>=0)[left,top]=clampTo(el,x,y);
  else{const s=launchSpot();left=Math.max(b.left+12,s.right-width);top=s.top;}
  Object.assign(el.style,{left:`${left}px`,top:`${top}px`,maxHeight:`${Math.max(160,window.innerHeight-top-12)}px`});
}

/**
 * Let a panel be dragged by its header while unlocked (the place is kept for all the panels), and
 * put back under the button by double-clicking the header. redock: the panel's own dock().
 */
export function makeMovable(el,redock){
  dragByHeader(el,{locked:()=>!!get('cityPanelLocked'),save:(x,y)=>{game.settings.set(ID,'cityPanelX',x);game.settings.set(ID,'cityPanelY',y);}});
  el.addEventListener('dblclick',async e=>{
    if(!e.target.closest('header')||e.target.closest('button, input, select, a')||get('cityPanelLocked'))return;
    await game.settings.set(ID,'cityPanelX',-1);await game.settings.set(ID,'cityPanelY',-1);redock();
  });
}

/** The header's lock button: data-act="lock-place". */
export function lockButton(){
  const locked=!!get('cityPanelLocked');
  return `<button data-act="lock-place" class="kgr-city-lock ${locked?'on':''}" title="${locked?'Unlock to move the panel by its header':'Lock the panel in place (double-click the header to put it back under the button)'}" aria-label="${locked?'Unlock panel position':'Lock panel position'}" aria-pressed="${locked}"><i class="fa-solid fa-${locked?'lock':'lock-open'}"></i></button>`;
}

/** Whether the panels are locked in place. */
export const placeLocked=()=>!!get('cityPanelLocked');

/** Lock or unlock the panels' place. */
export function toggleLock(){return game.settings.set(ID,'cityPanelLocked',!get('cityPanelLocked'));}

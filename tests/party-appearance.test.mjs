import test from 'node:test';
import assert from 'node:assert/strict';
import {drawPartyOutline,registerPartyAppearance,partyAppearanceMenu,partyOutlineValue} from '../scripts/party-appearance.mjs';

class Graphics{
  clear(){this.lines=[];this.circles=[];return this;}
  lineStyle(style){this.lines.push(style);return this;}
  drawCircle(...args){this.circles.push(args);return this;}
  beginFill(){throw Error('Party surround must remain transparent');}
}
test('party surround has a single thin outline, layered glow and matching portrait borders without a background band',()=>{
  const track=new Graphics(),glow=new Graphics(),portrait=new Graphics(),options={width:100,height:100,radius:46.8,line:1.4,colour:0x18ccff};
  const strokes=[{g:portrait,p:{x:30,y:30,r:10}}];drawPartyOutline(track,glow,strokes,options);
  assert.equal(track.lines.length,1);assert.equal(track.lines[0].width,1.4);assert.equal(track.circles.length,1);assert.ok(glow.lines.length>1);
  for(const g of [track,glow,portrait])assert.ok(g.lines.every(l=>l.color===0x18ccff));
  drawPartyOutline(track,glow,strokes,{...options,line:.7,colour:0xee3377});assert.equal(track.lines[0].width,.7);assert.equal(portrait.lines[0].color,0xee3377);
});
test('party appearance is a GM settings section with a world-wide colour and redraw callback',()=>{
  let registered,menu,changed=0;globalThis.foundry={applications:{api:{ApplicationV2:class{}}}};
  globalThis.game={settings:{register:(_m,_k,config)=>registered=config,registerMenu:(_m,_k,config)=>menu=config}};
  registerPartyAppearance(()=>changed++);assert.equal(registered.scope,'world');assert.equal(menu.restricted,true);registered.onChange('#18ccff');assert.equal(changed,1);
});
test('the settings form saves only for a GM and normalizes the chosen colour',async()=>{
  let colour='#18ccff',handler,writes=0,closed=0;
  globalThis.foundry={applications:{api:{ApplicationV2:class{async close(){closed++;}}}}};
  globalThis.game={user:{isGM:true},settings:{get:()=>colour,set:async(_m,_k,value)=>{colour=value;writes++;}}};
  const Menu=partyAppearanceMenu(),dialog=new Menu();dialog.element={querySelector:()=>({addEventListener:(_event,fn)=>handler=fn})};
  assert.match(await dialog._renderHTML(),/type="color"/);dialog._onRender();
  const event={preventDefault(){},currentTarget:{elements:{colour:{value:'#EE3377'}}}};
  await handler(event);assert.equal(colour,'#ee3377');assert.equal(partyOutlineValue(),0xee3377);assert.equal(closed,1);
  game.user.isGM=false;await handler(event);assert.equal(writes,1);
});

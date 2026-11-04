const ID='kg-realms';
export const DEFAULT_PARTY_OUTLINE='#d9a441';
export function partyOutlineColour(value){return typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value.trim())?value.trim().toLowerCase():DEFAULT_PARTY_OUTLINE;}
export function partyOutlineValue(){return parseInt(partyOutlineColour(globalThis.game?.settings?.get?.(ID,'partyOutlineColour')).slice(1),16);}

/** World-wide GM appearance setting. Saving redraws strokes without reloading portraits. */
export function registerPartyAppearance(onChange){
  game.settings.register(ID,'partyOutlineColour',{scope:'world',config:false,type:String,default:DEFAULT_PARTY_OUTLINE,onChange});
  game.settings.registerMenu(ID,'partyAppearance',{name:'Party token appearance',label:'Configure token outlines',hint:'Choose the glowing party-token outline and member portrait border colour. The surrounding ring has no background fill.',icon:'fa-solid fa-palette',restricted:true,type:partyAppearanceMenu()});
}
export function partyAppearanceMenu(){
  return class PartyAppearanceMenu extends foundry.applications.api.ApplicationV2{
    static DEFAULT_OPTIONS={id:'kgr-party-appearance',classes:['kgr-ui'],window:{title:'KG Realms: Party token appearance',icon:'fa-solid fa-palette'},position:{width:420,height:'auto'}};
    async _renderHTML(){const colour=partyOutlineColour(game.settings.get(ID,'partyOutlineColour'));return `<form style="padding:16px"><h3>Party token outlines</h3><p>The outer ring is transparent, with a glow like the travel trails. Portrait borders use the same colour.</p><div class="form-group"><label for="kgr-party-outline-colour">Outline and portrait colour</label><input id="kgr-party-outline-colour" name="colour" type="color" value="${colour}"></div><button type="submit">Save appearance</button></form>`;}
    _replaceHTML(content,element){element.innerHTML=content;}
    _onRender(){this.element.querySelector('form').addEventListener('submit',async event=>{event.preventDefault();if(!game.user.isGM)return;const colour=partyOutlineColour(event.currentTarget.elements.colour.value);await game.settings.set(ID,'partyOutlineColour',colour);await this.close();});}
  };
}

/** Layered additive strokes match the trail glow without blur filters or a painted band. */
export function drawPartyOutline(track,glow,strokes,{width,height,radius,line,colour}){
  track.clear().lineStyle({width:line,color:colour,alpha:.95,alignment:.5}).drawCircle(width/2,height/2,radius);
  glow.clear();
  for(const [size,alpha] of [[7,.06],[3.5,.12],[1.5,.22]])glow.lineStyle({width:line*size,color:colour,alpha,alignment:.5}).drawCircle(width/2,height/2,radius);
  for(const {g,p} of strokes)g.clear().lineStyle({width:line,color:colour,alpha:.95,alignment:.5}).drawCircle(p.x,p.y,p.r);
}

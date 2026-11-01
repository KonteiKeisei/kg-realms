export const ICON_PACKS=Object.freeze({coin:'Coin',current:'Current',gilded:'Gilded',brass:'Brass',enamel:'Enamel'});
export const iconPackOverride=value=>typeof value==='string'&&Object.hasOwn(ICON_PACKS,value)?value:null;
export const iconPack=value=>iconPackOverride(value)??'enamel';
export function worldIconPack(){try{return iconPack(globalThis.game?.settings?.get('kg-realms','defaultIconPack'));}catch{return 'enamel';}}
export const resolvedIconPack=(map,poi,worldDefault=worldIconPack())=>iconPackOverride(poi?.iconPack)??iconPackOverride(map?.iconPack)??iconPack(worldDefault);
export const iconPackOptions=()=>Object.entries(ICON_PACKS);
export function registerIconPackSetting(onChange=()=>{}){
  game.settings.register('kg-realms','defaultIconPack',{name:'Default icon pack',hint:'World default for local map markers. Maps and individual POIs can override it. Enamel is used initially.',scope:'world',config:true,type:String,default:'enamel',choices:{...ICON_PACKS},onChange:()=>{onChange();globalThis.Hooks?.callAll('kgRealmsIconPackChanged');}});
}
let family;
export function markerFontFamily(){
  if(!family){const probe=document.createElement('i');probe.className='fa-solid fa-shop';probe.style.cssText='position:absolute;visibility:hidden';document.body.append(probe);family=getComputedStyle(probe).fontFamily||'"Font Awesome 6 Free"';probe.remove();}
  return family;
}
// The packs (0.67, from the City HUD mockup): what reads on a busy city map is a strong contrast
// between face and glyph, a dark edge that parts the marker from roofs and roads, and a soft
// shadow that lifts it off the map. Each pack keeps its own character within that.
function shieldPath(g,s,k=1){
  const c=s/2,pts=[[.5,.03],[.94,.18],[.94,.63],[.5,.95],[.06,.63],[.06,.18]];
  g.beginPath();pts.forEach(([x,y],i)=>{const X=c+(x*s-c)*k,Y=c+(y*s-c)*k;i?g.lineTo(X,Y):g.moveTo(X,Y);});g.closePath();
}
function shadowed(g,s,draw){g.save();g.shadowColor='rgba(0,0,0,.55)';g.shadowBlur=s*.07;g.shadowOffsetY=s*.03;draw();g.restore();}
function disc(g,s,r,fill){g.beginPath();g.arc(s/2,s/2,r,0,Math.PI*2);g.fillStyle=fill;g.fill();}
function ring(g,s,r,w,colour){g.beginPath();g.arc(s/2,s/2,r,0,Math.PI*2);g.lineWidth=w;g.strokeStyle=colour;g.stroke();}
const goldFill=(g,s)=>{const f=g.createLinearGradient(0,s*.2,0,s*.8);f.addColorStop(0,'#fff3c4');f.addColorStop(.45,'#f2cf7a');f.addColorStop(1,'#b98a35');return f;};
const bevel=(g,x0,y0,x1,y1)=>{const f=g.createLinearGradient(x0,y0,x1,y1);f.addColorStop(0,'#fff0b6');f.addColorStop(.35,'#c79a4e');f.addColorStop(.7,'#7a5626');f.addColorStop(1,'#e9c886');return f;};
function glyphAt(g,s,text,fontFamily,{size,fill,edge=null,edgeW=0,dy=0,emboss=false}){
  const c=s/2;let font=s*size;g.font=`900 ${font}px ${fontFamily}`;const w=g.measureText(text).width;
  if(w>s*.66){font*=s*.66/w;g.font=`900 ${font}px ${fontFamily}`;}
  g.textAlign='center';g.textBaseline='middle';g.lineJoin='round';
  if(emboss){g.fillStyle='rgba(255,248,220,.45)';g.fillText(text,c,c+dy+s*.012);}
  if(edge){g.strokeStyle=edge;g.lineWidth=s*edgeW;g.strokeText(text,c,c+dy);}
  g.fillStyle=fill;g.fillText(text,c,c+dy);
}
export function drawLocalMarker(g,{pack='enamel',glyph='?',rumoured=false,fontFamily='"Font Awesome 6 Free"',size=128}={}){
  pack=iconPack(pack);const s=size,c=s/2,text=rumoured?'?':glyph;g.save();g.clearRect(0,0,s,s);g.globalAlpha*=rumoured?.62:1;
  if(pack==='coin'){
    // A gold coin with a dark rim and a dark glyph.
    const R=s*.45;shadowed(g,s,()=>disc(g,s,R,'#3b2a12'));
    const face=g.createRadialGradient(c-R*.35,c-R*.45,0,c,c,R);face.addColorStop(0,'#fbe3a2');face.addColorStop(.55,'#d8a957');face.addColorStop(1,'#a87a2c');
    disc(g,s,R-s*.06,face);ring(g,s,R-s*.06,s*.012,'rgba(255,240,190,.35)');
    glyphAt(g,s,text,fontFamily,{size:.42,fill:'#2a1d05',dy:s*.012,emboss:true});
  }else if(pack==='current'){
    // Parchment: a cream disc, a black edge and glyph.
    const R=s*.45;shadowed(g,s,()=>disc(g,s,R,'#1a1408'));
    const paper=g.createRadialGradient(c-R*.3,c-R*.4,0,c,c,R);paper.addColorStop(0,'#fffaf0');paper.addColorStop(1,'#e6dabd');
    disc(g,s,R-s*.045,paper);ring(g,s,R-s*.085,s*.01,'rgba(26,20,8,.45)');
    glyphAt(g,s,text,fontFamily,{size:.45,fill:'#1a1408',dy:s*.012});
  }else if(pack==='gilded'){
    // The glyph alone, in bevelled gold, over a dark halo so it holds on any ground.
    const halo=g.createRadialGradient(c,c,0,c,c,s*.46);halo.addColorStop(0,'rgba(10,8,4,.62)');halo.addColorStop(.6,'rgba(10,8,4,.42)');halo.addColorStop(1,'rgba(10,8,4,0)');
    g.fillStyle=halo;g.fillRect(0,0,s,s);
    shadowed(g,s,()=>glyphAt(g,s,text,fontFamily,{size:.56,fill:rumoured?'#fbe6b1':goldFill(g,s),edge:'#241c15',edgeW:.07,dy:s*.02}));
  }else if(pack==='brass'){
    // A bevelled brass rim round a warm bronze face.
    const R=s*.46;shadowed(g,s,()=>disc(g,s,R,'#211a0e'));
    disc(g,s,R-s*.022,bevel(g,0,c-R,s,c+R));
    const face=g.createRadialGradient(c-R*.3,c-R*.4,0,c,c,R);face.addColorStop(0,'#7a5a36');face.addColorStop(1,'#3a2817');
    disc(g,s,R-s*.09,face);ring(g,s,R-s*.09,s*.014,'#2a1d0c');
    glyphAt(g,s,text,fontFamily,{size:.42,fill:goldFill(g,s),edge:'#1e150a',edgeW:.03,dy:s*.012});
  }else{
    // Enamel: a gold-bordered shield of glossy teal.
    shadowed(g,s,()=>{shieldPath(g,s);g.fillStyle='#241c15';g.fill();});
    shieldPath(g,s,.95);g.fillStyle=bevel(g,0,0,s,s);g.fill();
    const face=g.createRadialGradient(s*.36,s*.22,0,c,c,s*.6);face.addColorStop(0,'#4f8f8c');face.addColorStop(.6,'#1f5a5e');face.addColorStop(1,'#123a40');
    shieldPath(g,s,.8);g.fillStyle=face;g.fill();g.lineWidth=s*.012;g.strokeStyle='#241c15';g.stroke();
    g.save();shieldPath(g,s,.8);g.clip();const gloss=g.createLinearGradient(0,s*.1,0,s*.5);gloss.addColorStop(0,'rgba(255,255,255,.28)');gloss.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=gloss;g.beginPath();g.ellipse(c,s*.2,s*.36,s*.16,0,0,Math.PI*2);g.fill();g.restore();
    glyphAt(g,s,text,fontFamily,{size:.4,fill:goldFill(g,s),edge:'#10272c',edgeW:.03,dy:-s*.02});
  }
  g.restore();
}
export function markerCanvas(glyph,pack='enamel',rumoured=false){const canvas=document.createElement('canvas');canvas.width=canvas.height=128;drawLocalMarker(canvas.getContext('2d'),{glyph,pack,rumoured,fontFamily:markerFontFamily()});return canvas;}
export function paintIconPackPreview(root,pack,glyphs){
  if(!root)return;const version=root.kgrIconPreviewVersion=(root.kgrIconPreviewVersion??0)+1;const render=()=>{if(!root.isConnected||root.kgrIconPreviewVersion!==version)return;root.replaceChildren(...glyphs.map(glyph=>{const c=markerCanvas(glyph,pack);c.className='kgr-icon-pack-sample';c.setAttribute('aria-hidden','true');return c;}));};render();
  document.fonts?.load(`900 48px ${markerFontFamily()}`,glyphs.join('')).then(render).catch(()=>{});
}

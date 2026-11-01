import {LodCache,chooseView,overlaps,hiddenByFiner} from './lod-cache.mjs';
// A terrain-only MapLibre custom layer. No Ember code or assets are used here.
export function tileCorners(tile, m) {
  const point=(x,y)=>[(m.x+x)/m.worldSize*360-180,Math.atan(Math.sinh(Math.PI*(1-2*(m.y+y)/m.worldSize)))*180/Math.PI];
  return [point(tile.x,tile.y),point(tile.x+tile.width,tile.y),point(tile.x,tile.y+tile.height),point(tile.x+tile.width,tile.y+tile.height)];
}
export function bufferBytes(texture) {
  return (texture?.baseTexture?.resource?._levelBuffers??[]).reduce((n,b)=>n+b.levelBuffer.byteLength,0);
}
const VS=`attribute vec2 aPos; attribute vec2 aUv; varying vec2 vUv;
void main(){vUv=aUv;gl_Position=vec4(aPos,0.,1.);}`;
const FS=`precision mediump float; uniform sampler2D uImage; uniform vec4 uLook; varying vec2 vUv;
void main(){vec4 c=texture2D(uImage,vUv);float avg=(c.r+c.g+c.b)/3.;
float s=uLook.z>0.?1.-1./(1.001-uLook.z):-uLook.z;
c.rgb+=(vec3(avg)-c.rgb)*s;
float contrast=uLook.w>0.?1./(1.-uLook.w):1.+uLook.w;
c.rgb=(c.rgb-.5)*contrast+.5;c.rgb=mix(vec3(uLook.x),vec3(uLook.y),c.rgb);gl_FragColor=c;}`;
function program(gl) {
  const p=gl.createProgram(), shaders=[];
  try {
    for(const [kind,source] of [[gl.VERTEX_SHADER,VS],[gl.FRAGMENT_SHADER,FS]]){
      const s=gl.createShader(kind);shaders.push(s);gl.shaderSource(s,source);gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));gl.attachShader(p,s);
    }
    gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;
  } catch(e){gl.deleteProgram(p);throw e;} finally{shaders.forEach(s=>gl.deleteShader(s));}
}
export class TerrainLayer {
  id='kgr-terrain';type='custom';renderingMode='2d';
  constructor({catalog,base,loadKtx,releaseKtx,budgetBytes=128*1048576,onStatus=()=>{}}){
    Object.assign(this,{catalog,base,loadKtx,releaseKtx,budgetBytes,onStatus});this.mode='ktx2';
    this.formats=new Set();this.stopped=false;this.inputBytes=0;this.view={x0:0,y0:0,x1:0,y1:0};this.activeLod=catalog.lods[0].z;
  }
  onAdd(map,gl){
    this.map=map;this.gl=gl;this.started=performance.now();
    try{
      for(const ext of ['WEBGL_compressed_texture_s3tc','WEBGL_compressed_texture_s3tc_srgb','EXT_texture_compression_bptc','WEBGL_compressed_texture_etc','WEBGL_compressed_texture_etc1','WEBGL_compressed_texture_astc','WEBGL_compressed_texture_pvrtc'])gl.getExtension(ext);
      this.program=program(gl);this.pos=gl.getAttribLocation(this.program,'aPos');this.uv=gl.getAttribLocation(this.program,'aUv');
      this.look=gl.getUniformLocation(this.program,'uLook');this.sampler=gl.getUniformLocation(this.program,'uImage');
      this.buffer=gl.createBuffer();this.vao=gl.createVertexArray?.();
      this.cache=new LodCache({roots:this.catalog.lods[0].tiles,budgetBytes:this.budgetBytes,load:t=>this.#decode(t),onChange:()=>this.#report()});
      // The map's size in CSS pixels, read once and on resize: reading it while drawing forces a layout every frame.
      this.onResize=()=>{const c=map.getContainer();this.size=[c.clientWidth,c.clientHeight];this.#schedule();};
      this.onMove=()=>this.#schedule();map.on('move',this.onMove);map.on('resize',this.onResize);
      const c=map.getContainer();this.size=[c.clientWidth,c.clientHeight];this.#requestView();
    }catch(e){this.onStatus({state:'failed',mode:this.mode,textureBytes:0,downloadBytes:0,error:e.message});}
  }
  #schedule(){if(this.stopped||this.pending!=null)return;this.pending=requestAnimationFrame(()=>{this.pending=null;this.#requestView();});}
  #requestView(){
    if(this.stopped||!this.cache)return;
    const m=this.catalog.sourceMap,b=this.map.getBounds();
    const point=(lon,lat)=>{const s=Math.sin(Math.max(-85.05112878,Math.min(85.05112878,lat))*Math.PI/180);return {x:(lon+180)/360*m.worldSize-m.x,y:(.5-Math.log((1+s)/(1-s))/(4*Math.PI))*m.worldSize-m.y};};
    const nw=point(b.getWest(),b.getNorth()),se=point(b.getEast(),b.getSouth()),px=(se.x-nw.x)*.2,py=(se.y-nw.y)*.2;
    this.view={x0:Math.max(0,nw.x-px),y0:Math.max(0,nw.y-py),x1:Math.min(m.width,se.x+px),y1:Math.min(m.height,se.y+py)};
    const root=[...this.cache.resident.values()].find(r=>this.cache.rootIds.has(r.tile.id));
    const ratio=root?root.bytes/(root.tile.textureWidth*root.tile.textureHeight):1;
    const dpr=this.map.getCanvas().width/(this.size?.[0]||this.map.getContainer().clientWidth);
    const selected=chooseView(this.catalog,this.view,this.map.getZoom()+Math.log2(dpr),this.budgetBytes,ratio,this.activeLod);
    this.activeLod=selected.z;this.requestedLod=selected.requestedZ;this.budgetLimited=selected.budgetLimited;this.cache.request(selected.tiles);this.map.triggerRepaint();
  }
  #report(){
    if(!this.cache)return;const s=this.cache.status();
    if(s.state==='ready'&&this.initialReadyMs==null)this.initialReadyMs=+(performance.now()-this.started).toFixed(1);
    this.onStatus({...s,mode:this.mode,activeLod:this.activeLod,requestedLod:this.requestedLod,budgetLimited:this.budgetLimited,availableLods:this.catalog.lods.map(l=>l.z),formats:[...this.formats],downloadBytes:this.inputBytes,loadMs:this.initialReadyMs??null});
    if(!this.stopped){this.map.triggerRepaint();if(s.rootReady&&!this.rootRefined){this.rootRefined=true;this.#schedule();}}
  }
  async #decode(tile){
    let input;
    try{
      input=await this.loadKtx(tile);const r=input?.baseTexture?.resource;
      if(!r?._levelBuffers?.length||r.levels!==1)throw Error('Expected a single-level compressed KTX2 texture; RGBA fallback is rejected.');
      if(input.width!==tile.textureWidth||input.height!==tile.textureHeight)throw Error('Texture dimensions differ from catalogue');
      if(!this.gl.getParameter(this.gl.COMPRESSED_TEXTURE_FORMATS).includes(r.format))throw Error(`Compressed format ${r.format} unavailable in MapLibre context`);
      this.inputBytes+=tile.ktxBytes;
      return {bytes:bufferBytes(input),upload:()=>this.#upload(tile,input),release:()=>this.releaseKtx(tile)};
    }catch(e){await this.releaseKtx(tile);throw e;}
  }
  setBudget(bytes){this.budgetBytes=bytes;this.cache?.resize(bytes);this.#schedule();}
  retry(){this.cache?.retry();this.#schedule();}
  #upload(tile,input){
    const gl=this.gl,oldActive=gl.getParameter(gl.ACTIVE_TEXTURE);gl.activeTexture(gl.TEXTURE0);
    const oldTex=gl.getParameter(gl.TEXTURE_BINDING_2D),oldFlip=gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL),oldPremult=gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL),oldAlignment=gl.getParameter(gl.UNPACK_ALIGNMENT);
    let tex;
    try{
      if(Math.max(tile.textureWidth,tile.textureHeight)>gl.getParameter(gl.MAX_TEXTURE_SIZE))throw Error('Texture exceeds device limit');
      tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);gl.pixelStorei(gl.UNPACK_ALIGNMENT,4);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      if(this.mode==='ktx2'){
        const r=input.baseTexture.resource,b=r._levelBuffers[0];
        if(!gl.getParameter(gl.COMPRESSED_TEXTURE_FORMATS).includes(r.format))throw Error(`Compressed format ${r.format} unavailable in MapLibre context`);
        gl.compressedTexImage2D(gl.TEXTURE_2D,0,r.format,b.levelWidth,b.levelHeight,0,b.levelBuffer);

        this.formats.add(r.format);
      }else{throw Error('Only KTX2 is supported in the LOD renderer');}
      const owned=tex;tex=null;return {tile,tex:owned,corners:tileCorners(tile,this.catalog.sourceMap),dispose:()=>gl.deleteTexture(owned)};
    }finally{
      if(tex)gl.deleteTexture(tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,oldFlip);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,oldPremult);gl.pixelStorei(gl.UNPACK_ALIGNMENT,oldAlignment);
      gl.bindTexture(gl.TEXTURE_2D,oldTex);gl.activeTexture(oldActive);
    }
  }
  render(gl){
    if(this.stopped||!this.program||!this.cache)return;
    // Coarse to fine, leaving out any coarser tile the finer ones loaded already cover: each part of
    // the screen is filled once, however many detail levels are loaded under it.
    const shown=[...this.cache.resident.values()].filter(r=>r.tile.lod<=this.activeLod&&overlaps(r.tile,this.view)),tiles=shown.map(r=>r.tile);
    const items=shown.filter(r=>!hiddenByFiner(r.tile,tiles,this.view)).sort((a,b)=>a.tile.lod-b.tile.lod).map(r=>r.handle);
    if(!items.length)return;
    const [w,h]=this.size;
    gl.useProgram(this.program);gl.bindVertexArray?.(this.vao??null);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
    gl.enableVertexAttribArray(this.pos);gl.enableVertexAttribArray(this.uv);gl.vertexAttribPointer(this.pos,2,gl.FLOAT,false,16,0);gl.vertexAttribPointer(this.uv,2,gl.FLOAT,false,16,8);
    gl.disable(gl.DEPTH_TEST);gl.disable(gl.STENCIL_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.BLEND);gl.activeTexture(gl.TEXTURE0);gl.uniform1i(this.sampler,0);
    const paint=(key,fallback)=>{const p=this.map.getPaintProperty('tapestry',key);return typeof p==='number'?p:fallback;};
    gl.uniform4f(this.look,paint('raster-brightness-min',0),paint('raster-brightness-max',1),paint('raster-saturation',0),paint('raster-contrast',0));
    for(const item of items){
      const {tile:t}=item,points=item.corners.map(ll=>this.map.project(ll));
      if(points.every(p=>p.x<0)||points.every(p=>p.x>w)||points.every(p=>p.y<0)||points.every(p=>p.y>h))continue;
      const u0=t.frameX/t.textureWidth,v0=t.frameY/t.textureHeight,u1=(t.frameX+t.frameWidth)/t.textureWidth,v1=(t.frameY+t.frameHeight)/t.textureHeight;
      const uv=[[u0,v0],[u1,v0],[u0,v1],[u1,v1]],vertices=[];
      for(const i of [0,2,1,1,2,3])vertices.push(points[i].x/w*2-1,1-points[i].y/h*2,...uv[i]);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STREAM_DRAW);gl.bindTexture(gl.TEXTURE_2D,item.tex);gl.drawArrays(gl.TRIANGLES,0,6);
    }
    gl.disableVertexAttribArray(this.pos);gl.disableVertexAttribArray(this.uv);gl.bindVertexArray?.(null);
  }
  onRemove(map,gl){
    this.stopped=true;if(this.pending!=null)cancelAnimationFrame(this.pending);
    map?.off('move',this.onMove);map?.off('resize',this.onResize);this.cache?.stop();
    if(this.buffer)gl.deleteBuffer(this.buffer);if(this.vao)gl.deleteVertexArray(this.vao);if(this.program)gl.deleteProgram(this.program);
    // In-flight decoder jobs release CPU assets when they resolve. They cannot upload after stop.
  }
}

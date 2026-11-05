// Decode through Foundry's native V14 parser or the V13 Basis parser, retaining owned bytes.
export class KtxDecoder {
  constructor(store){this.store=store;this.entries=new Map();this.queue=[];this.running=0;}
  acquire(tile,source){
    let entry=this.entries.get(tile.hash);
    if(!entry){entry={refs:0,promise:new Promise((resolve,reject)=>this.queue.push({tile,source,resolve,reject}))};this.entries.set(tile.hash,entry);this.#pump();}
    entry.refs++;return entry.promise;
  }
  #pump(){while(this.running<2&&this.queue.length){const job=this.queue.shift();this.running++;this.#decode(job.tile,job.source).then(job.resolve,job.reject).finally(()=>{this.running--;this.#pump();});}}
  async #decode(tile,source){
    const modern=globalThis.foundry?.canvas?.KTX2Parser,legacy=globalThis.PixiBasisKTX2?.KTX2Parser;
    if(!modern?.parse&&!legacy?.transcode)throw Error('Foundry KTX2 decoding is unavailable on this client.');
    if(!modern?.parse)await legacy.TranscoderWorker?.onTranscoderInitialized;
    const bytes=await this.store.bytes(tile,source),resources=modern?.parse?[await modern.parse(bytes,{transfer:false})]:await legacy.transcode(bytes);
    if(!Array.isArray(resources)||resources.length!==1){for(const r of resources??[])r.destroy?.();throw Error('Expected one KTX2 texture level.');}
    let base;
    try{base=new PIXI.BaseTexture(resources[0],{mipmap:PIXI.MIPMAP_MODES.OFF,alphaMode:resources[0].isPremultiplied?PIXI.ALPHA_MODES.PREMULTIPLIED_ALPHA:PIXI.ALPHA_MODES.NO_PREMULTIPLIED_ALPHA});return new PIXI.Texture(base);}
    catch(e){base?.destroy();throw e;}
  }
  async release(tile){
    const entry=this.entries.get(tile.hash);if(!entry)return;entry.refs--;
    let texture;try{texture=await entry.promise;}catch{}
    if(entry.refs===0&&this.entries.get(tile.hash)===entry){this.entries.delete(tile.hash);texture?.destroy(true);}
  }
}

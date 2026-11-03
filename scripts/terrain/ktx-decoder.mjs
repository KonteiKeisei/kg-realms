// Uses the same registered V13 KTX2 parser as Foundry, with local bytes as its source.
export class KtxDecoder {
  constructor(store){this.store=store;this.entries=new Map();this.queue=[];this.running=0;}
  acquire(tile,source){
    let entry=this.entries.get(tile.hash);
    if(!entry){entry={refs:0,promise:new Promise((resolve,reject)=>this.queue.push({tile,source,resolve,reject}))};this.entries.set(tile.hash,entry);this.#pump();}
    entry.refs++;return entry.promise;
  }
  #pump(){while(this.running<2&&this.queue.length){const job=this.queue.shift();this.running++;this.#decode(job.tile,job.source).then(job.resolve,job.reject).finally(()=>{this.running--;this.#pump();});}}
  async #decode(tile,source){
    const parser=globalThis.PixiBasisKTX2?.KTX2Parser;
    if(!parser?.transcode)throw Error('Foundry KTX2 decoding is unavailable on this client.');
    await parser.TranscoderWorker?.onTranscoderInitialized;
    const bytes=await this.store.bytes(tile,source),resources=await parser.transcode(bytes);
    if(!Array.isArray(resources)||resources.length!==1){for(const r of resources??[])r.destroy?.();throw Error('Expected one KTX2 texture level.');}
    let base;
    try{base=new PIXI.BaseTexture(resources[0],{mipmap:PIXI.MIPMAP_MODES.OFF,alphaMode:PIXI.ALPHA_MODES.NO_PREMULTIPLIED_ALPHA});return new PIXI.Texture(base);}
    catch(e){base?.destroy();throw e;}
  }
  async release(tile){
    const entry=this.entries.get(tile.hash);if(!entry)return;entry.refs--;
    let texture;try{texture=await entry.promise;}catch{}
    if(entry.refs===0&&this.entries.get(tile.hash)===entry){this.entries.delete(tile.hash);texture?.destroy(true);}
  }
}

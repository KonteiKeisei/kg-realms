const TEMPORARY=new Set([408,429,500,502,503,504]);
export function retryAfterMs(value,now=Date.now()){
  if(value==null||!String(value).trim())return null;
  const raw=String(value).trim(),ms=/^\d+$/.test(raw)?Number(raw)*1000:Date.parse(raw)-now;
  return Number.isFinite(ms)?Math.max(0,ms):null;
}
export class MapHttpError extends Error {
  constructor(tile,status){
    const help=status===403?'The server refused this file. Check server file access or proxy rules, then resume.':status===404?'This file is missing on the server. Check the module installation, then resume.':'Completed files are saved. Resume to retry unfinished files.';
    super(`Map download failed: HTTP ${status} for ${tile.path}. ${help}`);
    this.name='MapHttpError';this.status=status;this.path=tile.path;
  }
}
export class MapRequests {
  constructor({base='modules/kg-realms',fetcher=(...args)=>fetch(...args),route=path=>globalThis.foundry?.utils?.getRoute?.(path)??path,timeoutMs=45000,intervalMs=250,retries=2,retryBaseMs=2000,maxRetryWaitMs=30000}={}){
    Object.assign(this,{base,fetcher,route,timeoutMs,intervalMs,retries,retryBaseMs,maxRetryWaitMs});this.nextStart=0;this.cooldown=0;
  }
  async gate(paced){
    // Recheck after waiting: another request may have extended the shared cooldown.
    for(;;){const delay=Math.max(this.cooldown,paced?this.nextStart:0)-Date.now();if(delay<=0){if(paced)this.nextStart=Date.now()+this.intervalMs;return;}await new Promise(r=>setTimeout(r,delay));}
  }
  async read(tile,{paced=false,onProgress=()=>{},onRetry=()=>{}}={}){
    const url=this.route(`${this.base}/${tile.path}`);
    try{
      for(let attempt=0;;attempt++){
        await this.gate(paced);onProgress(0);
        try{return await this.once(tile,url,onProgress);}
        catch(e){
          if(attempt>=this.retries||!(TEMPORARY.has(e.status)||e.network||e.stalled))throw e;
          const delay=Math.max(this.retryBaseMs*2**attempt,e.retryAfter??0);
          if(delay>this.maxRetryWaitMs)throw Error(`${e.message} The server requested a longer wait. Try again in ${Math.ceil(delay/1000)} seconds.`);
          this.cooldown=Math.max(this.cooldown,Date.now()+delay);onRetry({path:tile.path,status:e.status??null,attempt:attempt+1,retryAt:this.cooldown});
        }
      }
    }finally{onProgress(0);onRetry(null);}
  }
  async once(tile,url,onProgress){
    const controller=new AbortController();let idle;
    const touch=()=>{clearTimeout(idle);idle=setTimeout(()=>controller.abort(),this.timeoutMs);};
    try{
      touch();let res;
      // Canonical asset URLs avoid host rules that reject long cache-busting queries.
      // Revalidate cached responses; the caller verifies the received SHA-256 as well.
      try{res=await this.fetcher(url,{signal:controller.signal,cache:'no-cache',credentials:'same-origin'});}
      catch(e){e.network=e instanceof TypeError;throw e;}
      if(!res.ok){
        const e=new MapHttpError(tile,res.status);e.retryAfter=retryAfterMs(res.headers?.get('Retry-After'));
        await res.body?.cancel().catch(()=>{});throw e;
      }
      const reader=res.body?.getReader(),parts=[];let length=0;
      if(reader){try{for(;;){const {value,done}=await reader.read();if(done)break;touch();length+=value.byteLength;if(length>tile.ktxBytes)throw Error(`Map download exceeds its declared size: ${tile.path}`);parts.push(value);onProgress(length);}}catch(e){await reader.cancel().catch(()=>{});throw e;}}
      else{const b=new Uint8Array(await res.arrayBuffer());length=b.length;parts.push(b);onProgress(length);}
      if(length!==tile.ktxBytes)throw Error(`Incomplete map download: ${tile.path}. Resume to retry this file.`);
      const bytes=new Uint8Array(length);let at=0;for(const p of parts){bytes.set(p,at);at+=p.length;}return bytes;
    }catch(e){
      if(controller.signal.aborted){const timeout=Error(`Map download stalled: ${tile.path}. Resume to retry unfinished files.`);timeout.stalled=true;throw timeout;}
      throw e;
    }finally{clearTimeout(idle);}
  }
}

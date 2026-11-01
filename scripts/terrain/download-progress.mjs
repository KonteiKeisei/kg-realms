// Local session measurements. Saved files from earlier runs never inflate transfer rates.
export class DownloadProgress {
  constructor({now=()=>performance.now(),windowMs=10000,warmupMs=2000}={}){Object.assign(this,{now,windowMs,warmupMs});}
  start(){
    this.started=this.now();this.ended=null;this.networkBytes=0;this.savedBytes=0;this.savedFiles=0;
    this.samples=[];this.sample(this.started);
  }
  network(bytes){if(this.started==null||this.ended!=null||bytes<=0)return;this.networkBytes+=bytes;this.sample(this.now());}
  saved(bytes){if(this.started==null||this.ended!=null)return;this.savedBytes+=bytes;this.savedFiles++;this.sample(this.now());}
  sample(at){
    const point={at,network:this.networkBytes,bytes:this.savedBytes,files:this.savedFiles},last=this.samples.at(-1);
    if(this.samples.length>1&&at-last.at<250)this.samples[this.samples.length-1]=point;else this.samples.push(point);
    while(this.samples.length>2&&this.samples[1].at<=at-this.windowMs)this.samples.shift();
  }
  stop(){if(this.started!=null&&this.ended==null){this.ended=this.now();this.sample(this.ended);}}
  snapshot({remainingBytes=0,remainingFiles=0,retrying=false}={}){
    if(this.started==null)return {elapsedMs:0,transferredBytes:0,bytesPerSecond:null,etaSeconds:null,sessionFiles:0};
    const now=this.ended??this.now();this.sample(now);const first=this.samples[0],seconds=(now-first.at)/1000,elapsedMs=Math.max(0,now-this.started);
    const rate=seconds>0?(this.networkBytes-first.network)/seconds:0,byteRate=seconds>0?(this.savedBytes-first.bytes)/seconds:0,fileRate=seconds>0?(this.savedFiles-first.files)/seconds:0;
    let etaSeconds=null;
    if(this.ended==null&&!retrying&&elapsedMs>=this.warmupMs&&this.savedFiles>=2&&byteRate>0&&fileRate>0)
      etaSeconds=Math.ceil(Math.max(remainingBytes/byteRate,remainingFiles/fileRate));
    return {elapsedMs,transferredBytes:this.networkBytes,bytesPerSecond:elapsedMs>=this.warmupMs?rate:null,etaSeconds,sessionFiles:this.savedFiles};
  }
}
export function formatBytes(n){
  if(n>=1073741824)return `${(n/1073741824).toFixed(2)} GiB`;
  if(n>=1048576)return `${(n/1048576).toFixed(1)} MiB`;
  if(n>=1024)return `${(n/1024).toFixed(0)} KiB`;
  return `${Math.max(0,Math.round(n))} B`;
}
export function formatDuration(seconds){
  seconds=Math.max(0,Math.floor(seconds));const hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60),rest=seconds%60;
  return hours?`${hours}h ${minutes}m`:minutes?`${minutes}m ${rest}s`:`${rest}s`;
}
export function formatEta(seconds){return seconds==null?'Estimating...':seconds<=0?'Finishing...':`About ${formatDuration(Math.ceil(seconds/5)*5)}`;}

import test from 'node:test';
import assert from 'node:assert/strict';
import {MapRequests,retryAfterMs} from '../scripts/terrain/asset-request.mjs';
const tile={path:'assets/terrain/z9-17340-9180.ktx2',ktxBytes:4};
const success=()=>new Response('data');
const fast={intervalMs:0,retryBaseMs:1};

test('terrain requests use canonical, routed URLs and cache revalidation without hash queries',async()=>{
 let actual,options;const transport=new MapRequests({...fast,route:p=>'/foundry/'+p,fetcher:async(u,o)=>{actual=u;options=o;return success();}});
 assert.equal(new TextDecoder().decode(await transport.read(tile)),'data');
 assert.equal(actual,'/foundry/modules/kg-realms/assets/terrain/z9-17340-9180.ktx2');assert.equal(options.cache,'no-cache');assert.equal(options.credentials,'same-origin');
});
test('a genuine 403 is reported with the filename and is never retried automatically',async()=>{
 let calls=0;const transport=new MapRequests({...fast,fetcher:async()=>{calls++;return new Response('Denied',{status:403});}});
 await assert.rejects(transport.read(tile),e=>e.status===403&&e.path===tile.path&&/server refused/.test(e.message));assert.equal(calls,1);
});
test('a missing server file is distinguished from a denied request',async()=>{
 let calls=0;const transport=new MapRequests({...fast,fetcher:async()=>{calls++;return new Response('Missing',{status:404});}});
 await assert.rejects(transport.read(tile),/HTTP 404.*missing on the server/);assert.equal(calls,1);
});
test('temporary rate limits and gateway failures retry at most twice',async()=>{
 let calls=0;const changes=[];const transport=new MapRequests({...fast,fetcher:async()=>{calls++;return calls===1?new Response('',{status:429}):calls===2?new Response('',{status:503}):success();}});
 assert.equal(new TextDecoder().decode(await transport.read(tile,{onRetry:r=>changes.push(r)})),'data');assert.equal(calls,3);assert.equal(changes[0].status,429);assert.equal(changes[1].attempt,2);assert.equal(changes.at(-1),null);
 calls=0;transport.fetcher=async()=>{calls++;return new Response('',{status:502});};await assert.rejects(transport.read(tile),/HTTP 502/);assert.equal(calls,3);
});
test('a server-requested long wait stops cleanly rather than retrying early',async()=>{
 let calls=0;const transport=new MapRequests({...fast,maxRetryWaitMs:50,fetcher:async()=>{calls++;return new Response('',{status:429,headers:{'Retry-After':'120'}});}});
 await assert.rejects(transport.read(tile),/Try again in 120 seconds/);assert.equal(calls,1);
});
test('Retry-After supports both seconds and HTTP dates',()=>{
 const now=Date.UTC(2026,9,28,12);assert.equal(retryAfterMs('3',now),3000);assert.equal(retryAfterMs(new Date(now+4000).toUTCString(),now),4000);
 assert.equal(retryAfterMs(new Date(now-4000).toUTCString(),now),0);assert.equal(retryAfterMs(null,now),null);assert.equal(retryAfterMs('invalid',now),null);
});
test('a shared cooldown holds other requests until Retry-After has elapsed',async()=>{
 let rejectedAt,otherAt,first=true;const other={...tile,path:'assets/terrain/z9-19380-9180.ktx2'};
 const transport=new MapRequests({...fast,retryBaseMs:35,fetcher:async url=>{if(url.endsWith(tile.path)&&first){first=false;rejectedAt=Date.now();return new Response('',{status:429});}if(url.endsWith(other.path))otherAt=Date.now();return success();}});
 let startOther;const retrying=new Promise(r=>startOther=r);const one=transport.read(tile,{onRetry:r=>{if(r)startOther();}});await retrying;await Promise.all([one,transport.read(other)]);
 assert.ok(otherAt-rejectedAt>=30,`Other request started too early: ${otherAt-rejectedAt}ms`);
});
test('bulk request starts are paced across concurrent slots while ordinary streaming is unpaced',async()=>{
 const starts=[];const transport=new MapRequests({intervalMs:30,fetcher:async()=>{starts.push(Date.now());return success();}});
 await Promise.all([transport.read(tile,{paced:true}),transport.read(tile,{paced:true}),transport.read(tile,{paced:true})]);
 assert.ok(starts[1]-starts[0]>=25);assert.ok(starts[2]-starts[1]>=25);
 transport.nextStart=Date.now()+10000;await transport.read(tile);assert.ok(Date.now()-starts.at(-1)<100);
});
test('stalled and disconnected fetches have bounded recovery and release progress',async()=>{
 let calls=0;const transport=new MapRequests({...fast,timeoutMs:5,fetcher:async(url,{signal})=>{calls++;if(calls===1)return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));if(calls===2)throw new TypeError('Disconnected');return success();}});
 const progress=[];assert.equal(new TextDecoder().decode(await transport.read(tile,{onProgress:n=>progress.push(n)})),'data');assert.equal(calls,3);assert.equal(progress.at(-1),0);
});
test('oversized and truncated bodies cannot be accepted or retried as permission errors',async()=>{
 const transport=new MapRequests({...fast,fetcher:async()=>new Response('too much')});await assert.rejects(transport.read(tile),/declared size/);
 transport.fetcher=async()=>new Response('x');await assert.rejects(transport.read(tile),/Incomplete map download.*z9-17340-9180/);
});

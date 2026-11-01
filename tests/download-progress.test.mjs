import test from 'node:test';
import assert from 'node:assert/strict';
import {DownloadProgress,formatBytes,formatDuration,formatEta} from '../scripts/terrain/download-progress.mjs';
function clock(){let at=0;return {meter:new DownloadProgress({now:()=>at}),set:n=>at=n};}
test('unstarted transfers do not invent speeds or remaining times',()=>{
 const {meter}=clock();assert.deepEqual(meter.snapshot(),{elapsedMs:0,transferredBytes:0,bytesPerSecond:null,etaSeconds:null,sessionFiles:0});
});
test('network totals remain cumulative between small files instead of resetting to zero',()=>{
 const {meter,set}=clock();meter.start();set(1000);meter.network(16384);meter.saved(16384);set(2000);meter.network(32768);meter.saved(32768);set(2500);
 const s=meter.snapshot({remainingBytes:49152,remainingFiles:2});assert.equal(s.transferredBytes,49152);assert.equal(s.bytesPerSecond,49152/2.5);assert.equal(s.etaSeconds,3);assert.equal(s.sessionFiles,2);
});
test('ETA waits for observations and excludes previous installed bytes',()=>{
 const {meter,set}=clock();meter.start();set(500);meter.network(100);meter.saved(100);assert.equal(meter.snapshot({remainingBytes:900}).etaSeconds,null);
 set(1000);meter.network(100);meter.saved(100);assert.equal(meter.snapshot({remainingBytes:800,remainingFiles:8}).etaSeconds,null);
 set(2000);const s=meter.snapshot({remainingBytes:800,remainingFiles:8});assert.equal(s.transferredBytes,200);assert.equal(s.bytesPerSecond,100);assert.equal(s.etaSeconds,8);
});
test('retried bytes affect network speed without inflating successful-save throughput',()=>{
 const {meter,set}=clock();meter.start();set(1000);meter.network(1000);set(2000);meter.network(1000);meter.saved(1000);set(4000);meter.network(1000);meter.saved(1000);
 const s=meter.snapshot({remainingBytes:2000,remainingFiles:2});assert.equal(s.transferredBytes,3000);assert.equal(s.bytesPerSecond,750);assert.equal(s.etaSeconds,4);
 assert.equal(meter.snapshot({remainingBytes:2000,remainingFiles:2,retrying:true}).etaSeconds,null);
});
test('ETA accounts for file-processing pace when the remaining files are smaller',()=>{
 const {meter,set}=clock();meter.start();set(2000);meter.network(1000);meter.saved(1000);set(4000);meter.network(1000);meter.saved(1000);
 assert.equal(meter.snapshot({remainingBytes:100,remainingFiles:100}).etaSeconds,200);
});
test('the moving window stops showing an old speed while no data arrives',()=>{
 const {meter,set}=clock();meter.start();set(1000);meter.network(100);meter.saved(100);set(2000);meter.network(100);meter.saved(100);set(15000);
 const s=meter.snapshot({remainingBytes:200,remainingFiles:2});assert.equal(s.bytesPerSecond,0);assert.equal(s.etaSeconds,null);
});
test('pause and completion freeze elapsed time and a resumed run starts fresh',()=>{
 const {meter,set}=clock();meter.start();set(3000);meter.network(50);meter.saved(50);meter.stop();set(10000);meter.network(999);meter.saved(999);
 const paused=meter.snapshot({remainingBytes:50,remainingFiles:1});assert.equal(paused.elapsedMs,3000);assert.equal(paused.transferredBytes,50);assert.equal(paused.etaSeconds,null);
 meter.start();set(12000);meter.network(50);meter.saved(50);const resumed=meter.snapshot();assert.equal(resumed.elapsedMs,2000);assert.equal(resumed.transferredBytes,50);assert.equal(resumed.sessionFiles,1);
});
test('finished bytes awaiting package commit are described as finishing',()=>{
 const {meter,set}=clock();meter.start();set(2000);meter.network(10);meter.saved(10);set(3000);meter.network(10);meter.saved(10);
 assert.equal(formatEta(meter.snapshot().etaSeconds),'Finishing...');
});
test('long downloads retain a bounded recent sample history',()=>{
 const {meter,set}=clock();meter.start();for(let i=1;i<20000;i++){set(i*20);meter.network(1);meter.snapshot();}assert.ok(meter.samples.length<50);assert.ok(meter.snapshot().bytesPerSecond>0);
});
test('byte formatting keeps small files legible instead of rounding to 0.0 MiB',()=>{
 assert.equal(formatBytes(2048),'2 KiB');assert.equal(formatBytes(32),'32 B');assert.equal(formatBytes(1048576),'1.0 MiB');assert.equal(formatBytes(1073741824),'1.00 GiB');
});
test('time formatting labels estimates and rounds them to avoid false precision',()=>{
 assert.equal(formatEta(null),'Estimating...');assert.equal(formatEta(63),'About 1m 5s');assert.equal(formatEta(1),'About 5s');assert.equal(formatDuration(3671),'1h 1m');assert.equal(formatDuration(61),'1m 1s');
});
